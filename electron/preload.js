"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * Ponte segura entre o processo principal e o renderer.
 * Expoe apenas o necessario, sem dar acesso direto ao Node no front-end,
 * mantendo as credenciais fora do codigo do renderer.
 */
contextBridge.exposeInMainWorld("pdvAPI", {
  obterConfigFirebase: () => ipcRenderer.invoke("obter-config-firebase"),
});
