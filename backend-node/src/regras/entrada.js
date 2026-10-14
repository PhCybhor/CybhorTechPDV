import { ErroValidacao } from "../erros.js";

/**
 * Lê um campo textual do corpo. Números viram texto; objetos/arrays/null viram "".
 * Evita o `.trim()` em tipos inesperados (que no Python virava erro 500).
 * @param {unknown} valor
 * @returns {string}
 */
export function lerTexto(valor) {
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return "";
}

/** Equivale ao `(valor or "").strip()` do Python. */
export function lerTextoLimpo(valor) {
  return lerTexto(valor).trim();
}

/** Mantém só letras e números (Unicode), como o `str.isalnum` do Python. */
export function somenteAlfanumericos(valor) {
  return lerTexto(valor).replace(/[^\p{L}\p{N}]/gu, "");
}

export function somenteDigitos(valor) {
  return lerTexto(valor).replace(/\D/g, "");
}

/** Python: valores "falsy" ({}, [], "", 0, null, false). Usado nos `or` portados. */
export function ehVazioComoPython(valor) {
  if (valor === null || valor === undefined || valor === false || valor === 0 || valor === "") return true;
  if (Array.isArray(valor)) return valor.length === 0;
  if (ehObjetoSimples(valor)) return Object.keys(valor).length === 0;
  return Number.isNaN(valor);
}

export function ehObjetoSimples(valor) {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * Corpo JSON obrigatório como objeto (o FastAPI responde 422 nos demais casos).
 * @param {unknown} corpo
 * @returns {Record<string, any>}
 */
export function exigirObjeto(corpo) {
  if (!ehObjetoSimples(corpo)) throw new ErroValidacao();
  return corpo;
}

/**
 * Converte como o `int()` do Python: número trunca, texto precisa ser inteiro.
 * @returns {number | null} null quando inválido.
 */
export function converterInteiro(valor) {
  if (typeof valor === "boolean") return valor ? 1 : 0;
  if (typeof valor === "number") return Number.isFinite(valor) ? Math.trunc(valor) : null;
  if (typeof valor === "string" && /^\s*[-+]?\d+\s*$/.test(valor)) return Number.parseInt(valor, 10);
  return null;
}

/**
 * Converte como o `float()` do Python.
 * @returns {number | null} null quando inválido.
 */
export function converterDecimal(valor) {
  if (typeof valor === "boolean") return valor ? 1 : 0;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "string" && valor.trim() !== "") {
    const numero = Number(valor.trim());
    return Number.isFinite(numero) ? numero : null;
  }
  return null;
}

/** Arredonda para centavos (equivalente prático ao round(x, 2) do Python). */
export function arredondarCentavos(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

/** Datas do banco (Date em UTC) em ISO-8601, ou null. */
export function paraIso(valor) {
  if (valor instanceof Date) return valor.toISOString();
  return valor ?? null;
}
