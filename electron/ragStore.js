"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Fuse = require("fuse.js");

/**
 * Índice lexical local (Fuse + JSON). Sem embedding.
 * @param {{ dir: string }} opts diretório que guarda index.json
 */
function criarRagStore({ dir }) {
  const arquivo = path.join(dir, "index.json");
  fs.mkdirSync(dir, { recursive: true });

  function lerChunks() {
    if (!fs.existsSync(arquivo)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(arquivo, "utf8"));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function gravarChunks(chunks) {
    fs.writeFileSync(arquivo, JSON.stringify(chunks), "utf8");
  }

  function normalizar(entrada, fontePadrao) {
    const texto = String(entrada && entrada.texto != null ? entrada.texto : "").trim();
    if (!texto) return null;
    const row = {
      id: (entrada && entrada.id) || crypto.randomUUID(),
      texto,
      fonte: String((entrada && entrada.fonte) || fontePadrao),
      ts: (entrada && entrada.ts) || new Date().toISOString(),
    };
    if (entrada && entrada.lojaId) row.lojaId = String(entrada.lojaId);
    return row;
  }

  function upsert(lista, fontePadrao) {
    const porId = new Map(lerChunks().map((c) => [c.id, c]));
    for (const item of lista) {
      const row = normalizar(item, fontePadrao);
      if (row) porId.set(row.id, row);
    }
    const next = Array.from(porId.values());
    gravarChunks(next);
    return next;
  }

  function indexarDocumentos(documentos) {
    return upsert(Array.isArray(documentos) ? documentos : [], "docs");
  }

  function indexarChat(entrada) {
    const lista = Array.isArray(entrada) ? entrada : [entrada];
    return upsert(lista, "chat");
  }

  /**
   * @param {string} query
   * @param {{ k?: number, lojaId?: string }} [opts]
   * @returns {{ id: string, texto: string, fonte: string, score: number }[]}
   */
  function buscar(query, opts = {}) {
    const k = opts.k == null ? 6 : Number(opts.k);
    const consulta = String(query || "").trim();
    if (!consulta || !(k > 0)) return [];
    let chunks = lerChunks();
    if (opts.lojaId) {
      const loja = String(opts.lojaId);
      chunks = chunks.filter((c) => !c.lojaId || c.lojaId === loja);
    }
    const fuse = new Fuse(chunks, {
      keys: ["texto", "fonte"],
      threshold: 0.45,
      includeScore: true,
    });
    return fuse.search(consulta, { limit: k }).map((r) => ({
      id: r.item.id,
      texto: r.item.texto,
      fonte: r.item.fonte,
      score: r.score,
    }));
  }

  /**
   * Texto para injetar no prompt. Acima do teto, o caller usa overflow (Task 2).
   * @param {string} query
   * @param {{ k?: number, lojaId?: string, maxChars?: number }} [opts]
   * @returns {string}
   */
  function montarContexto(query, opts = {}) {
    const maxChars = opts.maxChars || 6000;
    let out = "";
    for (const h of buscar(query, opts)) {
      const pedaco = `[${h.fonte}] ${h.texto}`;
      const sep = out ? "\n" : "";
      if (out.length + sep.length + pedaco.length <= maxChars) {
        out += sep + pedaco;
        continue;
      }
      const resto = maxChars - out.length - sep.length;
      if (resto > 0) out += sep + pedaco.slice(0, resto);
      break;
    }
    return out;
  }

  return { indexarDocumentos, indexarChat, buscar, montarContexto };
}

module.exports = { criarRagStore };
