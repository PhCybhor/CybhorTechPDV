/**
 * Utilitarios de seguranca para hashing de senhas.
 * Usa PBKDF2 (Web Crypto API), evitando armazenar senhas em texto puro.
 */

const ITERACOES = 150000;
const TAMANHO_CHAVE_BITS = 256;

/**
 * Converte um ArrayBuffer em string hexadecimal.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function bufferParaHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Gera um salt aleatorio em formato hexadecimal.
 * @returns {string}
 */
export function gerarSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bufferParaHex(bytes.buffer);
}

/**
 * Gera o hash PBKDF2 de uma senha usando o salt informado.
 * @param {string} senha
 * @param {string} salt
 * @returns {Promise<string>}
 */
export async function gerarHashSenha(senha, salt) {
  const codificador = new TextEncoder();
  const chaveBase = await crypto.subtle.importKey(
    "raw",
    codificador.encode(senha),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: codificador.encode(salt),
      iterations: ITERACOES,
      hash: "SHA-256",
    },
    chaveBase,
    TAMANHO_CHAVE_BITS
  );

  return bufferParaHex(bits);
}

/**
 * Verifica se uma senha corresponde ao hash armazenado.
 * @param {string} senha
 * @param {string} salt
 * @param {string} hashEsperado
 * @returns {Promise<boolean>}
 */
export async function verificarSenha(senha, salt, hashEsperado) {
  const hash = await gerarHashSenha(senha, salt);
  return hash === hashEsperado;
}
