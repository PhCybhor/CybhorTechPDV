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
  iaListarJournal: (limite) => ipcRenderer.invoke("ia-listar-journal", limite),
  iaDesfazer: (id) => ipcRenderer.invoke("ia-desfazer", id),
  iaConfirmarAcaoResposta: (token, aceitar) =>
    ipcRenderer.invoke("ia-confirmar-acao-resposta", { token, aceitar }),
  onIaConfirmarAcao: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on("ia-confirmar-acao", listener);
    return () => ipcRenderer.removeListener("ia-confirmar-acao", listener);
  },
  onIaExecutarComando: (cb) => {
    const listener = (_e, data) => cb(data);
    ipcRenderer.on("ia-executar-comando", listener);
    return () => ipcRenderer.removeListener("ia-executar-comando", listener);
  },
  iaExecutarComandoResultado: (payload) =>
    ipcRenderer.send("ia-executar-comando-resultado", payload),
  iaIndexarLoja: (snapshot) => ipcRenderer.invoke("ia-indexar-loja", snapshot),
  abrirExterno: (url) => ipcRenderer.invoke("abrir-externo", url),
  lerFilaOffline: () => ipcRenderer.invoke("ler-fila-offline"),
  gravarFilaOffline: (fila) => ipcRenderer.invoke("gravar-fila-offline", fila),
  verificarAtualizacao: () => ipcRenderer.invoke("verificar-atualizacao"),
});
