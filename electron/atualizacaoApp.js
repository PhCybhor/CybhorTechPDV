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
 * O build do Windows 7 roda no Electron 22; o de Windows 10/11 em versões mais novas.
 * Assim o aviso aponta para o instalador certo sem perguntar ao operador.
 * @returns {string}
 */
function idInstaladorDestaInstalacao() {
  const major = Number.parseInt(String(process.versions.electron || "0").split(".")[0], 10);
  if (major <= 22) return process.arch === "ia32" ? "win7-ia32" : "win7-x64";
  return "win10-x64";
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
