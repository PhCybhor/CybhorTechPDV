import { formatarMoeda } from "../utils/formato.js";

/**
 * Monta pedido de compra a partir de estoque baixo / giro.
 */

/**
 * @param {Array<object>} produtos
 * @param {Array<object>} vendas
 * @param {number} [diasJanela=14]
 */
export function preverDiasEstoque(produtos, vendas, diasJanela = 14) {
  const inicio = Date.now() - diasJanela * 86400000;
  const saida = new Map();
  for (const v of vendas || []) {
    if (v.cancelada || (v.criadoEm || 0) < inicio) continue;
    for (const i of v.itens || []) {
      if (!i.produtoId) continue;
      saida.set(
        i.produtoId,
        (saida.get(i.produtoId) || 0) + (Number(i.quantidade) || 0)
      );
    }
  }
  return (produtos || []).map((p) => {
    const vendidos = saida.get(p.id) || 0;
    const mediaDia = vendidos / diasJanela;
    const estoque = Number(p.estoque) || 0;
    const dias =
      mediaDia > 0 ? Math.floor(estoque / mediaDia) : estoque > 0 ? 999 : 0;
    return {
      ...p,
      mediaDia: Math.round(mediaDia * 100) / 100,
      diasEstoque: dias,
    };
  });
}

/**
 * @param {Array<object>} produtosComGiro
 * @param {number} [diasAlvo=7]
 */
export function montarItensPedido(produtosComGiro, diasAlvo = 7) {
  return (produtosComGiro || [])
    .filter((p) => {
      const est = Number(p.estoque) || 0;
      if (est <= 0) return true;
      if (p.diasEstoque != null && p.diasEstoque < diasAlvo) return true;
      return false;
    })
    .map((p) => {
      const media = Number(p.mediaDia) || 0;
      const sugerido = Math.max(
        1,
        Math.ceil(media * diasAlvo - (Number(p.estoque) || 0))
      );
      return {
        produtoId: p.id,
        nome: p.nome,
        estoque: Number(p.estoque) || 0,
        diasEstoque: p.diasEstoque,
        quantidadeSugerida: sugerido,
        custo: Number(p.custo) || 0,
      };
    })
    .sort((a, b) => (a.diasEstoque ?? 0) - (b.diasEstoque ?? 0));
}

export function textoPedidoCompra({ lojaNome, fornecedorNome, itens }) {
  const linhas = (itens || [])
    .map(
      (i) =>
        `• ${i.nome} — pedir ${i.quantidadeSugerida} (estoque ${i.estoque}${
          i.diasEstoque != null && i.diasEstoque < 999
            ? `, ~${i.diasEstoque}d`
            : ""
        })`
    )
    .join("\n");
  const totalCusto = (itens || []).reduce(
    (s, i) => s + (Number(i.custo) || 0) * (Number(i.quantidadeSugerida) || 0),
    0
  );
  return (
    `Pedido de compra — ${lojaNome || "loja"}\n` +
    (fornecedorNome ? `Fornecedor: ${fornecedorNome}\n` : "") +
    `${linhas || "• (sem itens)"}\n` +
    (totalCusto > 0 ? `Estimativa custo: ${formatarMoeda(totalCusto)}\n` : "") +
    `Pode confirmar disponibilidade?`
  );
}

export function htmlPedidoCompraPdf({ lojaNome, itens }) {
  const rows = (itens || [])
    .map(
      (i) =>
        `<tr><td>${escape(i.nome)}</td><td>${i.estoque}</td><td>${
          i.quantidadeSugerida
        }</td><td>${
          i.custo ? formatarMoeda(i.custo * i.quantidadeSugerida) : "—"
        }</td></tr>`
    )
    .join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pedido</title>
<style>body{font-family:Segoe UI,sans-serif;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px;text-align:left}</style>
</head><body>
<h1>Pedido de compra</h1>
<p>${escape(lojaNome || "Loja")} — ${new Date().toLocaleString("pt-BR")}</p>
<table><thead><tr><th>Produto</th><th>Estoque</th><th>Pedir</th><th>Custo est.</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
}

function escape(t) {
  return String(t || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
