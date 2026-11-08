"use strict";

const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { pathToFileURL } = require("url");
const {
  imprimirCupomVenda,
  listarImpressorasDetectadas,
  prepararImpressao,
  encerrarImpressao,
} = require("./impressao/imprimirCupom");
const {
  carregarConfigApp,
  obterConfigApp,
  salvarConfigApp,
} = require("./configApp");
const {
  lerLicenca,
  salvarLicenca,
  limparLicenca,
} = require("./licencaStore");
const {
  validarLicencaRemota,
  obterUrlApi,
  testarConexaoApi,
  API_URL_PRODUCAO,
  hostsApiConfiaveis,
} = require("./licencaApi");
const { lerFilaOffline, gravarFilaOffline } = require("./filaOfflineStore");
const { verificarAtualizacao } = require("./atualizacaoApp");
const { NOME_PRODUTO, NOME_PRODUTO_COMPLETO } = require("./marcaProduto.cjs");

// Win7 / GPUs antigas: evita tela preta ou crash na abertura.
try {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
} catch {
  /* versoes antigas do Electron */
}

/** Probe de Ollama/RAM. O renderer não recebe motivo nem dialog. */
const estadoIa = { localOk: false };
const confirmacoesIaPendentes = new Map();
const comandosIaPendentes = new Map();
const TIMEOUT_COMANDO_IA_MS = 15000;
let journalIa = null;
let ragIa = null;
let runtimeIa = null;
let hardwareIaPromise = null;

/**
 * Remove BOM e espacos que o PowerShell/Out-File às vezes coloca no .env do CI.
 * @param {string} texto
 */
