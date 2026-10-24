"use strict";

const { app } = require("electron");
const { requisitarJson } = require("./httpJson");
const { obterUrlApi, API_URL_PRODUCAO } = require("./licencaApi");

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
 * IDs do instalador desta máquina, do mais novo ao legado (3.2.0 usava win10/win7).
 * @returns {string[]}
 */
function idsInstaladorDestaInstalacao() {
  if (process.arch === "ia32") {
    return ["windows-ia32", "win7-ia32"];
  }
  return ["windows-x64", "win10-x64", "win7-x64"];
}

/**
 * Bases a consultar: Hostinger oficial primeiro; depois a URL embutida no .exe
 * (apps antigos ainda apontam para a VPS). Ganha a lista com a versão mais alta.
 * @returns {string[]}
 */
function basesConsultaDownloads() {
  const vistas = new Set();
  const bases = [];
  for (const candidata of [API_URL_PRODUCAO, obterUrlApi()]) {
    const limpa = String(candidata || "")
      .trim()
      .replace(/\/+$/, "");
    if (!limpa || vistas.has(limpa)) continue;
    vistas.add(limpa);
    bases.push(limpa);
  }
  return bases;
}

/**
 * @param {string} base
 * @returns {Promise<{ base: string, atual: object } | null>}
 */
async function buscarListaDownloads(base) {
  try {
    const resposta = await requisitarJson(`${base}/api/site/downloads`, {
      headers: { Accept: "application/json" },
    });
    const atual = resposta.ok ? resposta.dados?.atual : null;
    if (!atual?.versao) return null;
    return { base, atual };
  } catch (_erro) {
    return null;
  }
}

/**
 * Consulta a versão publicada no painel do cliente.
 * @returns {Promise<{ ok: boolean, disponivel: boolean, versaoAtual?: string, versaoNova?: string, publicadoEm?: string | null, urlDownload?: string }>}
 */
async function verificarAtualizacao() {
  const resultados = await Promise.all(basesConsultaDownloads().map(buscarListaDownloads));
  const validos = resultados.filter(Boolean);
  if (!validos.length) return { ok: false, disponivel: false };

  validos.sort((a, b) => compararVersoes(b.atual.versao, a.atual.versao));
  const { atual } = validos[0];
  // Download sempre na Hostinger — mesmo se a versão foi descoberta na VPS antiga.
  const baseDownload = API_URL_PRODUCAO.replace(/\/+$/, "");

  const versaoAtual = app.getVersion();
  const versaoNova = String(atual.versao);
  const instaladores = Array.isArray(atual.instaladores) ? atual.instaladores : [];
  const ids = idsInstaladorDestaInstalacao();
  const instalador = instaladores.find((item) => ids.includes(String(item?.id || "")));
  const urlDownload = instalador?.url
    ? new URL(String(instalador.url), `${baseDownload}/`).href
    : `${baseDownload}/painel.html`;

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
