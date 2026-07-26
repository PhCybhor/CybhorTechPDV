/**
 * Associações “quem comprou X também levou Y” a partir do histórico de vendas.
 * Alimenta upsell no PDV sem IA — instantâneo e offline.
 */

/**
 * @param {Array<object>} vendas
 * @param {string} produtoId
 * @param {{ limite?: number, excluirIds?: Set<string> | string[] }} [opcoes]
 * @returns {Array<{ produtoId: string, vezes: number, score: number }>}
 */
export function sugerirCompradosJuntos(vendas, produtoId, opcoes = {}) {
  if (!produtoId) return [];
  const limite = opcoes.limite ?? 4;
  const excluir = new Set(
    opcoes.excluirIds
      ? Array.isArray(opcoes.excluirIds)
        ? opcoes.excluirIds
        : Array.from(opcoes.excluirIds)
      : []
  );
  excluir.add(produtoId);

  /** @type {Map<string, number>} */
  const contagem = new Map();
  let cestasComAlvo = 0;

  for (const venda of vendas || []) {
    if (venda.cancelada) continue;
    const ids = [
      ...new Set(
        (venda.itens || [])
          .map((i) => i.produtoId)
          .filter(Boolean)
      ),
    ];
    if (!ids.includes(produtoId)) continue;
    if (ids.length < 2) continue;
    cestasComAlvo += 1;
    for (const id of ids) {
      if (excluir.has(id)) continue;
      contagem.set(id, (contagem.get(id) || 0) + 1);
    }
  }

  if (cestasComAlvo === 0) return [];

  return Array.from(contagem.entries())
    .map(([id, vezes]) => ({
      produtoId: id,
      vezes,
      score: vezes / cestasComAlvo,
    }))
    .sort((a, b) => b.vezes - a.vezes || b.score - a.score)
    .slice(0, limite);
}

/**
 * Sugestões a partir de vários itens do carrinho (união ponderada).
 * @param {Array<object>} vendas
 * @param {string[]} produtoIdsNoCarrinho
 * @param {number} [limite=4]
 */
export function sugerirParaCarrinho(vendas, produtoIdsNoCarrinho, limite = 4) {
  const noCarrinho = new Set(produtoIdsNoCarrinho || []);
  /** @type {Map<string, number>} */
  const scores = new Map();

  for (const id of noCarrinho) {
    const lista = sugerirCompradosJuntos(vendas, id, {
      limite: 8,
      excluirIds: noCarrinho,
    });
    for (const s of lista) {
      scores.set(s.produtoId, (scores.get(s.produtoId) || 0) + s.vezes);
    }
  }

  return Array.from(scores.entries())
    .map(([produtoId, vezes]) => ({ produtoId, vezes, score: vezes }))
    .sort((a, b) => b.vezes - a.vezes)
    .slice(0, limite);
}
