"use strict";

/**
 * Validação de licença contra a API de vendas (Mercado Pago / servidor Cybhor).
 */

/**
 * @returns {string}
 */
function obterUrlApi() {
  return (process.env.CYBHOR_API_URL || "http://localhost:8787").replace(
    /\/+$/,
    ""
  );
}

/**
 * @param {string} chave
 * @returns {Promise<{ok: boolean, lojaId?: string, email?: string, nomeLoja?: string, mensagem?: string, chave?: string}>}
 */
async function validarLicencaRemota(chave) {
  const limpa = String(chave || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  if (!limpa || limpa.length < 8) {
    return { ok: false, mensagem: "Informe uma chave de licença válida." };
  }

  // Desenvolvimento local sem API / Mercado Pago
  if (
    process.env.CYBHOR_MODO_DEV === "1" &&
    (limpa === "DEV-LOCAL" || limpa.startsWith("DEV-"))
  ) {
    const crypto = require("crypto");
    const lojaId =
      process.env.CYBHOR_DEV_LOJA_ID ||
      crypto.createHash("sha256").update(`dev-${limpa}`).digest("hex").slice(0, 32);
    return {
      ok: true,
      lojaId,
      email: "dev@cybhor.local",
      nomeLoja: "Loja desenvolvimento",
      chave: limpa,
    };
  }

  const url = `${obterUrlApi()}/api/ativar`;
  try {
    const resposta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ chave: limpa }),
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok || !dados.ok) {
      return {
        ok: false,
        mensagem:
          dados.mensagem ||
          "Licença inválida ou inativa. Verifique a chave da compra.",
      };
    }
    return {
      ok: true,
      lojaId: dados.lojaId,
      email: dados.email || "",
      nomeLoja: dados.nomeLoja || "",
      chave: limpa,
    };
  } catch {
    return {
      ok: false,
      mensagem:
        "Não foi possível validar a licença. Verifique a internet e a URL da API (CYBHOR_API_URL).",
    };
  }
}

module.exports = {
  obterUrlApi,
  validarLicencaRemota,
};
