/**
 * Servico de relatorios: transforma a lista bruta de vendas em metricas
 * agregadas para o painel do administrador.
 */

const UM_DIA_MS = 24 * 60 * 60 * 1000;

/** @returns {number} timestamp do inicio do dia de hoje. */
function inicioDeHoje() {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
}

/** @returns {number} timestamp do inicio do mes atual. */
function inicioDoMes() {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), 1).getTime();
}

/**
 * Agrega a quantidade e a receita por produto a partir dos itens das vendas.
 * @param {Array<object>} vendas
 * @returns {Array<{nome: string, quantidade: number, receita: number}>}
 */
function agregarPorProduto(vendas) {
  const mapa = new Map();

  for (const venda of vendas) {
    for (const item of venda.itens || []) {
      const chave = item.produtoId || item.nome;
      const atual = mapa.get(chave) || {
        nome: item.nome,
        quantidade: 0,
        receita: 0,
      };
      atual.quantidade += Number(item.quantidade) || 0;
      atual.receita += Number(item.subtotal) || 0;
      mapa.set(chave, atual);
    }
  }

  return Array.from(mapa.values()).sort((a, b) => b.quantidade - a.quantidade);
}

/**
 * Calcula a receita total de uma lista de vendas.
 * @param {Array<object>} vendas
 * @returns {number}
 */
function somarTotais(vendas) {
  return vendas.reduce((soma, venda) => soma + (Number(venda.total) || 0), 0);
}

/**
 * Monta a serie de receita por dia dos ultimos N dias (inclui dias sem venda).
 * @param {Array<object>} vendas
 * @param {number} [dias=7]
 * @returns {{rotulos: Array<string>, valores: Array<number>}}
 */
function receitaPorDia(vendas, dias = 7) {
  const rotulos = [];
  const valores = [];
  const inicioHoje = inicioDeHoje();

  for (let i = dias - 1; i >= 0; i--) {
    const inicioDia = inicioHoje - i * UM_DIA_MS;
    const fimDia = inicioDia + UM_DIA_MS;
    const totalDia = somarTotais(
      vendas.filter((v) => v.criadoEm >= inicioDia && v.criadoEm < fimDia)
    );

    const data = new Date(inicioDia);
    rotulos.push(
      data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    );
    valores.push(Number(totalDia.toFixed(2)));
  }

  return { rotulos, valores };
}

/**
 * Filtra e agrega as vendas de um dia especifico.
 * @param {Array<object>} vendas
 * @param {string} dataISO data no formato "AAAA-MM-DD"
 * @returns {{
 *   vendas: Array<object>,
 *   totalBruto: number,
 *   totalDescontos: number,
 *   totalLiquido: number,
 *   quantidadeVendas: number,
 *   itensVendidos: number
 * }}
 */
export function vendasDoDia(vendas, dataISO) {
  const lista = Array.isArray(vendas) ? vendas : [];
  const [ano, mes, dia] = (dataISO || "").split("-").map(Number);

  if (!ano || !mes || !dia) {
    return {
      vendas: [],
      totalBruto: 0,
      totalDescontos: 0,
      totalLiquido: 0,
      quantidadeVendas: 0,
      itensVendidos: 0,
    };
  }

  const inicio = new Date(ano, mes - 1, dia).getTime();
  const fim = inicio + UM_DIA_MS;

  const vendasFiltradas = lista
    .filter((v) => v.criadoEm >= inicio && v.criadoEm < fim)
    .sort((a, b) => a.criadoEm - b.criadoEm);

  const totalDescontos = vendasFiltradas.reduce(
    (soma, v) => soma + (Number(v.desconto) || 0),
    0
  );
  const totalLiquido = somarTotais(vendasFiltradas);
  const itensVendidos = vendasFiltradas.reduce(
    (soma, v) =>
      soma +
      (v.itens || []).reduce((s, i) => s + (Number(i.quantidade) || 0), 0),
    0
  );

  return {
    vendas: vendasFiltradas,
    totalBruto: totalLiquido + totalDescontos,
    totalDescontos,
    totalLiquido,
    quantidadeVendas: vendasFiltradas.length,
    itensVendidos,
  };
}

/**
 * Gera o resumo completo de relatorios do administrador.
 * @param {Array<object>} vendas
 * @returns {{
 *   totalHoje: number,
 *   quantidadeVendasHoje: number,
 *   totalMes: number,
 *   maisVendidosMes: Array<object>,
 *   emAltaRecente: Array<object>,
 *   serieReceitaDiaria: {rotulos: Array<string>, valores: Array<number>},
 *   vendasComDesconto: Array<object>,
 *   totalDescontosMes: number
 * }}
 */
export function gerarResumo(vendas) {
  const lista = Array.isArray(vendas) ? vendas : [];
  const inicioHoje = inicioDeHoje();
  const inicioMes = inicioDoMes();
  const inicioRecente = inicioHoje - 6 * UM_DIA_MS;

  const vendasHoje = lista.filter((v) => v.criadoEm >= inicioHoje);
  const vendasMes = lista.filter((v) => v.criadoEm >= inicioMes);
  const vendasRecentes = lista.filter((v) => v.criadoEm >= inicioRecente);

  const vendasComDesconto = lista
    .filter((v) => (Number(v.desconto) || 0) > 0)
    .sort((a, b) => b.criadoEm - a.criadoEm)
    .slice(0, 50);

  const totalDescontosMes = vendasMes.reduce(
    (soma, v) => soma + (Number(v.desconto) || 0),
    0
  );

  return {
    totalHoje: somarTotais(vendasHoje),
    quantidadeVendasHoje: vendasHoje.length,
    totalMes: somarTotais(vendasMes),
    maisVendidosMes: agregarPorProduto(vendasMes).slice(0, 8),
    emAltaRecente: agregarPorProduto(vendasRecentes).slice(0, 6),
    serieReceitaDiaria: receitaPorDia(lista, 7),
    vendasComDesconto,
    totalDescontosMes,
  };
}
