"use strict";

/**
 * Validação de licença contra a API de vendas (Mercado Pago / servidor Cybhor).
 */

/**
 * @returns {string}
 */
function obterUrlApi() {
  return (process.env.CYBHOR_API_URL || "http://localhost:3333").replace(
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

  if (!limpa || limpa.length < 6) {
    return { ok: false, mensagem: "Informe uma chave de licença válida." };
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
          dados.erro ||
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
