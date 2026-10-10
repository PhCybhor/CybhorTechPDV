"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { BrowserWindow } = require("electron");
const { gerarHtmlCupom } = require("./cupomHtml");
const { gerarBufferEscPos } = require("./escpos");
const servidorImpressao = require("./servidorImpressao");

/**
 * Nomes/trechos usados para localizar a impressora Jetway no Windows.
 * Driver oficial cria "Jetway JP-800" (Driver_Utilitarios_JP-800).
 */
const PALAVRAS_JETWAY = [
  "jetway",
  "jp-800",
  "jp800",
  "jp-500",
  "jp500",
  "jp-700",
  "jp700",
  "tanca",
];



/**
 * Só aceita porta serial/USB — bloqueia caminhos de arquivo arbitrários.
 * Mantido espelhado com electron/configApp.js (normalizarPortaImpressora).
 * @param {unknown} valor
 * @returns {string}
 */
function normalizarPortaImpressora(valor) {
  const p = String(valor ?? "").trim();
  if (!p) return "";
  if (p.length > 64) return "";
  if (/^COM\d{1,3}$/i.test(p)) return p.toUpperCase();
  if (/^\/dev\/(tty(USB|ACM|S|AMA)\d+|usb\/lp\d+)$/.test(p)) return p;
  return "";
}

/**
 * Valida/normaliza o payload IPC de impressão (tipo, limites).
 * @param {unknown} bruto
 * @returns {{ ok: true, dados: object } | { ok: false, mensagem: string }}
 */
function validarDadosVendaCupom(bruto) {
  if (bruto == null) {
    return { ok: true, dados: { itens: [] } };
  }
  if (typeof bruto !== "object" || Array.isArray(bruto)) {
    return { ok: false, mensagem: "Dados de venda inválidos." };
  }
  const itensBrutos = bruto.itens;
  if (itensBrutos != null && !Array.isArray(itensBrutos)) {
    return { ok: false, mensagem: "Itens de venda inválidos." };
  }
  if (Array.isArray(itensBrutos) && itensBrutos.length > 500) {
    return { ok: false, mensagem: "Cupom com demasiados itens." };
  }
  const cortar = (v, n) => String(v ?? "").slice(0, n);
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const itens = (itensBrutos || []).map((item) => {
    const row = item && typeof item === "object" ? item : {};
    return {
      nome: cortar(row.nome, 120),
      quantidade: num(row.quantidade),
      precoUnitario: num(row.precoUnitario),
      subtotal: row.subtotal != null ? num(row.subtotal) : undefined,
    };
  });
  const loja =
    bruto.loja && typeof bruto.loja === "object" && !Array.isArray(bruto.loja)
      ? {
          nome: cortar(bruto.loja.nome, 120),
          cnpj: cortar(bruto.loja.cnpj, 32),
          endereco: cortar(bruto.loja.endereco, 200),
          telefone: cortar(bruto.loja.telefone, 40),
        }
      : undefined;
  return {
    ok: true,
    dados: {
      id: cortar(bruto.id, 64),
      criadoEm: bruto.criadoEm,
      funcionarioNome: cortar(bruto.funcionarioNome, 80),
      formaPagamento: cortar(bruto.formaPagamento, 32),
      subtotal: num(bruto.subtotal),
      desconto: num(bruto.desconto),
      total: num(bruto.total),
      valorRecebido: bruto.valorRecebido != null ? num(bruto.valorRecebido) : undefined,
      troco: bruto.troco != null ? num(bruto.troco) : undefined,
      itens,
      loja,
      abrirGaveta: Boolean(bruto.abrirGaveta),
    },
  };
}

/**
 * Dados da loja para o cabecalho do cupom.
 * Prioridade: perfil da loja enviado com a venda (multi-loja) > .env (legado).
 * @param {object} [lojaDaVenda]
 */
function obterDadosLoja(lojaDaVenda) {
  if (lojaDaVenda && typeof lojaDaVenda === "object" && lojaDaVenda.nome) {
    return {
      nome: String(lojaDaVenda.nome),
      cnpj: String(lojaDaVenda.cnpj || ""),
      endereco: String(lojaDaVenda.endereco || ""),
      telefone: String(lojaDaVenda.telefone || ""),
    };
  }
  return {
    nome: process.env.LOJA_NOME || "CybhorPDV",
    cnpj: process.env.LOJA_CNPJ || "",
    endereco: process.env.LOJA_ENDERECO || "",
    telefone: process.env.LOJA_TELEFONE || "",
  };
}

