"use strict";

const crypto = require("crypto");
const path = require("path");
const marca = require("./marcaProduto.cjs");

const MAX_DOC_BYTES = 15 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const CHUNK_CHARS = 1200;
const LIMITE_NULOS_BINARIO = 0.15;

/**
 * @param {string} nomeArquivo
 * @param {string} [mime]
 * @returns {'txt'|'md'|'csv'|'json'|'pdf'|'audio'|'desconhecido'}
 */
function detectarTipo(nomeArquivo, mime) {
  const ext = path.extname(String(nomeArquivo || "")).toLowerCase();
  const m = String(mime || "").toLowerCase();

  if (ext === ".json" || m.includes("json")) return "json";
  if (ext === ".pdf" || m === "application/pdf") return "pdf";
  if (ext === ".md" || m.includes("markdown")) return "md";
  if (ext === ".csv" || m.includes("csv")) return "csv";
  if (
    ext === ".txt" ||
    m.startsWith("text/") ||
    m === "application/csv"
  ) {
    return "txt";
  }
  if (
    [".wav", ".mp3", ".m4a", ".ogg", ".webm", ".flac", ".aac"].includes(ext) ||
    m.startsWith("audio/")
  ) {
    return "audio";
  }
  return "desconhecido";
}

/**
 * @param {unknown} textoOuObjeto
 * @returns {{ ok: boolean, backup?: object }}
 */
function reconhecerBackupCybhor(textoOuObjeto) {
  let obj = textoOuObjeto;
  if (typeof textoOuObjeto === "string") {
    try {
      obj = JSON.parse(textoOuObjeto);
    } catch {
      return { ok: false };
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false };
  }
  if (!marca.appBackupValido(obj.app)) {
    return { ok: false };
  }
  return { ok: true, backup: obj };
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @returns {boolean}
 */
function pareceBinarioOuCriptografado(buffer) {
  const view = Buffer.from(buffer);
  if (view.length < 32) return false;
  const amostra = Math.min(view.length, 8192);
  let nulos = 0;
  for (let i = 0; i < amostra; i++) {
    if (view[i] === 0) nulos++;
  }
  return nulos / amostra >= LIMITE_NULOS_BINARIO;
}

/**
 * @param {{ nomeArquivo?: string, mime?: string, buffer: Buffer|Uint8Array }} opts
 * @returns {Promise<{ ok: boolean, texto?: string, tipo: string, backupCybhor?: object, erro?: string }>}
 */
async function extrairTextoDeBuffer(opts) {
  const nomeArquivo = String(opts.nomeArquivo || "");
  const mime = opts.mime;
  const buf = Buffer.from(opts.buffer || []);
  const tipo = detectarTipo(nomeArquivo, mime);

  if (!buf.length) {
    return { ok: false, tipo, erro: "Arquivo vazio." };
  }

  const limite = tipo === "audio" ? MAX_AUDIO_BYTES : MAX_DOC_BYTES;
  if (buf.length > limite) {
    const mb = Math.round(limite / (1024 * 1024));
    return {
      ok: false,
      tipo,
      erro: `Arquivo muito grande. O limite é ${mb} MB para este tipo.`,
    };
  }

  if (tipo === "audio") {
    return {
      ok: false,
      tipo,
      erro:
        "Anexo de áudio: use a transcrição Whisper (STT) antes de indexar o texto.",
    };
  }

  if (tipo === "desconhecido" && pareceBinarioOuCriptografado(buf)) {
    return {
      ok: false,
      tipo,
      erro:
        "Conteúdo binário ou backup criptografado de terceiros não é suportado. Exporte em TXT ou JSON legível.",
    };
  }

  if (tipo === "json") {
    const texto = buf.toString("utf8");
    const recon = reconhecerBackupCybhor(texto);
    const base = { ok: true, texto, tipo: "json" };
    if (recon.ok) base.backupCybhor = recon.backup;
    return base;
  }

  if (tipo === "txt" || tipo === "md" || tipo === "csv") {
    return { ok: true, texto: buf.toString("utf8"), tipo };
  }

  if (tipo === "pdf") {
    let pdfParse;
    try {
      pdfParse = require("pdf-parse");
    } catch {
      return {
        ok: false,
        tipo,
        erro:
          "Leitura de PDF não disponível nesta instalação. Envie o conteúdo em TXT ou JSON.",
      };
    }
    try {
      const dados = await pdfParse(buf);
      const texto = String(dados.text || "").trim();
      if (!texto) {
        return {
          ok: false,
          tipo,
          erro: "Não foi possível extrair texto deste PDF. Tente exportar como TXT.",
        };
      }
      return { ok: true, texto, tipo: "pdf" };
    } catch {
      return {
        ok: false,
        tipo,
        erro: "Falha ao ler o PDF. Envie uma cópia em TXT ou JSON.",
      };
    }
  }

  if (pareceBinarioOuCriptografado(buf)) {
    return {
      ok: false,
      tipo,
      erro:
        "Conteúdo binário ou backup criptografado de terceiros não é suportado. Exporte em TXT ou JSON legível.",
    };
  }

  return {
    ok: true,
    texto: buf.toString("utf8"),
    tipo: tipo === "desconhecido" ? "txt" : tipo,
  };
}

/**
 * Divide texto de anexo em blocos para indexação RAG.
 * @param {{ texto: string, nomeArquivo?: string, lojaId?: string }} opts
 * @returns {{ id: string, texto: string, fonte: 'anexo', lojaId?: string }[]}
 */
function montarChunksAnexo(opts) {
  const texto = String(opts.texto || "");
  const lojaId =
    opts.lojaId != null && String(opts.lojaId).trim()
      ? String(opts.lojaId).trim()
      : undefined;
  if (!texto.trim()) return [];

  const chunks = [];
  for (let i = 0; i < texto.length; i += CHUNK_CHARS) {
    const pedaco = texto.slice(i, i + CHUNK_CHARS);
    const row = {
      id: crypto.randomUUID(),
      texto: pedaco,
      fonte: "anexo",
    };
    if (lojaId) row.lojaId = lojaId;
    chunks.push(row);
  }
  return chunks;
}

module.exports = {
  MAX_DOC_BYTES,
  MAX_AUDIO_BYTES,
  detectarTipo,
  reconhecerBackupCybhor,
  extrairTextoDeBuffer,
  montarChunksAnexo,
};
