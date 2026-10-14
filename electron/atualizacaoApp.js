"use strict";

const { app } = require("electron");
const { requisitarJson } = require("./httpJson");
const { obterUrlApi } = require("./licencaApi");

/**
 * Compara versões "3.0.10" x "3.0.9" numericamente (ignora sufixos como "-beta").
 * @param {string} a
 * @param {string} b
 * @returns {number} >0 se a for mais nova, <0 se b for mais nova, 0 se iguais
 */
function compararVersoes(a, b) {
  const partes = (versao) =>
    String(versao || "")
      .split("-")[0]
      .split(".")
      .map((parte) => Number.parseInt(parte, 10) || 0);
  const pa = partes(a);
  const pb = partes(b);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i += 1) {
    const diferenca = (pa[i] || 0) - (pb[i] || 0);
    if (diferenca !== 0) return diferenca;
  }
  return 0;
}

/**
 * Um instalador por arquitetura atende Windows 7 a 11; o aviso aponta para o
 * da arquitetura desta instalação sem perguntar ao operador.
 * @returns {string}
 */
function idInstaladorDestaInstalacao() {
  return process.arch === "ia32" ? "windows-ia32" : "windows-x64";
}

/**
 * Consulta a versão publicada no painel do cliente.
 * @returns {Promise<{ ok: boolean, disponivel: boolean, versaoAtual?: string, versaoNova?: string, publicadoEm?: string | null, urlDownload?: string }>}
 */
async function verificarAtualizacao() {
  const base = obterUrlApi().replace(/\/+$/, "");
  const resposta = await requisitarJson(`${base}/api/site/downloads`, {
    headers: { Accept: "application/json" },
  });
  const atual = resposta.ok ? resposta.dados?.atual : null;
  if (!atual?.versao) return { ok: false, disponivel: false };

  const versaoAtual = app.getVersion();
  const versaoNova = String(atual.versao);
  const instaladores = Array.isArray(atual.instaladores) ? atual.instaladores : [];
  const instalador = instaladores.find((item) => item?.id === idInstaladorDestaInstalacao());
  const urlDownload = instalador?.url
    ? new URL(String(instalador.url), `${base}/`).href
    : `${base}/painel.html`;

  return {
    ok: true,
    disponivel: compararVersoes(versaoNova, versaoAtual) > 0,
    versaoAtual,
    versaoNova,
    publicadoEm: atual.publicado_em || null,
    urlDownload,
  };
}

module.exports = { verificarAtualizacao, compararVersoes };