/**
 * @param {Array<{name: string, isDefault?: boolean, status?: number}>} impressoras
 * @returns {string | null}
 */
function escolherImpressora(impressoras) {
  if (!Array.isArray(impressoras) || impressoras.length === 0) {
    const forçada = (process.env.IMPRESSORA_NOME || "").trim();
    return forçada || null;
  }

  const configurada = (process.env.IMPRESSORA_NOME || "").trim().toLowerCase();
  if (configurada) {
    const candidatas = impressoras.filter((p) =>
      String(p.name || "").toLowerCase().includes(configurada)
    );
    const exata = candidatas.find(
      (p) => String(p.name || "").toLowerCase() === configurada
    );
    if (exata) return exata.name;
    // Prefere a impressora sem "(1)", "(2)" etc. (instalacoes duplicadas)
    const principal = candidatas.find(
      (p) => !/\(\d+\)$/.test(String(p.name || "").trim())
    );
    if (principal) return principal.name;
    if (candidatas[0]) return candidatas[0].name;
    return (process.env.IMPRESSORA_NOME || "").trim();
  }

  const jetways = impressoras.filter((p) => {
    const nome = String(p.name || "").toLowerCase();
    return PALAVRAS_JETWAY.some((trecho) => nome.includes(trecho));
  });

  if (jetways.length > 0) {
    const principal = jetways.find(
      (p) => !/\(\d+\)$/.test(String(p.name || "").trim())
    );
    return (principal || jetways[0]).name;
  }

  const padrao = impressoras.find((p) => p.isDefault);
  return padrao?.name || impressoras[0]?.name || null;
}

/**
 * Usa o servidor de impressão aquecido; só cai no caminho antigo (um
 * PowerShell novo por chamada) quando o servidor não consegue subir.
 * @template T
 * @param {() => Promise<T>} viaServidor
 * @param {() => Promise<T>} viaLegado
 * @returns {Promise<T>}
 */
async function comServidorOuLegado(viaServidor, viaLegado) {
  try {
    return await viaServidor();
  } catch (erro) {
    if (erro?.codigo !== "INDISPONIVEL") throw erro;
    console.warn("Servidor de impressão indisponível, usando modo antigo:", erro.message);
    return viaLegado();
  }
}

/**
 * Lista impressoras via WMI (Win7+) quando Chromium devolve lista vazia.
 * @returns {Promise<Array<{name: string, isDefault?: boolean, status?: number}>>}
 */
async function listarImpressorasWinspool() {
  if (process.platform !== "win32") return [];
  try {
    return await comServidorOuLegado(
      () => servidorImpressao.listar(),
      listarImpressorasWinspoolLegado
    );
  } catch (erro) {
    console.warn("Listagem WMI falhou:", erro.message);
    return [];
  }
}

async function listarImpressorasWinspoolLegado() {
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue';",
    "Get-WmiObject Win32_Printer | ForEach-Object {",
    "  $def = if ($_.Default) { '1' } else { '0' };",
    "  Write-Output ($_.Name + '`t' + $def + '`t' + $_.PrinterStatus)",
    "}",
  ].join(" ");
  const resultado = await executar("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    ps,
  ]);
  if (resultado.code !== 0) return [];
  return (resultado.stdout || "")
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha) => {
      const [nome, def, status] = linha.split("\t");
      if (!nome) return null;
      return {
        name: nome,
        isDefault: def === "1",
        status: Number(status) || 0,
      };
    })
    .filter(Boolean);
}

async function listarImpressoras() {
  const janela =
    BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  let lista = [];
  if (janela) {
    try {
      if (typeof janela.webContents.getPrintersAsync === "function") {
        lista = await janela.webContents.getPrintersAsync();
      } else if (typeof janela.webContents.getPrinters === "function") {
        lista = janela.webContents.getPrinters();
      }
    } catch (erro) {
      console.warn("getPrinters falhou:", erro?.message || erro);
      lista = [];
    }
  }
  if ((!lista || lista.length === 0) && process.platform === "win32") {
    const viaSpool = await listarImpressorasWinspool();
    if (viaSpool.length > 0) return viaSpool;
  }
  return Array.isArray(lista) ? lista : [];
}

