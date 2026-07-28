import { ref, get, set, push, update } from "firebase/database";
import { obterDatabase } from "../config/firebaseClient.js";

/**
 * Multi-loja: cada loja tem seus dados isolados em `lojas/{lojaId}` e um
 * codigo curto de conexao (`codigosLoja/{codigo}`) para ligar novos caixas.
 * O caixa lembra a loja localmente (localStorage) entre sessoes.
 */

const CHAVE_LOJA_LOCAL = "cybhorpdv.lojaId";
const CAMINHO_LOJAS = "lojas";
const CAMINHO_CODIGOS = "codigosLoja";

/** Alfabeto sem caracteres ambiguos (0/O, 1/I/L). */
const ALFABETO_CODIGO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const TAMANHO_CODIGO = 6;

let lojaIdAtual = null;
let perfilLojaCache = null;

/**
 * @returns {string}
 */
function gerarCodigoLoja() {
  const bytes = crypto.getRandomValues(new Uint8Array(TAMANHO_CODIGO));
  return Array.from(bytes)
    .map((b) => ALFABETO_CODIGO[b % ALFABETO_CODIGO.length])
    .join("");
}

/**
 * @param {string} codigo
 * @returns {string}
 */
function normalizarCodigo(codigo) {
  return (codigo || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Loja lembrada neste caixa (ou null no primeiro uso).
 * @returns {string | null}
 */
export function obterLojaIdLocal() {
  if (lojaIdAtual) return lojaIdAtual;
  lojaIdAtual = localStorage.getItem(CHAVE_LOJA_LOCAL);
  return lojaIdAtual;
}

/**
 * @param {string} lojaId
 */
function definirLojaIdLocal(lojaId) {
  lojaIdAtual = lojaId;
  perfilLojaCache = null;
  localStorage.setItem(CHAVE_LOJA_LOCAL, lojaId);
}

/** Desconecta este caixa da loja (nao apaga dados no servidor). */
export function desconectarLojaLocal() {
  lojaIdAtual = null;
  perfilLojaCache = null;
  localStorage.removeItem(CHAVE_LOJA_LOCAL);
}

/**
 * Caminho de dados da loja atual. Lanca erro se nenhuma loja conectada.
 * @param {string} sub ex: "produtos"
 * @returns {string}
 */
export function caminhoLoja(sub) {
  const lojaId = obterLojaIdLocal();
  if (!lojaId) throw new Error("Nenhuma loja conectada neste caixa.");
  return `${CAMINHO_LOJAS}/${lojaId}/${sub}`;
}

/**
 * Cria uma loja nova, gera o codigo de conexao e conecta este caixa a ela.
 * @param {{nome: string, cnpj?: string, endereco?: string, telefone?: string}} dados
 * @returns {Promise<{lojaId: string, codigo: string}>}
 */
export async function criarLoja({ nome, cnpj = "", endereco = "", telefone = "" }) {
  const nomeLimpo = (nome || "").trim();
  if (nomeLimpo.length < 2) throw new Error("Informe o nome da loja.");

  const db = await obterDatabase();
  const referencia = push(ref(db, CAMINHO_LOJAS));
  const lojaId = referencia.key;

  // Garante codigo unico (colisao e improvavel, mas barata de checar)
  let codigo = gerarCodigoLoja();
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    const existente = await get(ref(db, `${CAMINHO_CODIGOS}/${codigo}`));
    if (!existente.exists()) break;
    codigo = gerarCodigoLoja();
  }

  const perfil = {
    nome: nomeLimpo,
    cnpj: (cnpj || "").trim(),
    endereco: (endereco || "").trim(),
    telefone: (telefone || "").trim(),
    codigo,
    criadoEm: Date.now(),
  };

  const atualizacoes = {};
  atualizacoes[`${CAMINHO_LOJAS}/${lojaId}/perfil`] = perfil;
  atualizacoes[`${CAMINHO_CODIGOS}/${codigo}`] = lojaId;
  await update(ref(db), atualizacoes);

  definirLojaIdLocal(lojaId);
  perfilLojaCache = perfil;
  return { lojaId, codigo };
}

/**
 * Conecta este caixa a uma loja existente pelo codigo de conexao.
 * @param {string} codigo
 * @returns {Promise<{lojaId: string, nome: string}>}
 */
export async function conectarLojaPorCodigo(codigo) {
  const codigoLimpo = normalizarCodigo(codigo);
  if (codigoLimpo.length < TAMANHO_CODIGO)
    throw new Error("Codigo da loja invalido.");

  const db = await obterDatabase();
  const snapshot = await get(ref(db, `${CAMINHO_CODIGOS}/${codigoLimpo}`));
  if (!snapshot.exists())
    throw new Error("Loja nao encontrada. Confira o codigo com o administrador.");

  const lojaId = snapshot.val();
  const perfilSnap = await get(ref(db, `${CAMINHO_LOJAS}/${lojaId}/perfil`));
  if (!perfilSnap.exists())
    throw new Error("Loja invalida ou removida.");

  definirLojaIdLocal(lojaId);
  perfilLojaCache = perfilSnap.val();
  return { lojaId, nome: perfilLojaCache.nome };
}

/**
 * Perfil da loja atual (nome, cnpj, endereco, telefone, codigo).
 * Usado no cabecalho do app e no cupom impresso.
 * @param {boolean} [forcarRecarga]
 * @returns {Promise<object | null>}
 */
export async function obterPerfilLoja(forcarRecarga = false) {
  const lojaId = obterLojaIdLocal();
  if (!lojaId) return null;
  if (perfilLojaCache && !forcarRecarga) return perfilLojaCache;

  const db = await obterDatabase();
  const snapshot = await get(ref(db, `${CAMINHO_LOJAS}/${lojaId}/perfil`));
  perfilLojaCache = snapshot.exists() ? snapshot.val() : null;
  return perfilLojaCache;
}

/**
 * Atualiza os dados de perfil da loja (dados do cupom).
 * @param {{nome?: string, cnpj?: string, endereco?: string, telefone?: string}} dados
 * @returns {Promise<void>}
 */
export async function atualizarPerfilLoja(dados) {
  const lojaId = obterLojaIdLocal();
  if (!lojaId) throw new Error("Nenhuma loja conectada.");

  const permitidos = {};
  ["nome", "cnpj", "endereco", "telefone"].forEach((campo) => {
    if (typeof dados[campo] === "string") permitidos[campo] = dados[campo].trim();
  });
  if (permitidos.nome !== undefined && permitidos.nome.length < 2)
    throw new Error("Informe o nome da loja.");

  const db = await obterDatabase();
  await update(ref(db, `${CAMINHO_LOJAS}/${lojaId}/perfil`), {
    ...permitidos,
    atualizadoEm: Date.now(),
  });
  perfilLojaCache = null;
}
