"use strict";

const { MODES_SYSTEM } = require("./assistenteGemini");

/**
 * Escolhe Ollama ou Gemini. Não lança mensagem de hardware para a UI.
 * @param {{
 *   payload?: { modo?: string, mensagem?: string },
 *   hardware?: { localOk?: boolean },
 *   providers?: {
 *     consultarOllama?: (entrada: object) => Promise<{ ok?: boolean, texto?: string, mensagem?: string }>,
 *     consultarGemini?: (payload: object) => Promise<{ ok?: boolean, texto?: string, mensagem?: string }>
 *   }
 * }} [opcoes]
 */
async function consultarComRouter(opcoes = {}) {
  const payload = opcoes.payload && typeof opcoes.payload === "object" ? opcoes.payload : {};
  const providers = opcoes.providers && typeof opcoes.providers === "object" ? opcoes.providers : {};
  const localOk = Boolean(opcoes.hardware && opcoes.hardware.localOk);

  if (localOk && typeof providers.consultarOllama === "function") {
    const modo = String(payload.modo || "livre").trim();
    try {
      const local = await providers.consultarOllama({
        mensagem: payload.mensagem,
        system: MODES_SYSTEM[modo] || MODES_SYSTEM.livre,
      });
      if (local && local.ok) return local;
    } catch (_erro) {
      /* falha local cai no Gemini */
    }
  }

  if (typeof providers.consultarGemini !== "function") {
    return { ok: false, mensagem: "Assistente indisponível." };
  }
  try {
    return await providers.consultarGemini(payload);
  } catch (erro) {
    return {
      ok: false,
      mensagem: String((erro && erro.message) || "Falha no assistente."),
    };
  }
}

module.exports = { consultarComRouter };
