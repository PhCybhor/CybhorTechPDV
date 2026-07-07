"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

let configuracaoFirebase = null;

/**
 * Carrega a configuracao do Firebase embutida no instalador.
 * Em desenvolvimento usa build/firebase.config.json (gerado a partir do .env).
 * O usuario final nunca precisa ver ou editar o .env.
 *
 * @returns {object | null}
 */
function carregarConfiguracaoFirebase() {
  if (configuracaoFirebase) return configuracaoFirebase;

  const caminhos = [
    path.join(process.resourcesPath || "", "firebase.config.json"),
    path.join(__dirname, "..", "build", "firebase.config.json"),
  ];

  for (const caminho of caminhos) {
    if (!fs.existsSync(caminho)) continue;
    try {
      configuracaoFirebase = JSON.parse(fs.readFileSync(caminho, "utf8"));
      return configuracaoFirebase;
    } catch {
      console.error("Falha ao ler configuracao do Firebase em", caminho);
    }
  }

  return null;
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

ipcMain.handle("obter-config-firebase", () => carregarConfiguracaoFirebase() || {});

app.whenReady().then(() => {
  criarJanela();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
