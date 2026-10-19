/**
 * Helpers de coerção de valores vindos do corpo JSON.
 *
 * Existem porque o backend original (Python) tolerava tipos inesperados com
 * regras próprias (`float()`, `int()`, `x or default`); centralizar aqui evita
 * divergência silenciosa entre os serviços.
 */

const PADRAO_NUMERO = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const PADRAO_INTEIRO = /^[+-]?\d+$/;

/** @param {unknown} valor */
export function ehObjetoSimples(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

/**
 * Devolve o objeto ou `{}` quando o valor não for um objeto simples.
 * @param {unknown} valor
 * @returns {Record<string, any>}
 */
export function objetoOuVazio(valor) {
  return ehObjetoSimples(valor) ? valor : {};
}

/**
 * Texto aparado; null/undefined/objetos viram ''.
 * @param {unknown} valor
 */
export function texto(valor) {
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor).trim();
  return '';
}

/**
 * Equivalente à veracidade do Python: null, false, 0, '', [] e {} são falsos.
 * @param {unknown} valor
 */
export function ehVerdadeiro(valor) {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === 'boolean') return valor;
  if (typeof valor === 'number') return valor !== 0 && !Number.isNaN(valor);
  if (typeof valor === 'string') return valor.length > 0;
  if (Array.isArray(valor)) return valor.length > 0;
  if (typeof valor === 'object') return Object.keys(valor).length > 0;
  return true;
}

/**
 * Converte para número finito ou devolve null (nunca lança).
 * @param {unknown} valor
 * @returns {number | null}
 */
export function converterParaNumero(valor) {
  if (typeof valor === 'boolean') return valor ? 1 : 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  if (typeof valor === 'string') {
    const aparado = valor.trim();
    if (!PADRAO_NUMERO.test(aparado)) return null;
    const numero = Number(aparado);
    return Number.isFinite(numero) ? numero : null;
  }
  return null;
}

/**
 * Converte para inteiro (truncando decimais, como `int()` do Python) ou null.
 * @param {unknown} valor
 * @returns {number | null}
 */
export function converterParaInteiro(valor) {
  if (typeof valor === 'boolean') return valor ? 1 : 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? Math.trunc(valor) : null;
  if (typeof valor === 'string') {
    const aparado = valor.trim();
    if (!PADRAO_INTEIRO.test(aparado)) return null;
    const numero = Number.parseInt(aparado, 10);
    return Number.isSafeInteger(numero) ? numero : null;
  }
  return null;
}

/**
 * Arredonda para 2 casas evitando o erro de ponto flutuante de x.xx5.
 * @param {number} valor
 */
export function arredondarMoeda(valor) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/** Mantém apenas letras e números, em maiúsculas (chaves de ativação). */
export function normalizarChaveAlfanumerica(valor) {
  return texto(valor).toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** Conta caracteres Unicode (não unidades UTF-16), como len() do Python. */
export function tamanhoEmCaracteres(valor) {
  return Array.from(valor).length;
}

/** Colunas JSON chegam como objeto no MySQL 8; aceita string por segurança. */
export function lerJson(valor, padrao = {}) {
  if (valor === null || valor === undefined) return padrao;
  if (typeof valor !== 'string') return valor;
  try {
    return JSON.parse(valor);
  } catch {
    return padrao;
  }
}
