import jwt from "jsonwebtoken";
import { config } from "../config.js";

const SEGUNDOS_POR_UNIDADE = { h: 3600, d: 86400, m: 60, s: 1 };
const PADRAO_POR_UNIDADE = { h: 12, d: 1, m: 30, s: 3600 };

/**
 * Converte '12h', '7d', '30m', '45s' ou segundos puros em segundos.
 * O `ms` do jsonwebtoken trataria "3600" como milissegundos; por isso o parser próprio.
 * @param {string} valor
 * @returns {number}
 */
export function converterExpiracaoEmSegundos(valor) {
  const texto = String(valor || "12h").trim().toLowerCase();
  const unidade = texto.at(-1);
  if (unidade in SEGUNDOS_POR_UNIDADE) {
    const quantidade = texto.slice(0, -1) ? Number.parseInt(texto.slice(0, -1), 10) : PADRAO_POR_UNIDADE[unidade];
    if (!Number.isFinite(quantidade)) throw new Error("JWT_EXPIRACAO invalida.");
    return quantidade * SEGUNDOS_POR_UNIDADE[unidade];
  }
  const segundos = Number.parseInt(texto, 10);
  if (!Number.isFinite(segundos)) throw new Error("JWT_EXPIRACAO invalida.");
  return segundos;
}

/**
 * Assina o token HS256 (compatível com os tokens emitidos pelo backend Python).
 * @param {Record<string, unknown>} conteudo
 * @returns {string}
 */
export function emitirToken(conteudo) {
  return jwt.sign(conteudo, config.jwtSegredo, {
    algorithm: "HS256",
    expiresIn: converterExpiracaoEmSegundos(config.jwtExpiracao),
  });
}

/**
 * @param {string} token
 * @returns {Record<string, unknown> | null} conteúdo ou null se inválido/expirado.
 */
export function decodificarToken(token) {
  try {
    const conteudo = jwt.verify(token, config.jwtSegredo, { algorithms: ["HS256"] });
    return typeof conteudo === "object" && conteudo !== null ? conteudo : null;
  } catch {
    return null;
  }
}
