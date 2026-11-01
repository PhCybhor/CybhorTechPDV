"use strict";

const { requisitarJson: requisitarJsonPadrao } = require("./httpJson");

const BASE_PADRAO = "http://127.0.0.1:11434";
const MODELO_PADRAO = "llama3.2:3b";

/**
 * Chat no Ollama local. Não lança: falha de rede vira `{ ok: false }`.
 * @param {{
 *   mensagem?: string,
 *   system?: string,
 *   modelo?: string,
 *   baseUrl?: string,
 *   requisitarJson?: (url: string, opcoes?: object) => Promise<{ ok?: boolean, status?: number, dados?: any }>
 * }} [entrada]
 * @returns {Promise<{ ok: boolean, texto?: string, mensagem?: string }>}
 */
async function consultarOllama(entrada = {}) {
  const http =
    typeof entrada.requisitarJson === "function"
      ? entrada.requisitarJson
      : requisitarJsonPadrao;
  const base = String(entrada.baseUrl || BASE_PADRAO).replace(/\/+$/, "");
  const modelo =
    String(entrada.modelo || process.env.OLLAMA_MODEL || MODELO_PADRAO).trim() ||
    MODELO_PADRAO;
  const mensagem = String(entrada.mensagem || "").trim();
  if (!mensagem) {
    return { ok: false, mensagem: "Escreva uma pergunta." };
  }

  const messages = [];
  const system = String(entrada.system || "").trim();
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: mensagem });

  try {
    const resposta = await http(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelo, messages, stream: false }),
    });
    if (!resposta || resposta.ok === false) {
      const detalhe =
        (resposta && resposta.dados && resposta.dados.error) ||
        (resposta && resposta.status
          ? `Falha no Ollama (HTTP ${resposta.status}).`
          : "Falha no Ollama.");
      return { ok: false, mensagem: String(detalhe) };
    }
    const texto = String(
      (resposta.dados && resposta.dados.message && resposta.dados.message.content) ||
        ""
    ).trim();
    if (!texto) return { ok: false, mensagem: "Ollama não retornou texto." };
    return { ok: true, texto };
  } catch (erro) {
    return {
      ok: false,
      mensagem: String((erro && erro.message) || "Falha no Ollama."),
    };
  }
}

module.exports = { consultarOllama };
