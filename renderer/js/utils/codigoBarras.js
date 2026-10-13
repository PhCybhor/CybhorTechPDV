const TAMANHO_MAXIMO_CODIGO = 64;

/**
 * Limpa o texto vindo do leitor (USB ou câmera): sem espaços nem caracteres de controle.
 * @param {string} texto
 * @returns {string}
 */
export function normalizarCodigoLido(texto) {
  return String(texto || "")
    .replace(/[\u0000-\u001f\u007f\s]/g, "")
    .slice(0, TAMANHO_MAXIMO_CODIGO);
}

/**
 * EAN-8, UPC-A, EAN-13 e GTIN-14 são só dígitos com 8 a 14 posições.
 * Nesses casos a busca precisa ser exata: aproximar um código desconhecido
 * colocaria outro produto no carrinho.
 * @param {string} texto
 * @returns {boolean}
 */
export function pareceCodigoBarras(texto) {
  return /^\d{8,14}$/.test(String(texto || "").trim());
}
