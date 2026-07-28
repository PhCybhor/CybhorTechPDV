"use strict";

const crypto = require("crypto");

/**
 * Hash de senha PBKDF2 — mesmo formato ja usado pelo PDV desktop
 * (150k iteracoes, SHA-256, chave de 256 bits, hex), permitindo migrar
 * contas existentes sem trocar senha.
 */
const ITERACOES = 150000;
const TAMANHO_CHAVE_BYTES = 32;

function gerarSalt() {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * @param {string} senha
 * @param {string} salt
 * @returns {Promise<string>}
 */
function gerarHashSenha(senha, salt) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(senha, salt, ITERACOES, TAMANHO_CHAVE_BYTES, "sha256", (erro, chave) => {
      if (erro) reject(erro);
      else resolve(chave.toString("hex"));
    });
  });
}

/**
 * @param {string} senha
 * @param {string} salt
 * @param {string} hashEsperado
 * @returns {Promise<boolean>}
 */
async function verificarSenha(senha, salt, hashEsperado) {
  const hash = await gerarHashSenha(senha, salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(hashEsperado, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { gerarSalt, gerarHashSenha, verificarSenha };
