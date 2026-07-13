"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * Ponte segura entre o processo principal e o renderer.
 * Expoe apenas o necessario, sem dar acesso direto ao Node no front-end,
 * mantendo as credenciais fora do codigo do renderer.
 */
contextBridge.exposeInMainWorld("pdvAPI", {
  obterConfigFirebase: () => ipcRenderer.invoke("obter-config-firebase"),
  /**
   * Envia o comprovante de venda para a impressora Jetway.
   * @param {object} dadosVenda
   * @returns {Promise<{ok: boolean, impressora?: string, mensagem?: string}>}
   */
  imprimirCupom: (dadosVenda) => ipcRenderer.invoke("imprimir-cupom", dadosVenda),
});
