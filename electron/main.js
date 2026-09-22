"use strict";

const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { imprimirCupomVenda } = require("./impressao/imprimirCupom");
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

const { consultarAssistente } = require("./assistenteGemini");

// Win7 / GPUs antigas: evita tela preta ou crash na abertura.
try {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
} catch {
  /* versoes antigas do Electron */
}

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
 * Hosts permitidos para shell.openExternal (Mercado Pago + API oficial).
 * @param {string} hostname
 * @returns {boolean}
 */
function hostExternoPermitido(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  const sufixos = [
    "mercadopago.com",
    "mercadopago.com.br",
    "mlstatic.com",
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
 * Electron 22 (Win7) precisa do bypass de certificado; Electron 23+ usa verificação normal.
 * @returns {boolean}
 */
function precisaBypassCertificadoLegacy() {
  const major = Number.parseInt(String(process.versions.electron || "0").split(".")[0], 10);
  return Number.isFinite(major) && major <= 22;
}

function carregarVariaveisDeAmbiente() {
  const candidatos = [
    path.join(__dirname, "..", ".env"),
    path.join(process.resourcesPath || "", ".env"),
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
}

function criarJanela() {
  const config = obterConfigApp();
  const janela = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: config.tema === "claro" ? "#f4f7fb" : "#07111f",
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
  janela.setTitle("CybhorPDV 2.1");
  janela.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

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
      "CybhorPDV",
      "Nao foi possivel carregar a interface (" + codigo + "). Reinstale o aplicativo."
    );
  });

  janela.webContents.on("render-process-gone", (_e, details) => {
    console.error("Renderer encerrado:", details);
    dialog.showErrorBox(
      "CybhorPDV",
      "O aplicativo fechou inesperadamente. No Windows 7 use o instalador win7 (nao o win10) e confira se ha SP1 instalado."
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

ipcMain.handle("listar-impressoras", async () => {
  try {
    const janela =
      BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!janela) return { ok: true, impressoras: [] };
    const lista = await janela.webContents.getPrintersAsync();
    return {
      ok: true,
      impressoras: (lista || []).map((p) => ({
        nome: p.name,
        padrao: Boolean(p.isDefault),
        status: p.status,
      })),
    };
  } catch (erro) {
    return {
      ok: false,
      impressoras: [],
      mensagem: erro?.message || "Falha ao listar impressoras.",
    };
  }
});

ipcMain.handle("imprimir-cupom", async (_evento, dadosVenda) => {
  try {
    return await imprimirCupomVenda(dadosVenda || {});
  } catch (erro) {
    console.error("Falha na impressão do cupom:", erro);
    return {
      ok: false,
      mensagem: erro?.message || "Não foi possível imprimir o cupom.",
    };
  }
});

ipcMain.handle("obter-licenca", async () => {
  let local = lerLicenca();
  if (!local && process.env.CYBHOR_MODO_DEV === "1") {
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

ipcMain.handle("consultar-assistente", async (_evento, payload) => {
  try {
    return await consultarAssistente(payload || {});
  } catch (erro) {
    console.error("assistente:", erro);
    return {
      ok: false,
      mensagem: erro?.message || "Falha ao consultar a IA.",
    };
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
  // Bypass de certificado só no Electron legado (<=22 / Win7). No 23+
  // (Win10) a verificação normal do Chromium já cobre Let's Encrypt.
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
  criarJanela();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
