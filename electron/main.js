"use strict";

const { app, BrowserWindow, ipcMain, shell } = require("electron");
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
const { validarLicencaRemota, obterUrlApi } = require("./licencaApi");

const { consultarAssistente } = require("./assistenteGemini");

/**
 * Carrega as variáveis de ambiente do arquivo .env.
 */
function carregarVariaveisDeAmbiente() {
  const caminhoDev = path.join(__dirname, "..", ".env");
  const caminhoProd = path.join(process.resourcesPath || "", ".env");
  const caminho = fs.existsSync(caminhoDev) ? caminhoDev : caminhoProd;

  if (fs.existsSync(caminho)) {
    require("dotenv").config({ path: caminho });
  }
}

/**
 * @returns {Record<string, string>}
 */
function obterConfiguracaoFirebase() {
  return {
    apiKey: process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    databaseURL: process.env.FIREBASE_DATABASE_URL || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.FIREBASE_APP_ID || "",
  };
}

function criarJanela() {
  const janela = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: "#07111f",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  janela.setMenuBarVisibility(false);
  janela.setTitle("CybhorPDV 2.0");
  janela.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  janela.once("ready-to-show", () => janela.show());
}

carregarVariaveisDeAmbiente();

ipcMain.handle("obter-config-firebase", () => obterConfiguracaoFirebase());

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
  const local = lerLicenca();
  if (!local) return { ok: false, ativada: false };

  // Revalida online quando possível (licença suspensa bloqueia)
  if (local.chave && process.env.CYBHOR_MODO_DEV !== "1") {
    const remota = await validarLicencaRemota(local.chave);
    if (!remota.ok) {
      return {
        ok: false,
        ativada: false,
        mensagem: remota.mensagem || "Licença inválida ou suspensa.",
      };
    }
    if (remota.lojaId && remota.lojaId !== local.lojaId) {
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
  const texto = String(url || "").trim();
  if (!/^https?:\/\//i.test(texto)) {
    return { ok: false, mensagem: "URL inválida." };
  }
  await shell.openExternal(texto);
  return { ok: true };
});

app.whenReady().then(() => {
  carregarConfigApp();
  criarJanela();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
