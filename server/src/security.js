import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { ErroNegocio } from './errors.js';
import { tamanhoEmCaracteres } from './utils/valores.js';

const pbkdf2Assincrono = promisify(pbkdf2);

export const ITERACOES = 150_000;
export const TAMANHO_CHAVE_BYTES = 32;
export const SENHA_MIN = 8;
export const SENHA_MAX = 128;

/** @returns {string} 16 bytes aleatórios em hex. */
export function gerarSalt() {
  return randomBytes(16).toString('hex');
}

/**
 * Rejeita senhas curtas ou gigantes (DoS via PBKDF2) antes do hash.
 * @param {unknown} senha
 * @returns {string} a própria senha, validada.
 */
export function validarTamanhoSenha(senha) {
  const texto = typeof senha === 'string' ? senha : '';
  const tamanho = tamanhoEmCaracteres(texto);
  if (tamanho < SENHA_MIN) {
    throw new ErroNegocio(`A senha deve ter ao menos ${SENHA_MIN} caracteres.`);
  }
  if (tamanho > SENHA_MAX) {
    throw new ErroNegocio(`A senha deve ter no maximo ${SENHA_MAX} caracteres.`);
  }
  return texto;
}

/**
 * PBKDF2-SHA256 — o salt é a string hex em UTF-8 (não os bytes), igual ao desktop.
 * Assíncrono para os 150 mil ciclos rodarem no threadpool, sem travar o event loop.
 * @param {string} senha
 * @param {string} salt
 * @returns {Promise<string>} hash em hex.
 */
export async function gerarHashSenha(senha, salt) {
  const chave = await pbkdf2Assincrono(
    Buffer.from(senha, 'utf8'),
    Buffer.from(salt, 'utf8'),
    ITERACOES,
    TAMANHO_CHAVE_BYTES,
    'sha256',
  );
  return chave.toString('hex');
}

/**
 * Comparação em tempo constante de dois textos.
 * @param {string} esperado
 * @param {string} recebido
 */
export function compararEmTempoConstante(esperado, recebido) {
  const bufferEsperado = Buffer.from(String(esperado), 'utf8');
  const bufferRecebido = Buffer.from(String(recebido), 'utf8');
  if (bufferEsperado.length !== bufferRecebido.length) return false;
  return timingSafeEqual(bufferEsperado, bufferRecebido);
}

/**
 * @param {unknown} senha
 * @param {string} salt
 * @param {string} hashEsperado
 * @returns {Promise<boolean>}
 */
export async function verificarSenha(senha, salt, hashEsperado) {
  if (typeof senha !== 'string' || !senha || tamanhoEmCaracteres(senha) > SENHA_MAX) return false;
  if (!salt || !hashEsperado) return false;
  const hashAtual = await gerarHashSenha(senha, salt);
  return compararEmTempoConstante(hashAtual, hashEsperado);
}