function limparTextoEnv(texto) {
  return String(texto || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n");
}

/**
 * Carrega as variáveis de ambiente do arquivo .env (dev ou resources do instalador).
 */

/**
 * Hosts permitidos para shell.openExternal (Mercado Pago, WhatsApp, API oficial).
 * @param {string} hostname
 * @returns {boolean}
 */
function hostExternoPermitido(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  const sufixos = [
    "mercadopago.com",
    "mercadopago.com.br",
    "mlstatic.com",
    "wa.me",
    "whatsapp.com",
  ];
  for (const s of sufixos) {
    if (host === s || host.endsWith("." + s)) return true;
  }
  try {
    for (const h of hostsApiConfiaveis()) {
      const ok = String(h || "").toLowerCase();
      if (ok && (host === ok || host.endsWith("." + ok))) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Valida URL antes de abrir no navegador do sistema.
 * @param {string} url
 * @returns {{ ok: true, url: string } | { ok: false, mensagem: string }}
 */
function validarUrlExterna(url) {
  const texto = String(url || "").trim();
  if (!/^https?:\/\//i.test(texto)) {
    return { ok: false, mensagem: "URL inválida." };
  }
  let parsed;
  try {
    parsed = new URL(texto);
  } catch {
    return { ok: false, mensagem: "URL inválida." };
  }
  const proto = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();

  if (proto === "http:") {
    const empacotado = (() => {
      try {
        return Boolean(app.isPackaged);
      } catch {
        return true;
      }
    })();
    if (
      !empacotado &&
      (host === "localhost" || host === "127.0.0.1")
    ) {
      return { ok: true, url: parsed.href };
    }
    return {
      ok: false,
      mensagem: "URL HTTP só é permitida em desenvolvimento (localhost).",
    };
  }

  if (proto !== "https:") {
    return { ok: false, mensagem: "Apenas URLs HTTP(S) são permitidas." };
  }

  if (!hostExternoPermitido(host)) {
    return {
      ok: false,
      mensagem: "Domínio não permitido para abertura externa.",
    };
  }
  return { ok: true, url: parsed.href };
}

/**
 * Windows 7/8/8.1 (NT 6.x) não têm a raiz nova do Let's Encrypt no repositório
 * do sistema; só neles a API oficial precisa do bypass de certificado. O mesmo
 * instalador no Windows 10/11 mantém a verificação normal.
 * @returns {boolean}
 */
function precisaBypassCertificadoLegacy() {
  if (process.platform !== "win32") return false;
  const versaoNt = Number.parseInt(String(os.release()).split(".")[0], 10);
  return Number.isFinite(versaoNt) && versaoNt < 10;
}

function carregarVariaveisDeAmbiente() {
  // Empacotado: só resources/.env (cópia de build/env.producao) e o fallback no asar.
  // Dev: .env na raiz do projeto primeiro.
  const candidatos = app.isPackaged
    ? [
        path.join(process.resourcesPath || "", ".env"),
        path.join(__dirname, "..", "build", "env.producao"),
      ]
    : [
        path.join(__dirname, "..", ".env"),
        path.join(__dirname, "..", "build", "env.producao"),
      ];

  for (const caminho of candidatos) {
    if (!caminho || !fs.existsSync(caminho)) continue;
    try {
      const bruto = limparTextoEnv(fs.readFileSync(caminho, "utf8"));
      for (const linha of bruto.split("\n")) {
        const limpa = linha.trim();
        if (!limpa || limpa.startsWith("#") || !limpa.includes("=")) continue;
        const i = limpa.indexOf("=");
        const chave = limpa.slice(0, i).trim();
        const valor = limpa.slice(i + 1).trim();
        if (chave && process.env[chave] === undefined) {
          process.env[chave] = valor;
        }
      }
      break;
    } catch (erro) {
      console.error("Falha ao ler .env:", caminho, erro);
    }
  }

  if (!String(process.env.CYBHOR_API_URL || "").trim() && app.isPackaged) {
    process.env.CYBHOR_API_URL = API_URL_PRODUCAO;
  }

  // Instalador nunca herda CYBHOR_MODO_DEV=1 do ambiente da máquina ou de .env errado.
  if (app.isPackaged) {
    process.env.CYBHOR_MODO_DEV = "0";
  }
}


/**
 * URL file:// do index do renderer — única navegação permitida na janela principal.
 * @returns {string}
 */
function urlRendererIndex() {
  return pathToFileURL(
    path.join(__dirname, "..", "renderer", "index.html")
  ).href;
}

/**
 * True se a URL aponta para um arquivo dentro de renderer/ (mesma origem do app).
 * @param {string} url
 */
function navegacaoRendererPermitida(url) {
  const texto = String(url || "");
  if (!texto || texto === "about:blank") return true;
  let parsed;
  try {
    parsed = new URL(texto);
  } catch {
    return false;
  }
  if (parsed.protocol !== "file:") return false;
  const raiz = pathToFileURL(path.join(__dirname, "..", "renderer") + path.sep)
    .href;
  return parsed.href === urlRendererIndex() || parsed.href.startsWith(raiz);
}

function criarJanela() {
  const config = obterConfigApp();
  const janela = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: config.tema === "claro" ? "#f2f2f2" : "#151515",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  janela.setMenuBarVisibility(false);
  janela.setTitle(`${NOME_PRODUTO} ${app.getVersion()}`);
  janela.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  // Bloqueia navegação/popup inesperados (phishing via conteúdo remoto ou XSS).
  janela.webContents.on("will-navigate", (evento, url) => {
    if (navegacaoRendererPermitida(url)) return;
    evento.preventDefault();
    console.warn("Navegação bloqueada:", url);
  });
  janela.webContents.setWindowOpenHandler(({ url }) => {
    const validacao = validarUrlExterna(url);
    if (validacao.ok) {
      shell.openExternal(validacao.url).catch((erro) => {
        console.error("Falha ao abrir URL externa:", erro);
      });
    } else {
      console.warn("Nova janela bloqueada:", url, validacao.mensagem);
    }
    return { action: "deny" };
  });

  let mostrou = false;
  const exibir = () => {
    if (mostrou || janela.isDestroyed()) return;
    mostrou = true;
    janela.show();
  };
  janela.once("ready-to-show", exibir);
  // Se o renderer travar (ofuscacao/GPU), ainda assim abre a janela.
  setTimeout(exibir, 5000);

  janela.webContents.on("did-fail-load", (_e, codigo, descricao) => {
    console.error("Falha ao carregar UI:", codigo, descricao);
    exibir();
    dialog.showErrorBox(
      NOME_PRODUTO_COMPLETO,
      "Nao foi possivel carregar a interface (" + codigo + "). Reinstale o aplicativo."
    );
  });

  janela.webContents.on("render-process-gone", (_e, details) => {
    console.error("Renderer encerrado:", details);
    dialog.showErrorBox(
      NOME_PRODUTO_COMPLETO,
      "O aplicativo fechou inesperadamente. No Windows 7 confira se o SP1 esta instalado e reinstale o " +
        NOME_PRODUTO_COMPLETO +
        "."
    );
  });
}

carregarVariaveisDeAmbiente();

ipcMain.handle("obter-api-url", () => obterUrlApi());

ipcMain.handle("testar-conexao-api", async () => {
  try {
    return await testarConexaoApi();
  } catch (erro) {
    return {
      ok: false,
      mensagem: erro?.message || "Falha ao testar conexao.",
      apiUrl: obterUrlApi(),
    };
  }
});

ipcMain.handle("obter-config-app", () => {
  try {
    return { ok: true, config: obterConfigApp() };
  } catch (erro) {
    return {
      ok: false,
      mensagem: erro?.message || "Não foi possível ler as configurações.",
    };
  }
});

ipcMain.handle("salvar-config-app", (_evento, parcial) => {
  try {
    if (
      parcial != null &&
      (typeof parcial !== "object" || Array.isArray(parcial))
    ) {
      return { ok: false, mensagem: "Configuração inválida." };
    }
    const config = salvarConfigApp(parcial || {});
    return { ok: true, config };
  } catch (erro) {
    console.error("Falha ao salvar config-app:", erro);
    return {
      ok: false,
      mensagem: erro?.message || "Não foi possível salvar as configurações.",
    };
  }
});

ipcMain.handle("obter-versao-app", () => app.getVersion());

ipcMain.handle("listar-impressoras", async () => {
  try {
    const { impressoras, automatica } = await listarImpressorasDetectadas();
    return {
      ok: true,
      automatica,
      impressoras: impressoras.map((p) => ({
        nome: p.nome,
        padrao: p.padrao,
        disponivel: p.disponivel,
        termica: p.termica,
      })),
    };
  } catch (erro) {
    console.error("Falha ao listar impressoras:", erro);
    return {
      ok: false,
      impressoras: [],
      mensagem: "Falha ao listar impressoras.",
    };
  }
});

/** Evita cupom duplicado se o renderer estourar timeout e o operador clicar de novo. */
let impressaoCupomEmAndamento = false;

ipcMain.handle("imprimir-cupom", async (_evento, dadosVenda) => {
  if (impressaoCupomEmAndamento) {
    return {
      ok: false,
      mensagem: "Já há uma impressão em andamento. Aguarde terminar.",
    };
  }
  impressaoCupomEmAndamento = true;
  try {
    if (
      dadosVenda != null &&
      (typeof dadosVenda !== "object" || Array.isArray(dadosVenda))
    ) {
      return { ok: false, mensagem: "Dados de venda inválidos." };
    }
    return await imprimirCupomVenda(dadosVenda || {});
  } catch (erro) {
    console.error("Falha na impressão do cupom:", erro);
    return {
      ok: false,
      mensagem: erro?.message || "Não foi possível imprimir o cupom.",
    };
  } finally {
    impressaoCupomEmAndamento = false;
  }
});

ipcMain.handle("obter-licenca", async () => {
  let local = lerLicenca();
  if (!local && !app.isPackaged && process.env.CYBHOR_MODO_DEV === "1") {
    const dev = await validarLicencaRemota("DEV-LOCAL");
    if (dev.ok) {
      salvarLicenca({
        lojaId: dev.lojaId,
        chave: "DEV-LOCAL",
        email: dev.email,
        nomeLoja: dev.nomeLoja,
      });
      local = lerLicenca();
    }
  }
  if (!local) return { ok: false, ativada: false };

  // Revalida na FastAPI. Em desenvolvimento também migra licenças antigas
  // que usavam um hash local em vez do UUID real do PostgreSQL.
  if (local.chave) {
    const remota = await validarLicencaRemota(local.chave);
    if (!remota.ok) {
      return {
        ok: false,
        ativada: false,
        mensagem: remota.mensagem || "Licença inválida ou suspensa.",
      };
    }
    if (
      remota.lojaId &&
      remota.lojaId !== local.lojaId &&
      !app.isPackaged &&
      process.env.CYBHOR_MODO_DEV === "1"
    ) {
      salvarLicenca({
        lojaId: remota.lojaId,
        chave: local.chave,
        email: remota.email || local.email,
        nomeLoja: remota.nomeLoja || local.nomeLoja,
      });
      local.lojaId = remota.lojaId;
      local.email = remota.email || local.email;
      local.nomeLoja = remota.nomeLoja || local.nomeLoja;
    } else if (remota.lojaId && remota.lojaId !== local.lojaId) {
      return {
        ok: false,
        ativada: false,
        mensagem: "Licença não corresponde a esta instalação.",
      };
    }
  }

  return {
    ok: true,
    ativada: true,
    lojaId: local.lojaId,
    email: local.email || "",
    nomeLoja: local.nomeLoja || "",
    chave: local.chave || "",
    apiUrl: obterUrlApi(),
  };
});

ipcMain.handle("ativar-licenca", async (_evento, chave) => {
  const validacao = await validarLicencaRemota(chave);
  if (!validacao.ok) {
    return { ok: false, mensagem: validacao.mensagem };
  }
  const salva = salvarLicenca({
    lojaId: validacao.lojaId,
    chave: validacao.chave,
    email: validacao.email,
    nomeLoja: validacao.nomeLoja,
  });
  return {
    ok: true,
    ativada: true,
    lojaId: salva.lojaId,
    email: salva.email,
    nomeLoja: salva.nomeLoja,
    chave: salva.chave,
  };
});

ipcMain.handle("limpar-licenca", () => {
  limparLicenca();
  return { ok: true };
});

/**
 * Mesmo bloco que assistenteGemini monta para o Gemini.
 * O router só repassa mensagem + system do modo ao Ollama.
 * @param {object} [contextoBruto]
 */
function textoContextoLoja(contextoBruto) {
  const contexto =
    contextoBruto && typeof contextoBruto === "object" ? contextoBruto : {};
  return [
    contexto.nomeLoja ? `Loja: ${contexto.nomeLoja}` : null,
    contexto.endereco ? `Endereço/região: ${contexto.endereco}` : null,
    Number.isFinite(contexto.receitaMes)
      ? `Receita do mês: R$ ${Number(contexto.receitaMes).toFixed(2)}`
      : null,
    Number.isFinite(contexto.lucroBrutoMes)
      ? `Lucro bruto (mês): R$ ${Number(contexto.lucroBrutoMes).toFixed(2)}`
      : null,
    Number.isFinite(contexto.despesasMes)
      ? `Despesas do mês: R$ ${Number(contexto.despesasMes).toFixed(2)}`
      : null,
    Number.isFinite(contexto.lucroLiquidoMes)
      ? `Lucro líquido (mês): R$ ${Number(contexto.lucroLiquidoMes).toFixed(2)}`
      : null,
    Array.isArray(contexto.maisVendidos) && contexto.maisVendidos.length
      ? `Mais vendidos: ${contexto.maisVendidos
          .slice(0, 8)
          .map((p) => `${p.nome} (${p.quantidade})`)
          .join("; ")}`
      : null,
    Array.isArray(contexto.estoqueBaixo) && contexto.estoqueBaixo.length
      ? `Estoque baixo: ${contexto.estoqueBaixo
          .slice(0, 8)
          .map((p) => `${p.nome} (${p.estoque})`)
          .join("; ")}`
      : null,
    Array.isArray(contexto.categorias) && contexto.categorias.length
      ? `Categorias: ${contexto.categorias.slice(0, 20).join(", ")}`
      : null,
    Number.isFinite(contexto.produtosSemCusto)
      ? `Produtos sem custo cadastrado: ${contexto.produtosSemCusto}`
      : null,
    contexto.equipePorArea
      ? `Equipe por área — Caixa: ${contexto.equipePorArea.caixa || 0}, RH: ${
          contexto.equipePorArea.rh || 0
        }, Marketing: ${contexto.equipePorArea.marketing || 0}`
      : null,
    Array.isArray(contexto.fornecedores) && contexto.fornecedores.length
      ? `Fornecedores: ${contexto.fornecedores
          .map((f) => {
            const tipos = f.tiposMercadoria || f.nicho || "";
            return `${f.nome} [${tipos}]${f.contato ? ` (${f.contato})` : ""}`;
          })
          .join("; ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function mensagemErroIa(erro) {
  const { sanitizarMensagemCliente } = require("./overflowTexto");
  const texto = erro && erro.message ? erro.message : erro;
  return sanitizarMensagemCliente(texto);
}

function sanitizarRespostaIa(resposta) {
  if (!resposta || typeof resposta !== "object") {
    return { ok: false, mensagem: "Falha ao consultar a IA." };
  }
  if (typeof resposta.mensagem !== "string" || !resposta.mensagem) return resposta;
  const { sanitizarMensagemCliente } = require("./overflowTexto");
  return { ...resposta, mensagem: sanitizarMensagemCliente(resposta.mensagem) };
}

function garantirHardwareIa() {
  if (!hardwareIaPromise) {
    hardwareIaPromise = (async () => {
      try {
        const { avaliarHardwareLocal } = require("./iaHardware");
        const avaliacao = await avaliarHardwareLocal();
        estadoIa.localOk = Boolean(avaliacao && avaliacao.localOk);
      } catch (erro) {
        estadoIa.localOk = false;
        console.error("ia hardware:", mensagemErroIa(erro));
      }
    })();
  }
  return hardwareIaPromise;
}

function garantirJournalIa() {
  if (journalIa) return journalIa;
  const { criarJournal } = require("./agentJournal");
  const caminho = path.join(app.getPath("userData"), "cybhor-ia-journal.jsonl");
  journalIa = criarJournal(caminho);
  return journalIa;
}

function indiceRagVazio(dir) {
  const arquivo = path.join(dir, "index.json");
  if (!fs.existsSync(arquivo)) return true;
  try {
    const data = JSON.parse(fs.readFileSync(arquivo, "utf8"));
    return !Array.isArray(data) || data.length === 0;
  } catch {
    return true;
  }
}

function garantirRagIa() {
  if (ragIa) return ragIa;
  const { criarRagStore } = require("./ragStore");
  const dir = path.join(app.getPath("userData"), "cybhor-ia-rag");
  const vazio = indiceRagVazio(dir);
  const store = criarRagStore({ dir });
  if (vazio) {
    const bruto = fs.readFileSync(path.join(__dirname, "rag", "docs-pdv.json"), "utf8");
    store.indexarDocumentos(JSON.parse(bruto));
  }
  ragIa = store;
  return ragIa;
}

function webContentsDoPdv(preferido) {
  const vivo = (wc) => wc && typeof wc.isDestroyed === "function" && !wc.isDestroyed();
  if (vivo(preferido)) return preferido;
  const focada = BrowserWindow.getFocusedWindow();
  if (focada && !focada.isDestroyed() && vivo(focada.webContents)) return focada.webContents;
  for (const janela of BrowserWindow.getAllWindows()) {
    if (!janela.isDestroyed() && vivo(janela.webContents)) return janela.webContents;
  }
  return null;
}

function normalizarResultadoComando(body) {
  const ok = Boolean(body && body.ok);
  const saida = {
    ok,
    resumo: String((body && body.resumo) || (ok ? "ok" : "falha")).slice(0, 500),
    reversivel: Boolean(body && body.reversivel),
  };
  if (body && body.before != null && typeof body.before === "object") saida.before = body.before;
  if (body && body.after != null && typeof body.after === "object") saida.after = body.after;
  return saida;
}

function executarComandoNoRenderer(sender, comando, args) {
  const { servicoDoComando, argsComandoSeguros } = require("./iaComandoMapa");
  if (!servicoDoComando(comando)) {
    return Promise.resolve({
      ok: false,
      resumo: "comando desconhecido",
      reversivel: false,
    });
  }
  const token = crypto.randomUUID();
  return new Promise((resolve) => {
    let fechado = false;
    const fechar = (resultado) => {
      if (fechado) return;
      fechado = true;
      clearTimeout(timer);
      comandosIaPendentes.delete(token);
      resolve(normalizarResultadoComando(resultado));
    };
    const timer = setTimeout(() => {
      fechar({ ok: false, resumo: "tempo esgotado ao executar comando" });
    }, TIMEOUT_COMANDO_IA_MS);
    const wc = webContentsDoPdv(sender);
    if (!wc) {
      fechar({ ok: false, resumo: "janela do PDV indisponível" });
      return;
    }
    comandosIaPendentes.set(token, { fechar, senderId: wc.id });
    try {
      wc.send("ia-executar-comando", {
        token,
        comando,
        args: argsComandoSeguros(args, comando),
      });
    } catch (erro) {
      console.error("ia comando:", mensagemErroIa(erro));
      fechar({ ok: false, resumo: "falha ao enviar comando" });
    }
  });
}

function servicesIaNoRenderer(sender) {
  const { COMANDOS_SERVICO } = require("./iaComandoMapa");
  const services = {};
  for (const [comando, metodo] of Object.entries(COMANDOS_SERVICO)) {
    if (metodo === "abrirRota") continue;
    services[metodo] = (args) => executarComandoNoRenderer(sender, comando, args);
  }
  return services;
}

/**
 * Chip antigo continua no router. Agente só com flag explícita.
 * @param {object} payload
 * @returns {""|"autorizacao"|"autonomo"}
 */
function pedidoUsaAgente(payload) {
  if (payload.agente === true) {
    return payload.modoOperacao === "autonomo" ? "autonomo" : "autorizacao";
  }
  const modo = String(payload.modoOperacao || "");
  if (modo === "autonomo" || modo === "autorizacao") return modo;
  return "";
}

function marcarProvider(res, provider) {
  if (!res || typeof res !== "object" || res.ok !== true) return res;
  return { ...res, provider };
}

/**
 * @param {object} payload
 * @param {{ injetarRag?: boolean, injetarLoja?: boolean }} [opcoes]
 */
async function rotearAssistente(payload, opcoes = {}) {
  const { consultarComRouter } = require("./assistenteRouter");
  const { consultarAssistente } = require("./assistenteGemini");
  const { consultarOllama } = require("./assistenteLocal");
  const injetarRag = opcoes.injetarRag !== false;
  const injetarLoja = opcoes.injetarLoja !== false;
  let contextoRag = "";
  if (injetarRag) {
    try {
      contextoRag = garantirRagIa().montarContexto(String(payload.mensagem || ""));
    } catch (erro) {
      console.error("ia rag:", mensagemErroIa(erro));
    }
  }
  const blocoLoja = injetarLoja ? textoContextoLoja(payload.contexto) : "";

  const resultado = await consultarComRouter({
    payload,
    hardware: { localOk: estadoIa.localOk },
    providers: {
      consultarOllama(entrada) {
        const extras = [];
        if (blocoLoja) extras.push(`Contexto da loja (use se relevante):\n${blocoLoja}`);
        if (contextoRag) extras.push(`Contexto recuperado:\n${contextoRag}`);
        const system = [entrada && entrada.system, ...extras].filter(Boolean).join("\n\n");
        return consultarOllama({
          mensagem: entrada && entrada.mensagem,
          system,
        }).then((res) => marcarProvider(res, "ollama"));
      },
      consultarGemini(pedidoBruto) {
        const pedido = pedidoBruto && typeof pedidoBruto === "object" ? pedidoBruto : {};
        let mensagem = pedido.mensagem;
        const texto = String(mensagem || "").trim();
        if (contextoRag && texto.length >= 3) {
          mensagem = `${texto}\n\nContexto recuperado:\n${contextoRag}`;
        }
        return consultarAssistente({ ...pedido, mensagem }).then((res) =>
          marcarProvider(res, "gemini")
        );
      },
    },
  });
  return sanitizarRespostaIa(resultado);
}

function interpretarSaidaAgente(texto) {
  const bruto = String(texto || "").trim();
  if (!bruto) return { texto: "", tool_calls: [] };
  const fenced = bruto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidato = (fenced ? fenced[1] : bruto).trim();
  if (candidato.startsWith("{") && candidato.endsWith("}")) {
    try {
      const obj = JSON.parse(candidato);
      if (obj && Array.isArray(obj.tool_calls)) {
        const tool_calls = obj.tool_calls
          .filter((call) => call && typeof call.nome === "string" && call.nome)
          .map((call) => ({
            nome: call.nome,
            args: call.args && typeof call.args === "object" ? call.args : {},
          }));
        return {
          texto: typeof obj.texto === "string" ? obj.texto : "",
          tool_calls,
        };
      }
    } catch {
      /* texto livre */
    }
  }
  return { texto: bruto, tool_calls: [] };
}

async function chamarLlmAgente(entrada) {
  const tools = Array.isArray(entrada && entrada.tools) ? entrada.tools : [];
  const mensagem = [
    String((entrada && entrada.prompt) || ""),
    'Se for usar tool, responda somente JSON {"texto":"...","tool_calls":[{"nome":"...","args":{}}]}. Sem tool, responda em texto.',
    `Tools: ${JSON.stringify(tools)}`,
  ].join("\n\n");
  const resultado = await rotearAssistente(
    { modo: "livre", mensagem },
    { injetarRag: false, injetarLoja: false }
  );
  if (!resultado || resultado.ok === false) {
    return {
      ok: false,
      texto: (resultado && resultado.mensagem) || "Falha ao consultar a IA.",
      tool_calls: [],
      provider: (resultado && resultado.provider) || "",
    };
  }
  const interpretado = interpretarSaidaAgente(resultado.texto);
  return {
    ok: true,
    texto: interpretado.texto,
    tool_calls: interpretado.tool_calls,
    provider: resultado.provider || "",
  };
}

function garantirRuntimeIa() {
  if (runtimeIa) return runtimeIa;
  const { criarRuntime } = require("./agentRuntime");
  const tools = require("./agentTools");
  runtimeIa = criarRuntime({
    journal: garantirJournalIa(),
    tools,
    rag: {
      montarContexto(mensagem) {
        try {
          return garantirRagIa().montarContexto(mensagem);
        } catch (erro) {
          console.error("ia rag:", mensagemErroIa(erro));
          return "";
        }
      },
    },
    chamarLlm: (entrada) => chamarLlmAgente(entrada),
  });
  return runtimeIa;
}

function pedirConfirmacaoIa(sender, proposta) {
  const token = crypto.randomUUID();
  return new Promise((resolve) => {
    let fechado = false;
    const fechar = (aceitar) => {
      if (fechado) return;
      fechado = true;
      clearTimeout(timer);
      confirmacoesIaPendentes.delete(token);
      resolve(Boolean(aceitar));
    };
    const timer = setTimeout(() => fechar(false), 120000);
    confirmacoesIaPendentes.set(token, {
      resolve: fechar,
      senderId: sender && sender.id,
    });
    try {
      const morto =
        !sender || (typeof sender.isDestroyed === "function" && sender.isDestroyed());
      if (morto) {
        fechar(false);
        return;
      }
      sender.send("ia-confirmar-acao", {
        token,
        resumo: proposta && proposta.resumo ? String(proposta.resumo) : "",
        tool: proposta && proposta.tool ? String(proposta.tool) : "",
      });
    } catch (erro) {
      console.error("ia confirmar:", mensagemErroIa(erro));
      fechar(false);
    }
  });
}

ipcMain.handle("consultar-assistente", async (evento, payloadBruto) => {
  const payload = payloadBruto && typeof payloadBruto === "object" ? payloadBruto : {};
  try {
    await garantirHardwareIa();
    const modoAgente = pedidoUsaAgente(payload);
    if (modoAgente) {
      const saida = await garantirRuntimeIa().processarPedido({
        mensagem: String(payload.mensagem || ""),
        modo: modoAgente,
        contextoLoja:
          payload.contexto && typeof payload.contexto === "object"
            ? payload.contexto
            : undefined,
        confirmarEscrita: (proposta) => pedirConfirmacaoIa(evento.sender, proposta),
        ctxTools: { services: servicesIaNoRenderer(evento.sender) },
      });
      if (!saida || saida.ok === false) {
        return sanitizarRespostaIa({
          ok: false,
          mensagem: (saida && saida.texto) || "Falha ao consultar a IA.",
          acoes: (saida && saida.acoes) || [],
          provider: (saida && saida.provider) || "",
        });
      }
      return sanitizarRespostaIa(saida);
    }

    const resultado = await rotearAssistente(payload);
    if (!resultado || typeof resultado !== "object") {
      return { ok: false, mensagem: "Falha ao consultar a IA." };
    }
    const saida = { ...resultado };
    delete saida.provider;
    return saida;
  } catch (erro) {
    console.error("assistente:", erro);
    return { ok: false, mensagem: mensagemErroIa(erro) };
  }
});

ipcMain.handle("ia-listar-journal", (_evento, limite) => {
  try {
    const n = Number(limite);
    const itens = garantirJournalIa().listar(Number.isFinite(n) ? n : 50);
    return { ok: true, itens };
  } catch (erro) {
    console.error("ia journal:", erro);
    return { ok: false, itens: [], mensagem: mensagemErroIa(erro) };
  }
});

ipcMain.handle("ia-desfazer", async (evento, id) => {
  try {
    const journal = garantirJournalIa();
    const entrada = journal.obter(String(id || ""));
    if (!entrada) return { ok: false, mensagem: "Registro não encontrado." };
    if (entrada.desfeito) return { ok: false, mensagem: "Registro já desfeito." };
    if (entrada.reversivel && entrada.before != null) {
      const { montarReversao } = require("./iaComandoMapa");
      const reversao = montarReversao(entrada);
      if (!reversao) {
        return { ok: false, mensagem: "Não há como reaplicar o estado anterior." };
      }
      const res = await executarComandoNoRenderer(
        evento.sender,
        reversao.comando,
        reversao.args
      );
      if (!res || res.ok !== true) {
        return { ok: false, mensagem: (res && res.resumo) || "Falha ao desfazer." };
      }
    }
    journal.marcarDesfeito(entrada.id);
    return { ok: true };
  } catch (erro) {
    console.error("ia desfazer:", erro);
    return { ok: false, mensagem: mensagemErroIa(erro) };
  }
});

ipcMain.on("ia-executar-comando-resultado", (evento, body) => {
  const token = body && typeof body.token === "string" ? body.token : "";
  const pendente = comandosIaPendentes.get(token);
  if (!pendente) return;
  if (pendente.senderId != null && evento.sender && evento.sender.id !== pendente.senderId) {
    return;
  }
  pendente.fechar(body);
});

ipcMain.handle("ia-indexar-loja", (_evento, snapshot) => {
  try {
    const { documentosDeSnapshotLoja } = require("./iaComandoMapa");
    const docs = documentosDeSnapshotLoja(snapshot);
    if (!docs.length) return { ok: true, indexados: 0 };
    garantirRagIa().indexarDocumentos(docs);
    return { ok: true, indexados: docs.length };
  } catch (erro) {
    console.error("ia indexar loja:", erro);
    return { ok: false, mensagem: mensagemErroIa(erro) };
  }
});

ipcMain.handle("ia-confirmar-acao-resposta", (evento, body) => {
  const token = body && typeof body.token === "string" ? body.token : "";
  const pendente = confirmacoesIaPendentes.get(token);
  if (!pendente) return { ok: false, mensagem: "Confirmação expirada." };
  if (pendente.senderId != null && evento.sender && evento.sender.id !== pendente.senderId) {
    return { ok: false, mensagem: "Confirmação inválida." };
  }
  pendente.resolve(Boolean(body && body.aceitar));
  return { ok: true };
});

ipcMain.handle("ler-fila-offline", () => {
  try {
    return { ok: true, fila: lerFilaOffline() };
  } catch (erro) {
    console.error("Falha ao ler a fila offline:", erro);
    return { ok: false, fila: [], mensagem: "Não foi possível ler as vendas guardadas." };
  }
});

ipcMain.handle("gravar-fila-offline", (_evento, fila) => {
  try {
    gravarFilaOffline(fila);
    return { ok: true };
  } catch (erro) {
    console.error("Falha ao gravar a fila offline:", erro);
    return {
      ok: false,
      mensagem: erro?.message || "Não foi possível guardar a venda no computador.",
    };
  }
});

ipcMain.handle("verificar-atualizacao", async () => {
  try {
    return await verificarAtualizacao();
  } catch {
    // Sem internet é o caso comum aqui; o aviso simplesmente não aparece.
    return { ok: false, disponivel: false };
  }
});

ipcMain.handle("abrir-externo", async (_evento, url) => {
  const validacao = validarUrlExterna(url);
  if (!validacao.ok) {
    return { ok: false, mensagem: validacao.mensagem };
  }
  await shell.openExternal(validacao.url);
  return { ok: true };
});

app.whenReady().then(() => {
  if (precisaBypassCertificadoLegacy()) {
    try {
      const { session } = require("electron");
      const confiaveis = hostsApiConfiaveis();
      session.defaultSession.setCertificateVerifyProc((pedido, callback) => {
        const host = String(pedido.hostname || "");
        if (confiaveis.has(host)) {
          callback(0);
          return;
        }
        // -3 = usa o resultado padrao do Chromium
        callback(-3);
      });
    } catch (erro) {
      console.error("Falha ao configurar verificacao de certificado:", erro);
    }
  }

  carregarConfigApp();
  void garantirHardwareIa();
  criarJanela();
  // Depois da janela: o PowerShell compilando o helper nao atrasa a abertura.
  setTimeout(prepararImpressao, 3000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on("will-quit", () => {
  encerrarImpressao();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
