/**
 * Contexto multi-loja: o JWT da FastAPI limita cada instalação ao seu lojaId.
 * Assim o estoque/vendas de uma loja nunca mistura com outra.
 */

let lojaIdAtual = null;
let metaLoja = null;

/**
 * @param {string} lojaId
 * @param {object} [meta]
 */
export function definirTenant(lojaId, meta = null) {
  if (!lojaId || typeof lojaId !== "string") {
    throw new Error("Identificador da loja inválido.");
  }
  lojaIdAtual = lojaId.trim();
  metaLoja = meta;
}

export function limparTenant() {
  lojaIdAtual = null;
  metaLoja = null;
}

/** @returns {string | null} */
export function obterLojaId() {
  return lojaIdAtual;
}

/** @returns {object | null} */
export function obterMetaLoja() {
  return metaLoja;
}

/**
 * Caminho lógico isolado por loja, persistido como JSONB no PostgreSQL.
 * @param {string} recurso ex: "produtos", "vendas", "funcionarios"
 * @returns {string}
 */
export function caminhoLoja(recurso) {
  if (!lojaIdAtual) {
    throw new Error(
      "Licença não ativada. Ative o CybhorPDV antes de usar o sistema."
    );
  }
  const limpo = String(recurso || "").replace(/^\/+|\/+$/g, "");
  if (!limpo) throw new Error("Recurso inválido.");
  return `lojas/${lojaIdAtual}/${limpo}`;
}
