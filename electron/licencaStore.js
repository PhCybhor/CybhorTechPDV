"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { app } = require("electron");

/**
 * Licença da loja criptografada em disco (AES-256-GCM).
 * A chave deriva da máquina + segredo do app, para dificultar cópia entre PCs.
 */

const VERSAO = 1;

/*
 * No mesmo PC o cliente pode trocar o instalador Win7 de 32 para 64 bits (ou vice-versa),
 * o que muda os.arch(); sem tentar a outra arquitetura a loja teria de reativar a licença.
 */
const ARQUITETURAS_INSTALADOR = ["x64", "ia32"];

function caminhoArquivo() {
  return path.join(app.getPath("userData"), "licenca.enc");
}

/**
 * @param {string} [arquitetura]
 */
function derivarChave(arquitetura = os.arch()) {
  const maquina = [
    os.hostname(),
    os.platform(),
    arquitetura,
    os.userInfo().username,
    "cybhor-pdv-licenca-v1",
  ].join("|");
  return crypto.scryptSync(maquina, "cybhor-salt-pdv-2026", 32);
}

/**
 * @param {object} payload
 */
function criptografar(payload) {
  const chave = derivarChave();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", chave, iv);
  const texto = Buffer.from(JSON.stringify(payload), "utf8");
  const criptografado = Buffer.concat([cipher.update(texto), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([
    Buffer.from([VERSAO]),
    iv,
    tag,
    criptografado,
  ]).toString("base64");
}

/**
 * @param {string} blob
 * @param {string} arquitetura
 * @returns {object | null}
 */
function descriptografar(blob, arquitetura) {
  try {
    const buf = Buffer.from(String(blob || ""), "base64");
    if (buf.length < 30 || buf[0] !== VERSAO) return null;
    const iv = buf.subarray(1, 13);
    const tag = buf.subarray(13, 29);
    const dados = buf.subarray(29);
    const chave = derivarChave(arquitetura);
    const decipher = crypto.createDecipheriv("aes-256-gcm", chave, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(dados), decipher.final()]);
    return JSON.parse(plain.toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * @returns {object | null}
 */
function lerLicenca() {
  try {
    const arquivo = caminhoArquivo();
    if (!fs.existsSync(arquivo)) return null;
    const blob = fs.readFileSync(arquivo, "utf8");
    const arquiteturaAtual = os.arch();
    const tentativas = [
      arquiteturaAtual,
      ...ARQUITETURAS_INSTALADOR.filter((arquitetura) => arquitetura !== arquiteturaAtual),
    ];
    for (const arquitetura of tentativas) {
      const dados = descriptografar(blob, arquitetura);
      if (!dados?.lojaId || !dados?.chave) continue;
      if (arquitetura !== arquiteturaAtual) {
        try {
          gravarArquivo(dados);
        } catch {
          /* licença já lida; a regravação é tentada de novo na próxima abertura */
        }
      }
      return dados;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {object} payload
 */
function gravarArquivo(payload) {
  fs.mkdirSync(path.dirname(caminhoArquivo()), { recursive: true });
  fs.writeFileSync(caminhoArquivo(), criptografar(payload), "utf8");
}

/**
 * @param {object} dados
 */
function salvarLicenca(dados) {
  const payload = {
    lojaId: dados.lojaId,
    chave: dados.chave,
    email: dados.email || "",
    nomeLoja: dados.nomeLoja || "",
    ativadoEm: Date.now(),
  };
  gravarArquivo(payload);
  return payload;
}

function limparLicenca() {
  try {
    const arquivo = caminhoArquivo();
    if (fs.existsSync(arquivo)) fs.unlinkSync(arquivo);
  } catch {
    /* ignore */
  }
}

module.exports = {
  lerLicenca,
  salvarLicenca,
  limparLicenca,
};
