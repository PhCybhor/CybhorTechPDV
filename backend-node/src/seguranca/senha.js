import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ErroNegocio } from "../erros.js";

const pbkdf2Assincrono = promisify(pbkdf2);

// Mesmos parâmetros do backend Python e do desktop: hashes já gravados continuam válidos.
const ITERACOES = 150_000;
const TAMANHO_CHAVE_BYTES = 32;
export const SENHA_MIN = 8;
export const SENHA_MAX = 128;

// Python conta code points; length do JS conta unidades UTF-16 (emoji vale 2).
function contarCaracteres(texto) {
  return [...texto].length;
}

/** @returns {string} salt aleatório de 16 bytes em hex. */
export function gerarSalt() {
  return randomBytes(16).toString("hex");
}

/**
 * Rejeita senhas curtas ou gigantes (DoS via PBKDF2) antes do hash.
 * @param {unknown} senha
 * @returns {string}
 */
export function validarTamanhoSenha(senha) {
  const texto = typeof senha === "string" ? senha : "";
  const tamanho = contarCaracteres(texto);
  if (tamanho < SENHA_MIN) throw new ErroNegocio(`A senha deve ter ao menos ${SENHA_MIN} caracteres.`);
  if (tamanho > SENHA_MAX) throw new ErroNegocio(`A senha deve ter no maximo ${SENHA_MAX} caracteres.`);
  return texto;
}

/**
 * PBKDF2-SHA256; o salt é a string hex em UTF-8, igual ao desktop.
 * @param {string} senha
 * @param {string} salt
 * @returns {Promise<string>} hash em hex.
 */
export async function gerarHashSenha(senha, salt) {
  const chave = await pbkdf2Assincrono(
    Buffer.from(senha, "utf8"),
    Buffer.from(salt, "utf8"),
    ITERACOES,
    TAMANHO_CHAVE_BYTES,
    "sha256",
  );
  return chave.toString("hex");
}

/**
 * Compara a senha com o hash gravado em tempo constante.
 * @returns {Promise<boolean>}
 */
export async function verificarSenha(senha, salt, hashEsperado) {
  if (typeof senha !== "string" || !senha || contarCaracteres(senha) > SENHA_MAX) return false;
  if (!salt || !hashEsperado) return false;
  const hashAtual = Buffer.from(await gerarHashSenha(senha, String(salt)), "utf8");
  const esperado = Buffer.from(String(hashEsperado), "utf8");
  if (hashAtual.length !== esperado.length) return false;
  return timingSafeEqual(hashAtual, esperado);
}
