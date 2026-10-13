"use strict";

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

/**
 * Fila de vendas feitas sem internet, gravada em disco (não no localStorage)
 * para sobreviver a queda de energia e a limpeza de cache do Chromium.
 */

const NOME_ARQUIVO = "fila-vendas-offline.json";
const MAX_REGISTROS = 5000;
const MAX_BYTES = 8 * 1024 * 1024;

function caminhoArquivo() {
  return path.join(app.getPath("userData"), NOME_ARQUIVO);
}

/**
 * Arquivo ilegível é renomeado em vez de sobrescrito: as vendas dentro dele
 * ainda podem ser recuperadas manualmente.
 * @param {string} caminho
 */
function separarArquivoCorrompido(caminho) {
  try {
    fs.renameSync(caminho, `${caminho}.corrompido-${Date.now()}`);
  } catch (erro) {
    console.error("Não foi possível separar a fila offline corrompida:", erro);
  }
}

/**
 * @returns {Array<object>}
 */
function lerFilaOffline() {
  const caminho = caminhoArquivo();
  let bruto;
  try {
    bruto = fs.readFileSync(caminho, "utf8");
  } catch (erro) {
    if (erro.code !== "ENOENT") console.error("Falha ao ler a fila offline:", erro);
    return [];
  }
  try {
    const dados = JSON.parse(bruto);
    if (Array.isArray(dados)) return dados;
  } catch (erro) {
    console.error("Fila offline com JSON inválido:", erro);
  }
  separarArquivoCorrompido(caminho);
  return [];
}

/**
 * Grava em arquivo temporário + fsync + rename para nunca deixar a fila pela metade.
 * @param {Array<object>} fila
 */
function gravarFilaOffline(fila) {
  if (!Array.isArray(fila)) throw new Error("Fila de vendas inválida.");
  if (fila.length > MAX_REGISTROS) {
    throw new Error("Muitas vendas sem enviar. Conecte o computador à internet.");
  }
  const texto = JSON.stringify(fila);
  if (Buffer.byteLength(texto, "utf8") > MAX_BYTES) {
    throw new Error("Fila de vendas offline cheia. Conecte o computador à internet.");
  }

  const destino = caminhoArquivo();
  const temporario = `${destino}.tmp`;
  const descritor = fs.openSync(temporario, "w");
  try {
    fs.writeFileSync(descritor, texto, "utf8");
    fs.fsyncSync(descritor);
  } finally {
    fs.closeSync(descritor);
  }
  try {
    fs.renameSync(temporario, destino);
  } catch (erro) {
    // Antivírus no Windows às vezes segura o arquivo destino e o rename falha.
    if (erro.code !== "EPERM" && erro.code !== "EBUSY") throw erro;
    fs.copyFileSync(temporario, destino);
    fs.unlinkSync(temporario);
  }
}

module.exports = { lerFilaOffline, gravarFilaOffline };
