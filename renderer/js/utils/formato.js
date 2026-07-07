const formatadorMoeda = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/**
 * Formata um valor numerico como moeda brasileira (R$).
 * @param {number} valor
 * @returns {string}
 */
export function formatarMoeda(valor) {
  return formatadorMoeda.format(Number(valor) || 0);
}
