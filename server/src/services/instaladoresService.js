/**
 * Catálogo dos instaladores do CybhorPDV publicados no servidor.
 *
 * Layout mantido pelo script de publicação da VPS (backend/deploy):
 *   downloads/versoes/<versao>/CybhorPDV-Setup-*.exe
 *   downloads/versoes/<versao>/info.json      {"versao", "publicado_em"}
 *   downloads/CybhorPDV-Setup-*.exe           hardlinks da versão mais nova
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { config, DIRETORIO_SERVER } from '../config.js';
import { ErroNegocio } from '../errors.js';

// Desde a 3.2 um instalador (Electron 22) atende Windows 7, 8, 10 e 11.
// Os win10/win7 continuam listados para as versões antigas ainda publicadas.
const INSTALADORES = Object.freeze([
  { id: 'windows-x64', arquivo: 'CybhorPDV-Setup-x64.exe', rotulo: 'Windows 7, 8, 10 e 11 (64 bits)', so: 'windows' },
  { id: 'windows-ia32', arquivo: 'CybhorPDV-Setup-ia32.exe', rotulo: 'Windows 7, 8, 10 e 11 (32 bits)', so: 'windows' },
  { id: 'win10-x64', arquivo: 'CybhorPDV-Setup-win10-x64.exe', rotulo: 'Windows 10 / 11 (64 bits)', so: 'win10' },
  { id: 'win7-x64', arquivo: 'CybhorPDV-Setup-win7-x64.exe', rotulo: 'Windows 7 (64 bits)', so: 'win7' },
  { id: 'win7-ia32', arquivo: 'CybhorPDV-Setup-win7-ia32.exe', rotulo: 'Windows 7 (32 bits)', so: 'win7' },
]);

const ARQUIVOS_PERMITIDOS = new Set(INSTALADORES.map((item) => item.arquivo));

// Links antigos sem versão (/api/site/baixar/<arquivo>) continuam entregando o mais novo.
const SUBSTITUTOS_LEGADOS = Object.freeze({
  'CybhorPDV-Setup-win10-x64.exe': 'CybhorPDV-Setup-x64.exe',
  'CybhorPDV-Setup-win7-x64.exe': 'CybhorPDV-Setup-x64.exe',
  'CybhorPDV-Setup-win7-ia32.exe': 'CybhorPDV-Setup-ia32.exe',
});

const VERSAO_VALIDA = /^\d{1,3}\.\d{1,4}\.\d{1,4}$/;

async function ehDiretorio(caminho) {
  try {
    return (await stat(caminho)).isDirectory();
  } catch {
    return false;
  }
}

async function ehArquivo(caminho) {
  try {
    return (await stat(caminho)).isFile();
  } catch {
    return false;
  }
}

async function pastaDownloads() {
  const configurada = config.diretorioDownloads
    ? resolve(DIRETORIO_SERVER, config.diretorioDownloads)
    : '';
  const candidatos = [
    configurada,
    resolve(DIRETORIO_SERVER, 'downloads'),
    '/app/downloads',
    resolve(DIRETORIO_SERVER, '../backend/downloads'),
    '/home/cybhorpdv/downloads',
  ].filter(Boolean);
  for (const pasta of candidatos) {
    if (await ehDiretorio(pasta)) return pasta;
  }
  return candidatos[0];
}

function compararVersoesDesc(a, b) {
  const partesA = a.split('.').map(Number);
  const partesB = b.split('.').map(Number);
  for (let i = 0; i < partesA.length; i += 1) {
    if (partesA[i] !== partesB[i]) return partesB[i] - partesA[i];
  }
  return 0;
}

/** Versões em disco, da mais nova para a mais antiga. */
async function versoesPublicadas(pastaVersoes) {
  let entradas;
  try {
    entradas = await readdir(pastaVersoes, { withFileTypes: true });
  } catch {
    return [];
  }
  return entradas
    .filter((entrada) => entrada.isDirectory() && VERSAO_VALIDA.test(entrada.name))
    .map((entrada) => entrada.name)
    .sort(compararVersoesDesc);
}

async function dataPublicacao(pastaVersao) {
  try {
    const info = JSON.parse(await readFile(join(pastaVersao, 'info.json'), 'utf8'));
    if (typeof info?.publicado_em === 'string') {
      const data = new Date(info.publicado_em);
      if (!Number.isNaN(data.getTime())) return data.toISOString();
    }
  } catch {
    // info.json ausente ou corrompido: cai na data do diretório.
  }
  // Pastas antigas: a data do diretório é uma boa aproximação.
  return (await stat(pastaVersao)).mtime.toISOString();
}

async function montarVersao(pastaVersao, versao) {
  const instaladores = [];
  for (const item of INSTALADORES) {
    const caminho = join(pastaVersao, item.arquivo);
    if (!(await ehArquivo(caminho))) continue;
    instaladores.push({
      ...item,
      tamanho_bytes: (await stat(caminho)).size,
      url: `/api/site/baixar/${versao}/${item.arquivo}`,
    });
  }
  if (instaladores.length === 0) return null;
  return { versao, publicado_em: await dataPublicacao(pastaVersao), instaladores };
}

/** Instaladores soltos na raiz (servidor ainda sem pasta versoes/). */
async function montarAvulsos(pasta) {
  const instaladores = [];
  for (const item of INSTALADORES) {
    const caminho = join(pasta, item.arquivo);
    if (!(await ehArquivo(caminho))) continue;
    instaladores.push({
      ...item,
      tamanho_bytes: (await stat(caminho)).size,
      url: `/api/site/baixar/${item.arquivo}`,
    });
  }
  if (instaladores.length === 0) return null;
  return { versao: null, publicado_em: null, instaladores };
}

/** Versão atual em destaque e as anteriores (mais nova primeiro). */
export async function listarInstaladores() {
  const pasta = await pastaDownloads();
  const pastaVersoes = join(pasta, 'versoes');
  const versoes = [];
  for (const versao of await versoesPublicadas(pastaVersoes)) {
    const montada = await montarVersao(join(pastaVersoes, versao), versao);
    if (montada) versoes.push(montada);
  }
  const atual = versoes[0] ?? (await montarAvulsos(pasta));
  return {
    ok: true,
    atual,
    anteriores: versoes.slice(1),
    instaladores: atual ? atual.instaladores : [],
  };
}

/**
 * Resolve o arquivo pedido; sem versão entrega o mais novo publicado.
 * A lista fechada de nomes e o regex de versão impedem path traversal.
 *
 * @param {string} arquivo
 * @param {string | null} [versao]
 * @returns {Promise<string>} caminho absoluto do instalador.
 */
export async function caminhoInstalador(arquivo, versao = null) {
  const nome = basename(arquivo || '');
  if (nome !== arquivo || !ARQUIVOS_PERMITIDOS.has(nome)) {
    throw new ErroNegocio('Arquivo invalido.', 404);
  }

  const pasta = await pastaDownloads();
  let caminho;
  if (versao === null) {
    caminho = join(pasta, nome);
    const substituto = join(pasta, SUBSTITUTOS_LEGADOS[nome] ?? nome);
    if (await ehArquivo(substituto)) caminho = substituto;
  } else {
    if (!VERSAO_VALIDA.test(versao)) throw new ErroNegocio('Versao invalida.', 404);
    caminho = join(pasta, 'versoes', versao, nome);
  }

  if (!(await ehArquivo(caminho))) {
    throw new ErroNegocio('Instalador ainda nao publicado neste servidor.', 404);
  }
  return caminho;
}