/**
 * @param {string} comando
 * @param {string[]} args
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
const TIMEOUT_COMANDO_MS = 15000;

function executar(comando, args, timeoutMs = TIMEOUT_COMANDO_MS) {
  return new Promise((resolve) => {
    const filho = spawn(comando, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let finalizado = false;
    const timer = setTimeout(() => {
      if (finalizado) return;
      finalizado = true;
      try {
        filho.kill();
      } catch (_) {
        /* ignore */
      }
      resolve({
        code: 1,
        stdout,
        stderr: (stderr || "") + `Timeout após ${timeoutMs}ms`,
      });
    }, timeoutMs);
    const concluir = (payload) => {
      if (finalizado) return;
      finalizado = true;
      clearTimeout(timer);
      resolve(payload);
    };
    filho.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    filho.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    filho.on("error", (erro) => {
      concluir({ code: 1, stdout, stderr: erro.message });
    });
    filho.on("close", (code) => {
      concluir({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Envia bytes RAW pela porta serial/COM (formaEnvio=0 do exemplo Delphi).
 * @param {string} porta ex: COM3 ou /dev/ttyUSB0
 * @param {Buffer} buffer
 */
async function enviarViaPorta(porta, buffer) {
  const segura = normalizarPortaImpressora(porta);
  if (!segura) {
    throw new Error(
      "Porta da impressora inválida. Use COMx (Windows) ou /dev/ttyUSB* / /dev/usb/lp* (Linux)."
    );
  }
  await fs.promises.writeFile(segura, buffer);
  return { ok: true, impressora: segura, modo: "COM" };
}

/**
 * Caminho do RawPrint.ps1 (fora do asar quando empacotado).
 * @returns {string}
 */
function caminhoScriptRaw() {
  const base = __dirname.includes(`${path.sep}app.asar${path.sep}`)
    ? __dirname.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    : __dirname;
  return path.join(base, "RawPrint.ps1");
}

/**
 * Envia bytes RAW via Winspool WritePrinter (formaEnvio=1 do exemplo Delphi).
 * Se o WritePrinter recusar, tenta o metodo classico `copy /b`.
 * Timeout/queda do servidor sobem como erro: o cupom pode ja estar no spooler
 * e reenviar imprimiria em dobro.
 * @param {string} nomeImpressora
 * @param {Buffer} buffer
 */
async function enviarViaWritePrinter(nomeImpressora, buffer) {
  try {
    await servidorImpressao.imprimirRaw(nomeImpressora, buffer);
    return { ok: true, impressora: nomeImpressora, modo: "RAW" };
  } catch (erro) {
    if (erro?.codigo === "INDISPONIVEL") {
      console.warn("Servidor de impressão indisponível, usando modo antigo:", erro.message);
      return enviarViaWritePrinterLegado(nomeImpressora, buffer);
    }
    if (erro?.codigo !== "ERRO") throw erro;
    console.warn("WritePrinter falhou, tentando copy /b:", erro.message);
    const resultadoCopy = await enviarBufferViaCopyBinario(nomeImpressora, buffer);
    if (resultadoCopy.ok) return resultadoCopy;
    throw new Error(`${erro.message} | ${resultadoCopy.mensagem || "copy /b falhou"}`);
  }
}

async function enviarBufferViaCopyBinario(nomeImpressora, buffer) {
  const tmp = path.join(os.tmpdir(), `cybhor-cupom-${Date.now()}-${process.pid}.bin`);
  await fs.promises.writeFile(tmp, buffer);
  try {
    return await enviarViaCopyBinario(nomeImpressora, tmp);
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}

async function enviarViaWritePrinterLegado(nomeImpressora, buffer) {
  const tmp = path.join(
    os.tmpdir(),
    `cybhor-cupom-${Date.now()}-${process.pid}.bin`
  );
  const script = caminhoScriptRaw();

  if (!fs.existsSync(script)) {
    throw new Error(`Script RAW nao encontrado: ${script}`);
  }

  await fs.promises.writeFile(tmp, buffer);

  try {
    const resultado = await executar("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-PrinterName",
      nomeImpressora,
      "-FilePath",
      tmp,
    ]);

    if (resultado.code === 0 && resultado.stdout.includes("OK:")) {
      return { ok: true, impressora: nomeImpressora, modo: "RAW" };
    }

    const detalheRaw =
      (resultado.stderr || resultado.stdout || "Falha no WritePrinter RAW").trim();
    console.warn("WritePrinter falhou, tentando copy /b:", detalheRaw);

    const resultadoCopy = await enviarViaCopyBinario(nomeImpressora, tmp);
    if (resultadoCopy.ok) return resultadoCopy;

    throw new Error(`${detalheRaw} | ${resultadoCopy.mensagem || "copy /b falhou"}`);
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}

/**
 * Fallback classico Windows: copy /b arquivo "\\localhost\NomeDaImpressora"
 * Funciona bem quando o driver aceita RAW mas o WritePrinter da erro na fila.
 * @param {string} nomeImpressora
 * @param {string} caminhoArquivo
 */
async function enviarViaCopyBinario(nomeImpressora, caminhoArquivo) {
  const destino = `\\\\localhost\\${nomeImpressora}`;
  const resultado = await executar("cmd.exe", [
    "/c",
    "copy",
    "/b",
    caminhoArquivo,
    destino,
  ]);

  if (resultado.code === 0) {
    return { ok: true, impressora: nomeImpressora, modo: "COPY" };
  }

  return {
    ok: false,
    mensagem: (resultado.stderr || resultado.stdout || "copy /b falhou").trim(),
  };
}

/**
 * Fallback GDI/HTML (quando RAW nao estiver disponivel).
 * @param {object} dadosVenda
 * @param {string} deviceName
 */
async function imprimirViaHtml(dadosVenda, deviceName) {
  const html = gerarHtmlCupom(dadosVenda, obterDadosLoja(dadosVenda.loja));
  const janela = new BrowserWindow({
    show: false,
    width: 302,
    height: 800,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await janela.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    );

    await new Promise((resolve) => {
      if (janela.webContents.isLoading()) {
        janela.webContents.once("did-finish-load", resolve);
      } else {
        resolve();
      }
    });

    await new Promise((resolve, reject) => {
      janela.webContents.print(
        {
          silent: true,
          printBackground: false,
          deviceName,
          copies: 1,
          margins: { marginType: "none" },
          pagesPerSheet: 1,
          collate: false,
          scaleFactor: 100,
        },
        (sucesso, motivoFalha) => {
          if (sucesso) resolve();
          else
            reject(
              new Error(motivoFalha || "Falha ao enviar para a impressora.")
            );
        }
      );
    });

    return { ok: true, impressora: deviceName, modo: "HTML" };
  } finally {
    if (!janela.isDestroyed()) janela.close();
  }
}

/**
 * Modo de desenvolvimento/teste: grava o binario ESC/POS em disco.
 * @param {Buffer} buffer
 */
async function gravarCupomTeste(buffer) {
  const pasta =
    process.env.IMPRESSORA_TESTE_DIR ||
    path.join(os.tmpdir(), "cybhor-jp800-teste");
  await fs.promises.mkdir(pasta, { recursive: true });
  const arquivo = path.join(pasta, `cupom-${Date.now()}.bin`);
  await fs.promises.writeFile(arquivo, buffer);
  const texto = path.join(pasta, `cupom-${Date.now()}.txt`);
  // Representacao legivel (substitui ESC/GS por marcadores)
  const legivel = buffer
    .toString("latin1")
    .replace(/\x1b/g, "<ESC>")
    .replace(/\x1d/g, "<GS>")
    .replace(/\n/g, "\n");
  await fs.promises.writeFile(texto, legivel, "utf8");
  // Não devolve caminhos absolutos ao renderer (evita vazar layout do disco).
  return {
    ok: true,
    impressora: path.basename(arquivo),
    modo: "TESTE",
  };
}

/**
 * Verifica no Windows se a impressora esta Offline/erro antes de enviar o job.
 * @param {string} nomeImpressora
 * @returns {Promise<{problema: boolean, mensagem?: string} | null>}
 */
async function diagnosticarImpressoraWindows(nomeImpressora) {
  let saida;
  try {
    saida = await comServidorOuLegado(
      () => servidorImpressao.diagnosticar(nomeImpressora),
      () => diagnosticarImpressoraLegado(nomeImpressora)
    );
  } catch (erro) {
    console.warn("Diagnóstico da impressora indisponível:", erro.message);
    return null;
  }
  return interpretarDiagnostico(String(saida || "").trim(), nomeImpressora);
}

async function diagnosticarImpressoraLegado(nomeImpressora) {
  // Get-Printer é Win8+; Win32_Printer via WMI funciona no Windows 7 SP1.
  const nomeEsc = String(nomeImpressora).replace(/'/g, "''");
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue';",
    `$p = Get-WmiObject Win32_Printer | Where-Object { $_.Name -eq '${nomeEsc}' } | Select-Object -First 1;`,
    "if (-not $p) { Write-Output 'MISSING'; exit 0 };",
    "Write-Output ('STATUS=' + $p.PrinterStatus + ';PORT=' + $p.PortName + ';WORKOFFLINE=' + $p.WorkOffline)",
  ].join(" ");

  const resultado = await executar("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    ps,
  ]);
  return `${resultado.stdout || ""}${resultado.stderr || ""}`;
}

/**
 * @param {string} saida "MISSING" | "STATUS=..;PORT=..;WORKOFFLINE=.." | erro
 * @param {string} nomeImpressora
 * @returns {{problema: boolean, mensagem?: string} | null}
 */
function interpretarDiagnostico(saida, nomeImpressora) {
  if (!saida || /Get-WmiObject|Win32_Printer|não reconhecido|not recognized/i.test(saida)) {
    // Diagnóstico indisponível — não fingir que está tudo ok.
    return null;
  }
  if (saida.includes("MISSING")) {
    return {
      problema: true,
      mensagem:
        `Impressora "${nomeImpressora}" nao encontrada. Rode scripts\\reparar-jp800.ps1 e reinstale o driver Jetway (USB).`,
    };
  }

  const statusMatch = /STATUS=([^;]+)/i.exec(saida);
  const offlineMatch = /WORKOFFLINE=([^;\s]+)/i.exec(saida);
  const statusNum = Number(statusMatch?.[1]);
  const workOffline = String(offlineMatch?.[1] || "").toLowerCase() === "true";
  // PrinterStatus CIM: 7=Offline, 1=Other; WorkOffline=true também bloqueia.
  const statusRuim = workOffline || statusNum === 7 || statusNum === 1;
  if (statusRuim) {
    const rotulo = workOffline ? "offline" : statusMatch?.[1] || "erro";
    return {
      problema: true,
      mensagem:
        `A impressora "${nomeImpressora}" esta com status "${rotulo}" no Windows. ` +
        `Verifique cabo USB, energia, papel e tampa. Remova impressoras Jetway duplicadas e rode scripts\\reparar-jp800.ps1.`,
    };
  }

  return { problema: false };
}

const VALIDADE_IMPRESSORA_CUPOM_MS = 5 * 60 * 1000;
let impressoraCupomEmCache = { nome: "", configurada: "", expiraEm: 0 };

/**
 * Impressora do cupom, com cache curto: listar impressoras a cada venda custava
 * uma consulta WMI inteira. Invalidado quando a impressao falha ou a config muda.
 * @returns {Promise<string>}
 */
async function resolverImpressoraCupom() {
  const configurada = (process.env.IMPRESSORA_NOME || "").trim();
  const cache = impressoraCupomEmCache;
  if (cache.nome && cache.configurada === configurada && Date.now() < cache.expiraEm) {
    return cache.nome;
  }
  const impressoras = await listarImpressoras();
  const nome = escolherImpressora(impressoras) || configurada || "Jetway JP-800";
  impressoraCupomEmCache = {
    nome,
    configurada,
    expiraEm: Date.now() + VALIDADE_IMPRESSORA_CUPOM_MS,
  };
  return nome;
}

function esquecerImpressoraCupom() {
  impressoraCupomEmCache = { nome: "", configurada: "", expiraEm: 0 };
}

/**
 * Imprime o comprovante na JP-800 no mesmo modelo do exemplo Delphi:
 * 1) Porta COM/serial se IMPRESSORA_PORTA estiver definida
 * 2) WritePrinter RAW no Windows (driver Jetway JP-800)
 * 3) Fallback HTML silencioso
 * 4) Em Linux/dev: grava arquivo de teste se IMPRESSORA_MODO=teste
 *
 * @param {object} dadosVenda
 * @returns {Promise<{ok: boolean, impressora?: string, mensagem?: string, modo?: string}>}
 */
async function imprimirCupomVenda(dadosVenda) {
  const validacao = validarDadosVendaCupom(dadosVenda);
  if (!validacao.ok) {
    return { ok: false, mensagem: validacao.mensagem };
  }
  dadosVenda = validacao.dados;
  const loja = obterDadosLoja(dadosVenda.loja);
  const buffer = gerarBufferEscPos(dadosVenda, loja);
  const modoForcado = (process.env.IMPRESSORA_MODO || "").trim().toLowerCase();

  if (modoForcado === "teste" || modoForcado === "test") {
    return gravarCupomTeste(buffer);
  }

  const porta = normalizarPortaImpressora(process.env.IMPRESSORA_PORTA || "");
  if (porta) {
    try {
      return await enviarViaPorta(porta, buffer);
    } catch (erro) {
      return {
        ok: false,
        mensagem: `Falha ao enviar pela porta ${porta}: ${erro.message}`,
      };
    }
  }

  const deviceName = await resolverImpressoraCupom();

  // Diagnostico rapido via PowerShell (Windows): se a fila esta Offline/erro,
  // nao adianta enviar — devolve mensagem clara para o operador.
  if (process.platform === "win32") {
    const diagnostico = await diagnosticarImpressoraWindows(deviceName);
    if (diagnostico && diagnostico.problema) {
      esquecerImpressoraCupom();
      return {
        ok: false,
        impressora: deviceName,
        mensagem: diagnostico.mensagem,
      };
    }
  }

  if (process.platform === "win32" && modoForcado !== "html") {
    try {
      return await enviarViaWritePrinter(deviceName, buffer);
    } catch (erroRaw) {
      esquecerImpressoraCupom();
      if (erroRaw?.codigo === "TIMEOUT" || erroRaw?.codigo === "ENCERRADO") {
        return {
          ok: false,
          impressora: deviceName,
          mensagem:
            "A impressora nao respondeu. Confira cabo, energia e papel antes de tentar de novo.",
        };
      }
      console.warn("RAW WritePrinter falhou, tentando HTML:", erroRaw.message);
      try {
        return await imprimirViaHtml(dadosVenda, deviceName);
      } catch (erroHtml) {
        return {
          ok: false,
          mensagem: `RAW: ${erroRaw.message} | HTML: ${erroHtml.message}`,
        };
      }
    }
  }

  if (modoForcado === "html") {
    try {
      return await imprimirViaHtml(dadosVenda, deviceName);
    } catch (erro) {
      return { ok: false, mensagem: erro.message };
    }
  }

  // Fora do Windows sem porta: gera arquivo para inspecao (simula impressao).
  const teste = await gravarCupomTeste(buffer);
  return {
    ...teste,
    mensagem:
      "Ambiente nao-Windows: cupom ESC/POS gravado em arquivo de teste. No Windows use o driver Jetway JP-800.",
  };
}

/** Aquece o servidor de impressão para o primeiro cupom não pagar a inicialização. */
function prepararImpressao() {
  if (process.platform !== "win32") return;
  servidorImpressao.iniciar().catch((erro) => {
    console.warn("Servidor de impressão não iniciou:", erro.message);
  });
}

module.exports = {
  imprimirCupomVenda,
  prepararImpressao,
  encerrarImpressao: servidorImpressao.encerrar,
  validarDadosVendaCupom,
  escolherImpressora,
  listarImpressoras,
  obterDadosLoja,
  gerarBufferEscPos,
};
