import { formatarMoeda } from "../utils/formato.js";

/**
 * Gera insights acionáveis da loja (Pulso) a partir de dados já carregados.
 * Insights práticos: o que PDVs caros vendem como “BI” — aqui em linguagem de balcão.
 */

/**
 * @param {{
 *   vendas?: Array<object>,
 *   produtos?: Array<object>,
 *   despesas?: Array<object>,
 *   sangrias?: Array<object>,
 *   resumo?: object,
 * }} dados
 * @returns {Array<{ tipo: string, titulo: string, texto: string, acao?: string }>}
 */
export function gerarInsightsLoja(dados = {}) {
  const vendas = (dados.vendas || []).filter((v) => !v.cancelada);
  const produtos = dados.produtos || [];
  const resumo = dados.resumo || {};
  const insights = [];
  const agora = Date.now();
  const inicioHoje = new Date();
  inicioHoje.setHours(0, 0, 0, 0);
  const t0 = inicioHoje.getTime();
  const tOntem0 = t0 - 24 * 60 * 60 * 1000;

  const vendasHoje = vendas.filter((v) => (v.criadoEm || 0) >= t0);
  const vendasOntem = vendas.filter(
    (v) => (v.criadoEm || 0) >= tOntem0 && (v.criadoEm || 0) < t0
  );
  const totalHoje = vendasHoje.reduce((s, v) => s + (Number(v.total) || 0), 0);
  const totalOntem = vendasOntem.reduce((s, v) => s + (Number(v.total) || 0), 0);

  if (totalOntem > 0) {
    const delta = ((totalHoje - totalOntem) / totalOntem) * 100;
    if (delta <= -15) {
      insights.push({
        tipo: "alerta",
        titulo: "Dia mais fraco que ontem",
        texto: `Hoje ${formatarMoeda(totalHoje)} vs ontem ${formatarMoeda(totalOntem)} (${delta.toFixed(0)}%). Vale uma promoção relâmpago ou mensagem no WhatsApp da clientela.`,
        acao: "assistente-promocoes",
      });
    } else if (delta >= 20) {
      insights.push({
        tipo: "sucesso",
        titulo: "Dia forte",
        texto: `Você já está ${delta.toFixed(0)}% acima de ontem (${formatarMoeda(totalHoje)}). Proteja o estoque dos itens que estão saindo.`,
        acao: "produtos",
      });
    }
  }

  const lucroLiq = Number(resumo.lucroLiquidoMes) || 0;
  const despesasMes = Number(resumo.despesasMes) || 0;
  if (despesasMes > 0 && lucroLiq < 0) {
    insights.push({
      tipo: "alerta",
      titulo: "Lucro líquido negativo no mês",
      texto: `As despesas (${formatarMoeda(despesasMes)}) estão comendo a margem. Revise gastos ou preços dos itens sem custo cadastrado.`,
      acao: "relatorios-gastos",
    });
  } else if (lucroLiq > 0 && despesasMes > 0) {
    insights.push({
      tipo: "sucesso",
      titulo: "Loja no azul",
      texto: `Lucro líquido do mês: ${formatarMoeda(lucroLiq)} depois das despesas. Mantenha o custo dos produtos atualizado.`,
    });
  }

  const semCusto = produtos.filter((p) => {
    const c = p.custo;
    return c === null || c === undefined || c === "" || !Number.isFinite(Number(c));
  }).length;
  if (semCusto >= 3) {
    insights.push({
      tipo: "dica",
      titulo: `${semCusto} produtos sem custo`,
      texto: "Sem “quanto pagou”, o lucro fica pela metade. Cadastre o custo nos itens que mais vendem primeiro.",
      acao: "produtos",
    });
  }

  const estoqueBaixo = produtos.filter(
    (p) => (Number(p.estoque) || 0) > 0 && (Number(p.estoque) || 0) <= 5
  );
  const zerados = produtos.filter((p) => (Number(p.estoque) || 0) <= 0);
  if (zerados.length > 0) {
    insights.push({
      tipo: "alerta",
      titulo: `${zerados.length} produto(s) zerado(s)`,
      texto: "Item sem estoque = venda perdida. Peça reposição pelo WhatsApp do fornecedor certo.",
      acao: "fornecedores",
    });
  } else if (estoqueBaixo.length > 0) {
    insights.push({
      tipo: "dica",
      titulo: `${estoqueBaixo.length} item(ns) quase acabando`,
      texto: estoqueBaixo
        .slice(0, 4)
        .map((p) => p.nome)
        .join(", ")
        .concat(estoqueBaixo.length > 4 ? "…" : ""),
      acao: "fornecedores",
    });
  }

  const ticketMedio =
    vendasHoje.length > 0 ? totalHoje / vendasHoje.length : 0;
  if (vendasHoje.length >= 3 && ticketMedio > 0) {
    insights.push({
      tipo: "dica",
      titulo: `Ticket médio hoje: ${formatarMoeda(ticketMedio)}`,
      texto: "No caixa, ofereça 1 item “leva junto” (água, doce, sacola). Subir R$ 2–5 por venda muda o mês.",
      acao: "pdv",
    });
  }

  const descontosHoje = vendasHoje.reduce(
    (s, v) => s + (Number(v.desconto) || 0),
    0
  );
  if (totalHoje > 0 && descontosHoje / totalHoje > 0.08) {
    insights.push({
      tipo: "alerta",
      titulo: "Desconto alto hoje",
      texto: `${formatarMoeda(descontosHoje)} em descontos (${((descontosHoje / totalHoje) * 100).toFixed(0)}% do faturado). Confira se está combinado com a meta.`,
      acao: "relatorios",
    });
  }

  const hora = new Date(agora).getHours();
  if (hora >= 10 && hora <= 12 && vendasHoje.length === 0) {
    insights.push({
      tipo: "dica",
      titulo: "Manhã quieta",
      texto: "Abra com combo do dia na porta ou story. CybhorIA no modo Concorrência gera o texto em 30 segundos.",
      acao: "assistente-concorrencia",
    });
  }

  if (insights.length === 0) {
    insights.push({
      tipo: "sucesso",
      titulo: "Pulso estável",
      texto: "Sem alertas urgentes. Continue vendendo e registrando custo + despesas para o lucro ficar confiável.",
    });
  }

  return insights.slice(0, 6);
}
