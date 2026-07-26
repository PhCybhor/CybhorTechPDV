"use strict";

const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

/**
 * @param {import("firebase-admin").database.Database} db
 */
function criarLicencaService(db) {
  /**
   * Gera chave legível: CYB-XXXX-XXXX-XXXX
   * @returns {string}
   */
  function gerarChave() {
    const bloco = () =>
      crypto.randomBytes(2).toString("hex").toUpperCase();
    return `CYB-${bloco()}${bloco().slice(0, 2)}-${bloco()}${bloco().slice(0, 2)}-${bloco()}${bloco().slice(0, 2)}`;
  }

  /**
   * @param {string} chave
   * @returns {string}
   */
  function hashChave(chave) {
    return crypto
      .createHash("sha256")
      .update(String(chave).trim().toUpperCase())
      .digest("hex");
  }

  /**
   * @param {{email: string, nomeLoja: string, pagamentoId?: string, valor?: number}} dados
   */
  async function emitirLicenca(dados) {
    const chave = gerarChave();
    const lojaId = uuidv4();
    const hash = hashChave(chave);
    const agora = Date.now();

    const licenca = {
      lojaId,
      email: String(dados.email || "").toLowerCase().trim(),
      nomeLoja: String(dados.nomeLoja || "Minha Loja").trim(),
      status: "ativa",
      pagamentoId: dados.pagamentoId || "",
      valor: Number(dados.valor) || 0,
      criadoEm: agora,
    };

    await db.ref(`licencas/${hash}`).set({
      ...licenca,
      // chave em claro só no retorno ao comprador; no DB fica o hash
    });

    await db.ref(`lojas/${lojaId}/meta`).set({
      nome: licenca.nomeLoja,
      email: licenca.email,
      plano: "vitalicio",
      status: "ativa",
      criadaEm: agora,
      pagamentoId: licenca.pagamentoId,
    });

    return { chave, lojaId, ...licenca };
  }

  /**
   * @param {string} chave
   */
  async function ativarPorChave(chave) {
    const limpa = String(chave || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
    if (!limpa) {
      return { ok: false, mensagem: "Informe a chave de licença." };
    }

    const hash = hashChave(limpa);
    const snap = await db.ref(`licencas/${hash}`).get();
    if (!snap.exists()) {
      return { ok: false, mensagem: "Licença não encontrada." };
    }

    const dados = snap.val();
    if (dados.status !== "ativa") {
      return { ok: false, mensagem: "Esta licença está suspensa." };
    }

    await db.ref(`licencas/${hash}/ultimoUsoEm`).set(Date.now());

    return {
      ok: true,
      lojaId: dados.lojaId,
      email: dados.email || "",
      nomeLoja: dados.nomeLoja || "",
    };
  }

  /**
   * @param {string} pagamentoId
   */
  async function buscarPorPagamento(pagamentoId) {
    if (!pagamentoId) return null;
    const snap = await db
      .ref("licencas")
      .orderByChild("pagamentoId")
      .equalTo(String(pagamentoId))
      .limitToFirst(1)
      .get();
    if (!snap.exists()) return null;
    const [hash, dados] = Object.entries(snap.val())[0];
    return { hash, ...dados };
  }

  return { emitirLicenca, ativarPorChave, buscarPorPagamento, hashChave };
}

module.exports = { criarLicencaService };
