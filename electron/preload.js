"use strict";

const { contextBridge, ipcRenderer } = require("electron");

/**
 * Ponte segura entre o processo principal e o renderer.
 */
contextBridge.exposeInMainWorld("pdvAPI", {
  obterVersaoApp: () => ipcRenderer.invoke("obter-versao-app"),
  obterApiUrl: () => ipcRenderer.invoke("obter-api-url"),
  testarConexaoApi: () => ipcRenderer.invoke("testar-conexao-api"),
  obterConfigApp: () => ipcRenderer.invoke("obter-config-app"),
  salvarConfigApp: (config) => ipcRenderer.invoke("salvar-config-app", config),
  listarImpressoras: () => ipcRenderer.invoke("listar-impressoras"),
  imprimirCupom: (dadosVenda) => ipcRenderer.invoke("imprimir-cupom", dadosVenda),
  obterLicenca: () => ipcRenderer.invoke("obter-licenca"),
  ativarLicenca: (chave) => ipcRenderer.invoke("ativar-licenca", chave),
  limparLicenca: () => ipcRenderer.invoke("limpar-licenca"),
  consultarAssistente: (payload) =>
    ipcRenderer.invoke("consultar-assistente", payload),
  abrirExterno: (url) => ipcRenderer.invoke("abrir-externo", url),
});
