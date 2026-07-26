import { formatarMoeda } from "../utils/formato.js";
import { competenciaDe, somarDespesasCompetencia } from "./despesaService.js";

/**
 * DRE simplificado do mês + “onde sumiu a margem”.
 */

export function montarDreMes(vendas, despesas, produtos = [], competencia) {
  const comp = competenciaDe(competencia || new Date());
  const [ano, mes] = comp.split("-").map(Number);
  const inicio = new Date(ano, mes - 1, 1).getTime();
  const fim = new Date(ano, mes, 1).getTime();

  const vendasMes = (vendas || []).filter(
    (v) => !v.cancelada && (v.criadoEm || 0) >= inicio && (v.criadoEm || 0) < fim
  );

  let receita = 0;
  let descontos = 0;
  let cmv = 0;
  let itensSemCusto = 0;

  for (const v of vendasMes) {
    receita += Number(v.total) || 0;
    descontos += Number(v.desconto) || 0;
    for (const i of v.itens || []) {
      const c = i.custoUnitario;
      if (c === null || c === undefined || c === "" || !Number.isFinite(Number(c))) {
        itensSemCusto += Number(i.quantidade) || 0;
      } else {
        cmv += Number(c) * (Number(i.quantidade) || 0);
      }
    }
  }

  const despesasMes = somarDespesasCompetencia(despesas, comp);
  const lucroBruto = receita - cmv;
  const lucroLiquido = lucroBruto - despesasMes;

  const mapaProd = new Map((produtos || []).map((p) => [p.id, p]));
  const margemMorta = [];
  for (const v of vendasMes) {
    for (const i of v.itens || []) {
      const custo = Number(i.custoUnitario);
      const preco = Number(i.precoUnitario);
      if (Number.isFinite(custo) && Number.isFinite(preco) && preco < custo) {
        margemMorta.push({
          nome: i.nome,
          preco,
          custo,
          vendaId: v.id,
        });
      } else if (!Number.isFinite(custo)) {
        const p = mapaProd.get(i.produtoId);
        if (p && Number(p.custo) > Number(p.preco)) {
          margemMorta.push({
            nome: i.nome,
            preco: Number(p.preco),
            custo: Number(p.custo),
            vendaId: v.id,
          });
        }
      }
    }
  }

  return {
    competencia: comp,
    receita,
    descontos,
    cmv,
    lucroBruto,
    despesasMes,
    lucroLiquido,
    quantidadeVendas: vendasMes.length,
    itensSemCusto,
    margemMorta: margemMorta.slice(0, 30),
  };
}

export function htmlDrePdf(dre) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DRE</title>
<style>body{font-family:Segoe UI,sans-serif;padding:28px;color:#111}h1{margin:0 0 8px}.linha{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee}.neg{color:#b91c1c}.pos{color:#15803d}</style>
</head><body>
<h1>DRE simplificado — ${dre.competencia}</h1>
<p>CybhorPDV · ${new Date().toLocaleString("pt-BR")}</p>
<div class="linha"><span>Receita líquida</span><strong>${formatarMoeda(dre.receita)}</strong></div>
<div class="linha"><span>(−) Descontos concedidos</span><span>${formatarMoeda(dre.descontos)}</span></div>
<div class="linha"><span>(−) CMV</span><span>${formatarMoeda(dre.cmv)}</span></div>
<div class="linha"><span>Lucro bruto</span><strong class="${dre.lucroBruto >= 0 ? "pos" : "neg"}">${formatarMoeda(dre.lucroBruto)}</strong></div>
<div class="linha"><span>(−) Despesas do mês</span><span>${formatarMoeda(dre.despesasMes)}</span></div>
<div class="linha"><span>Lucro líquido</span><strong class="${dre.lucroLiquido >= 0 ? "pos" : "neg"}">${formatarMoeda(dre.lucroLiquido)}</strong></div>
<p style="margin-top:20px;font-size:13px;color:#555">${dre.quantidadeVendas} venda(s) · ${dre.itensSemCusto} item(ns) sem custo no snapshot</p>
${
  dre.margemMorta?.length
    ? `<h2>Onde sumiu a margem (preço &lt; custo)</h2><ul>${dre.margemMorta
        .map(
          (m) =>
            `<li>${m.nome}: vendeu ${formatarMoeda(m.preco)} / custo ${formatarMoeda(m.custo)}</li>`
        )
        .join("")}</ul>`
    : ""
}
</body></html>`;
}

export function baixarHtmlComoArquivo(html, nomeArquivo) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
