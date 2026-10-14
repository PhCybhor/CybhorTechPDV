/**
 * Catálogo dos instaladores do CybhorPDV publicados no servidor.
 *
 * Layout mantido pelo script de publicação:
 *   downloads/versoes/<versao>/CybhorPDV-Setup-*.exe
 *   downloads/versoes/<versao>/info.json      {"versao", "publicado_em"}
 *   downloads/CybhorPDV-Setup-*.exe           cópias da versão mais nova
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { config, PASTA_BACKEND } from "../config.js";
import { ErroNegocio } from "../erros.js";

const INSTALADORES = Object.freeze([
  { id: "win10-x64", arquivo: "CybhorPDV-Setup-win10-x64.exe", rotulo: "Windows 10 / 11 (64 bits)", so: "win10" },
  { id: "win7-x64", arquivo: "CybhorPDV-Setup-win7-x64.exe", rotulo: "Windows 7 (64 bits)", so: "win7" },
  { id: "win7-ia32", arquivo: "CybhorPDV-Setup-win7-ia32.exe", rotulo: "Windows 7 (32 bits)", so: "win7" },
]);

const ARQUIVOS_PERMITIDOS = new Set(INSTALADORES.map((item) => item.arquivo));
const VERSAO_VALIDA = /^\d{1,3}\.\d{1,4}\.\d{1,4}$/;

function ehPasta(caminho) {
  try {
    return statSync(caminho).isDirectory();
  } catch {
    return false;
  }
}

function ehArquivo(caminho) {
  try {
    return statSync(caminho).isFile();
  } catch {
    return false;
  }
}

function pastaDownloads() {
  const candidatos = [
    config.pastaDownloads,
    "/app/downloads",
    path.join(PASTA_BACKEND, "downloads"),
    "/home/cybhorpdv/downloads",
  ].filter(Boolean);
  return candidatos.find(ehPasta) || candidatos[0];
}

function compararVersoesDesc(versaoA, versaoB) {
  const partesA = versaoA.split(".").map(Number);
  const partesB = versaoB.split(".").map(Number);
  for (let indice = 0; indice < 3; indice += 1) {
    if (partesA[indice] !== partesB[indice]) return partesB[indice] - partesA[indice];
  }
  return 0;
}

/** Versões em disco, da mais nova para a mais antiga. */
function versoesPublicadas(pastaVersoes) {
  if (!ehPasta(pastaVersoes)) return [];
  return readdirSync(pastaVersoes, { withFileTypes: true })
    .filter((item) => item.isDirectory() && VERSAO_VALIDA.test(item.name))
    .map((item) => item.name)
    .sort(compararVersoesDesc);
}

function dataPublicacao(pastaVersao) {
  try {
    const info = JSON.parse(readFileSync(path.join(pastaVersao, "info.json"), "utf8"));
    const data = typeof info?.publicado_em === "string" ? new Date(info.publicado_em) : null;
    if (data && !Number.isNaN(data.getTime())) return data.toISOString();
  } catch {
    // Pastas antigas ou info.json corrompido: a data do diretório é uma boa aproximação.
  }
  return statSync(pastaVersao).mtime.toISOString();
}

function montarVersao(pastaVersao, versao) {
  const instaladores = INSTALADORES.filter((item) => ehArquivo(path.join(pastaVersao, item.arquivo))).map((item) => ({
    ...item,
    tamanho_bytes: statSync(path.join(pastaVersao, item.arquivo)).size,
    url: `/api/site/baixar/${versao}/${item.arquivo}`,
  }));
  if (!instaladores.length) return null;
  return { versao, publicado_em: dataPublicacao(pastaVersao), instaladores };
}

/** Instaladores soltos na raiz (servidor ainda sem pasta versoes/). */
function montarAvulsos(pasta) {
  const instaladores = INSTALADORES.filter((item) => ehArquivo(path.join(pasta, item.arquivo))).map((item) => ({
    ...item,
    tamanho_bytes: statSync(path.join(pasta, item.arquivo)).size,
    url: `/api/site/baixar/${item.arquivo}`,
  }));
  return instaladores.length ? { versao: null, publicado_em: null, instaladores } : null;
}

/** Versão atual em destaque e as anteriores (mais nova primeiro). */
export function listarInstaladores() {
  const pasta = pastaDownloads();
  const pastaVersoes = path.join(pasta, "versoes");
  const versoes = versoesPublicadas(pastaVersoes)
    .map((versao) => montarVersao(path.join(pastaVersoes, versao), versao))
    .filter(Boolean);
  const atual = versoes[0] || montarAvulsos(pasta);
  return { ok: true, atual, anteriores: versoes.slice(1), instaladores: atual ? atual.instaladores : [] };
}

/**
 * Resolve o arquivo pedido; sem versão entrega o mais novo publicado.
 * Só nomes da lista fixa: impede path traversal pelo parâmetro da URL.
 * @returns {string} caminho absoluto do instalador.
 */
export function caminhoInstalador(arquivo, versao = null) {
  const nome = path.basename(String(arquivo || ""));
  if (nome !== arquivo || !ARQUIVOS_PERMITIDOS.has(nome)) throw new ErroNegocio("Arquivo invalido.", 404);

  const pasta = pastaDownloads();
  let caminho;
  if (versao === null) {
    caminho = path.join(pasta, nome);
  } else {
    if (!VERSAO_VALIDA.test(versao || "")) throw new ErroNegocio("Versao invalida.", 404);
    caminho = path.join(pasta, "versoes", versao, nome);
  }

  if (!existsSync(caminho) || !ehArquivo(caminho)) {
    throw new ErroNegocio("Instalador ainda nao publicado neste servidor.", 404);
  }
  return caminho;
}
