"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function prepararPayloadTexto({ texto, limiteChars, dirTemp }) {
  const t = String(texto || "");
  const lim = Math.max(1, Number(limiteChars) || 4000);
  if (t.length <= lim) {
    return { textoInline: t, arquivoPath: null, usouArquivo: false };
  }
  let arquivoPath = null;
  try {
    fs.mkdirSync(dirTemp, { recursive: true });
    const nome = `cybhor-ia-${crypto.randomBytes(8).toString("hex")}.txt`;
    arquivoPath = path.join(dirTemp, nome);
    fs.writeFileSync(arquivoPath, t, "utf8");
  } catch (erro) {
    // EACCES/ENOSPC do Node incluem o path absoluto; o cliente não pode recebê-lo.
    limparOverflow(arquivoPath);
    const falha = new Error("Não foi possível preparar o texto.");
    if (arquivoPath) falha.arquivoOverflow = arquivoPath;
    throw falha;
  }
  const textoInline =
    `[Conteúdo longo salvo em arquivo interno; leia o arquivo completo para responder.]\nPATH=${arquivoPath}`;
  return { textoInline, arquivoPath, usouArquivo: true };
}

/**
 * Mensagem devolvida ao renderer. Nunca inclui path de overflow.
 * @param {unknown} mensagem
 * @param {string|null} [arquivoPath]
 * @returns {string}
 */
function sanitizarMensagemCliente(mensagem, arquivoPath) {
  const bruto = String(mensagem || "");
  if (!bruto) return "Não foi possível falar com a IA.";
  if (arquivoPath && bruto.includes(String(arquivoPath))) {
    return "Não foi possível falar com a IA.";
  }
  if (/cybhor-ia-[0-9a-f]+\.txt/i.test(bruto)) {
    return "Não foi possível falar com a IA.";
  }
  if (/(?:^|\s|['"`])(?:\/[^\s'"`]+|[A-Za-z]:\\[^\s'"`]+)/.test(bruto)) {
    return "Não foi possível falar com a IA.";
  }
  return bruto;
}

/**
 * @param {unknown} erro
 * @returns {string|null}
 */
function caminhoOverflowEmErro(erro) {
  if (erro && typeof erro.arquivoOverflow === "string" && erro.arquivoOverflow) {
    return erro.arquivoOverflow;
  }
  const texto = `${erro?.path || ""}\n${erro?.message || ""}`;
  const achado = texto.match(
    /((?:\/|[A-Za-z]:\\)[^\s'"]*cybhor-ia-[0-9a-f]+\.txt)/i
  );
  return achado ? achado[1] : null;
}

function limparOverflow(arquivoPath) {
  if (!arquivoPath) return;
  try {
    fs.unlinkSync(arquivoPath);
  } catch (_) {
    /* ignore */
  }
}

module.exports = {
  prepararPayloadTexto,
  limparOverflow,
  sanitizarMensagemCliente,
  caminhoOverflowEmErro,
};
