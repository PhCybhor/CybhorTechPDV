/**
 * Serviço de relatórios: transforma a lista bruta de vendas em métricas
 * agregadas para o painel do administrador.
 */

const UM_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Ignora vendas canceladas nos totais e rankings.
 * @param {Array<object>} vendas
 * @returns {Array<object>}
 */
function vendasValidas(vendas) {
  return (vendas || []).filter((v) => !v.cancelada);
}

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
 * Custo unitário do item: snapshot da venda ou fallback do catálogo atual.
 * @param {object} item
 * @param {Map<string, object> | null} mapaProdutos
 * @returns {number | null}
 */
function custoUnitarioDoItem(item, mapaProdutos) {
  const snap = item.custoUnitario;
  if (snap !== null && snap !== undefined && snap !== "" && Number.isFinite(Number(snap))) {
    return Number(snap);
  }
  if (!mapaProdutos || !item.produtoId) return null;
  const produto = mapaProdutos.get(item.produtoId);
  const custo = produto?.custo;
  if (custo === null || custo === undefined || custo === "") return null;
  const n = Number(custo);
  return Number.isFinite(n) ? n : null;
}

/**
 * CMV e lucro bruto das vendas (somente itens com custo conhecido entram no CMV).
 * @param {Array<object>} vendas
 * @param {Array<object>} [produtos=[]]
 * @returns {{ cmv: number, lucroBruto: number, receitaComCusto: number, itensSemCusto: number }}
 */
export function calcularCmvELucro(vendas, produtos = []) {
  const mapaProdutos = new Map((produtos || []).map((p) => [p.id, p]));
  let cmv = 0;
  let receitaComCusto = 0;
  let itensSemCusto = 0;

  for (const venda of vendas || []) {
    for (const item of venda.itens || []) {
      const qtd = Number(item.quantidade) || 0;
      const receita = Number(item.subtotal);
      const receitaItem = Number.isFinite(receita)
        ? receita
        : (Number(item.precoUnitario) || 0) * qtd;
      const custoU = custoUnitarioDoItem(item, mapaProdutos);
      if (custoU === null) {
        itensSemCusto += qtd;
        continue;
      }
      cmv += custoU * qtd;
      receitaComCusto += receitaItem;
    }
  }

  return {
    cmv: Number(cmv.toFixed(2)),
    lucroBruto: Number((receitaComCusto - cmv).toFixed(2)),
    receitaComCusto: Number(receitaComCusto.toFixed(2)),
    itensSemCusto,
  };
}

/**
 * Agrega a quantidade e a receita por produto a partir dos itens das vendas.
 * @param {Array<object>} vendas
 * @returns {Array<{nome: string, quantidade: number, receita: number, cmv: number, lucro: number}>}
 */
function agregarPorProduto(vendas, mapaProdutos = null) {
  const mapa = new Map();

  for (const venda of vendas) {
    for (const item of venda.itens || []) {
      const chave = item.produtoId || item.nome;
      const atual = mapa.get(chave) || {
        nome: item.nome,
        quantidade: 0,
        receita: 0,
        cmv: 0,
        lucro: 0,
        temCusto: false,
      };
      const qtd = Number(item.quantidade) || 0;
      const receita = Number(item.subtotal) || 0;
      atual.quantidade += qtd;
      atual.receita += receita;
      const custoU = custoUnitarioDoItem(item, mapaProdutos);
      if (custoU !== null) {
        atual.cmv += custoU * qtd;
        atual.lucro += receita - custoU * qtd;
        atual.temCusto = true;
      }
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
  const lista = vendasValidas(vendas);
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
 * @param {{ produtos?: Array<object>, despesas?: Array<object>, competencia?: string }} [extras]
 */
export function gerarResumo(vendas, extras = {}) {
  const lista = vendasValidas(vendas);
  const produtos = extras.produtos || [];
  const despesas = extras.despesas || [];
  const mapaProdutos = new Map(produtos.map((p) => [p.id, p]));
  const inicioHoje = inicioDeHoje();
  const inicioMes = inicioDoMes();
  const inicioRecente = inicioHoje - 6 * UM_DIA_MS;

  const agora = new Date();
  const competencia =
    extras.competencia ||
    `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;

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

  const lucroMes = calcularCmvELucro(vendasMes, produtos);
  const despesasMes = (despesas || [])
    .filter((d) => d.competencia === competencia)
    .reduce((soma, d) => soma + (Number(d.valor) || 0), 0);
  const lucroLiquidoMes = Number((lucroMes.lucroBruto - despesasMes).toFixed(2));

  const maisVendidos = agregarPorProduto(vendasMes, mapaProdutos).slice(0, 8);
  const margemMedia =
    lucroMes.receitaComCusto > 0
      ? lucroMes.lucroBruto / lucroMes.receitaComCusto
      : 0;
  const pontoEquilibrio =
    margemMedia > 0 ? Number((despesasMes / margemMedia).toFixed(2)) : null;

  const produtosSemCusto = produtos.filter(
    (p) => p.custo === null || p.custo === undefined || p.custo === ""
  ).length;

  return {
    totalHoje: somarTotais(vendasHoje),
    quantidadeVendasHoje: vendasHoje.length,
    totalMes: somarTotais(vendasMes),
    maisVendidosMes: maisVendidos,
    emAltaRecente: agregarPorProduto(vendasRecentes, mapaProdutos).slice(0, 6),
    serieReceitaDiaria: receitaPorDia(lista, 7),
    vendasComDesconto,
    totalDescontosMes,
    cmvMes: lucroMes.cmv,
    lucroBrutoMes: lucroMes.lucroBruto,
    despesasMes,
    lucroLiquidoMes,
    pontoEquilibrio,
    itensSemCustoMes: lucroMes.itensSemCusto,
    produtosSemCusto,
    competencia,
  };
}
