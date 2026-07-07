"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

/**
 * Carrega as variaveis de ambiente do arquivo .env.
 * Em desenvolvimento o arquivo fica na raiz do projeto; empacotado no .exe
 * ele e copiado para a pasta de recursos (process.resourcesPath).
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
 * Monta o objeto de configuracao do Firebase a partir das variaveis de ambiente.
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
    backgroundColor: "#0c1a2e",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  janela.setMenuBarVisibility(false);
  janela.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  janela.once("ready-to-show", () => janela.show());
}

carregarVariaveisDeAmbiente();

ipcMain.handle("obter-config-firebase", () => obterConfiguracaoFirebase());

app.whenReady().then(() => {
  criarJanela();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
