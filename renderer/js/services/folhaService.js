/**
 * Auxiliar de pagamento CLT / PJ (estimativas 2026).
 * Não substitui contador nem orientação jurídica — valores aproximados para planejamento.
 */

export const VIGENCIAS = Object.freeze({
  ano: 2026,
  salarioMinimo: 1621,
  tetoInss: 8475.55,
  inssMaximo: 988.09,
  fgtsAliquota: 0.08,
  /** Estimativa média de encargos patronais (INSS patronal + RAT/terceiros) — ajustável. */
  encargosPatronaisPadrao: 0.28,
  deducaoDependenteIr: 189.59,
  descontoSimplificadoIr: 607.2,
  irIsencaoBase: 5000,
  irRedutorFim: 7350,
  fonte:
    "Tabelas INSS/IRRF 2026 (Portaria MPS/MF e reforma do IR). Use com contador.",
});

/** Faixas INSS empregado (parcela a deduzir). */
const FAIXAS_INSS = [
  { ate: 1621.0, aliquota: 0.075, deduzir: 0 },
  { ate: 2902.84, aliquota: 0.09, deduzir: 24.32 },
  { ate: 4354.27, aliquota: 0.12, deduzir: 111.4 },
  { ate: 8475.55, aliquota: 0.14, deduzir: 198.49 },
];

/** Tabela IRRF cheia (maio/2025, vigente em 2026). */
const FAIXAS_IRRF = [
  { ate: 2428.8, aliquota: 0, deduzir: 0 },
  { ate: 2826.65, aliquota: 0.075, deduzir: 182.16 },
  { ate: 3751.05, aliquota: 0.15, deduzir: 394.16 },
  { ate: 4664.68, aliquota: 0.225, deduzir: 675.49 },
  { ate: Infinity, aliquota: 0.275, deduzir: 908.73 },
];

export const TIPOS_VINCULO = Object.freeze({
  CLT: "clt",
  PJ: "pj",
  MEI: "mei",
});

/**
 * @param {number} salarioBruto
 * @returns {number}
 */
export function calcularInssEmpregado(salarioBruto) {
  const base = Math.min(Math.max(0, Number(salarioBruto) || 0), VIGENCIAS.tetoInss);
  if (base <= 0) return 0;
  if ((Number(salarioBruto) || 0) >= VIGENCIAS.tetoInss) {
    return VIGENCIAS.inssMaximo;
  }

  for (const faixa of FAIXAS_INSS) {
    if (base <= faixa.ate) {
      return Number(Math.max(0, base * faixa.aliquota - faixa.deduzir).toFixed(2));
    }
  }
  return VIGENCIAS.inssMaximo;
}

/**
 * IRRF pela tabela cheia (sem redutor da reforma).
 * @param {number} base
 * @returns {number}
 */
function irrfTabelaCheia(base) {
  const b = Math.max(0, Number(base) || 0);
  for (const faixa of FAIXAS_IRRF) {
    if (b <= faixa.ate) {
      return Number(Math.max(0, b * faixa.aliquota - faixa.deduzir).toFixed(2));
    }
  }
  return 0;
}

/**
 * Aplica redutor da reforma do IR 2026 sobre o imposto da tabela.
 * @param {number} base
 * @param {number} irCheio
 * @returns {number}
 */
function aplicarRedutorIr(base, irCheio) {
  const b = Number(base) || 0;
  const ir = Math.max(0, Number(irCheio) || 0);
  if (b <= VIGENCIAS.irIsencaoBase) return 0;
  if (b >= VIGENCIAS.irRedutorFim) return ir;
  const faixa = VIGENCIAS.irRedutorFim - VIGENCIAS.irIsencaoBase;
  return Number(((ir * (b - VIGENCIAS.irIsencaoBase)) / faixa).toFixed(2));
}

/**
 * @param {number} salarioBruto
 * @param {number} inss
 * @param {number} [dependentes=0]
 * @returns {{ base: number, irrf: number, deducaoAplicada: number, usouSimplificado: boolean }}
 */
export function calcularIrrf(salarioBruto, inss, dependentes = 0) {
  const bruto = Math.max(0, Number(salarioBruto) || 0);
  const deps = Math.max(0, Math.floor(Number(dependentes) || 0));
  const deducaoLegal =
    (Number(inss) || 0) + deps * VIGENCIAS.deducaoDependenteIr;
  const usouSimplificado = VIGENCIAS.descontoSimplificadoIr > deducaoLegal;
  const deducaoAplicada = Math.max(
    deducaoLegal,
    VIGENCIAS.descontoSimplificadoIr
  );
  const base = Math.max(0, bruto - deducaoAplicada);
  const irCheio = irrfTabelaCheia(base);
  const irrf = aplicarRedutorIr(base, irCheio);
  return {
    base: Number(base.toFixed(2)),
    irrf,
    deducaoAplicada: Number(deducaoAplicada.toFixed(2)),
    usouSimplificado,
  };
}

/**
 * Simula holerite CLT mensal + custo aproximado para a loja.
 * @param {{
 *   salarioBruto: number,
 *   dependentes?: number,
 *   valeTransporte?: number,
 *   outrosDescontos?: number,
 *   encargosPatronais?: number
 * }} entrada
 */
export function simularClt(entrada) {
  const salarioBruto = Math.max(0, Number(entrada.salarioBruto) || 0);
  const dependentes = Math.max(0, Math.floor(Number(entrada.dependentes) || 0));
  const valeTransporte = Math.max(0, Number(entrada.valeTransporte) || 0);
  const outrosDescontos = Math.max(0, Number(entrada.outrosDescontos) || 0);
  const encargosPatronais =
    entrada.encargosPatronais === undefined || entrada.encargosPatronais === ""
      ? VIGENCIAS.encargosPatronaisPadrao
      : Math.max(0, Number(entrada.encargosPatronais) || 0);

  const inss = calcularInssEmpregado(salarioBruto);
  const { base, irrf, deducaoAplicada, usouSimplificado } = calcularIrrf(
    salarioBruto,
    inss,
    dependentes
  );

  // Empregado pode ter até 6% do salário descontado de VT (CLT art. 462 / Lei 7.418)
  const tetoDescontoVt = Number((salarioBruto * 0.06).toFixed(2));
  const descontoVt = Math.min(valeTransporte, tetoDescontoVt);
  const custoVtEmpresa = Math.max(0, valeTransporte - descontoVt);

  const descontosEmpregado = Number(
    (inss + irrf + descontoVt + outrosDescontos).toFixed(2)
  );
  const liquido = Number(Math.max(0, salarioBruto - descontosEmpregado).toFixed(2));

  const fgts = Number((salarioBruto * VIGENCIAS.fgtsAliquota).toFixed(2));
  const provisao13 = Number((salarioBruto / 12).toFixed(2));
  const provisaoFerias = Number(((salarioBruto + salarioBruto / 3) / 12).toFixed(2));
  const encargos = Number((salarioBruto * encargosPatronais).toFixed(2));
  const custoMensalEmpresa = Number(
    (
      salarioBruto +
      fgts +
      encargos +
      provisao13 +
      provisaoFerias +
      custoVtEmpresa
    ).toFixed(2)
  );

  return {
    tipo: TIPOS_VINCULO.CLT,
    salarioBruto,
    inss,
    irrf,
    baseIr: base,
    deducaoIr: deducaoAplicada,
    usouSimplificado,
    descontoVt,
    custoVtEmpresa,
    outrosDescontos,
    descontosEmpregado,
    liquido,
    fgts,
    provisao13,
    provisaoFerias,
    encargos,
    encargosAliquota: encargosPatronais,
    custoMensalEmpresa,
    alertas: montarAlertasClt(salarioBruto, liquido),
    checklist: CHECKLIST_CLT,
  };
}

/**
 * Simula pagamento a PJ/MEI (NF) e compara com CLT equivalente.
 * @param {{
 *   valorNota: number,
 *   regime?: 'pj' | 'mei',
 *   aliquotaImpostosPj?: number,
 *   diasTrabalhados?: number
 * }} entrada
 */
export function simularPj(entrada) {
  const valorNota = Math.max(0, Number(entrada.valorNota) || 0);
  const regime =
    entrada.regime === TIPOS_VINCULO.MEI ? TIPOS_VINCULO.MEI : TIPOS_VINCULO.PJ;
  const aliquota =
    entrada.aliquotaImpostosPj === undefined || entrada.aliquotaImpostosPj === ""
      ? regime === TIPOS_VINCULO.MEI
        ? 0.06
        : 0.15
      : Math.max(0, Number(entrada.aliquotaImpostosPj) || 0);

  const impostosEstimados = Number((valorNota * aliquota).toFixed(2));
  const liquidoPrestador = Number((valorNota - impostosEstimados).toFixed(2));

  // Custo da loja: paga a NF (sem FGTS/13º/férias) — mas risco trabalhista se houver vínculo
  const custoLoja = valorNota;

  const meiDasMinimo =
    regime === TIPOS_VINCULO.MEI
      ? Number((VIGENCIAS.salarioMinimo * 0.05).toFixed(2))
      : null;

  return {
    tipo: regime,
    valorNota,
    aliquotaImpostos: aliquota,
    impostosEstimados,
    liquidoPrestador,
    custoLoja,
    meiDasMinimo,
    alertas: montarAlertasPj(regime, valorNota),
    checklist: CHECKLIST_PJ,
  };
}

/**
 * Sugere valor de NF PJ para aproximar o líquido CLT + compensar benefícios.
 * @param {number} liquidoCltDesejado
 * @param {number} [fatorBeneficios=1.35] compensação aproximada de 13º/férias/FGTS
 * @param {number} [aliquotaImpostos=0.15]
 */
export function sugerirValorNotaParaLiquidoClt(
  liquidoCltDesejado,
  fatorBeneficios = 1.35,
  aliquotaImpostos = 0.15
) {
  const alvo = Math.max(0, Number(liquidoCltDesejado) || 0) * fatorBeneficios;
  const aliq = Math.min(0.9, Math.max(0, Number(aliquotaImpostos) || 0));
  const valorNota = aliq >= 1 ? alvo : alvo / (1 - aliq);
  return Number(valorNota.toFixed(2));
}

function montarAlertasClt(bruto, liquido) {
  const alertas = [];
  if (bruto > 0 && bruto < VIGENCIAS.salarioMinimo) {
    alertas.push(
      `Salário abaixo do mínimo nacional 2026 (R$ ${VIGENCIAS.salarioMinimo.toFixed(2)}). Verifique a legalidade.`
    );
  }
  if (liquido < bruto * 0.7 && bruto > 3000) {
    alertas.push(
      "Descontos altos neste salário — confira dependentes, VT e outros abatimentos."
    );
  }
  alertas.push(
    "FGTS (8%), 13º e férias+1/3 são obrigações CLT — já entram na estimativa de custo da loja."
  );
  return alertas;
}

function montarAlertasPj(regime, valorNota) {
  const alertas = [
    "PJ/MEI NÃO substitui CLT se houver subordinação, horário fixo, pessoalidade e habitualidade (risco de vínculo).",
    "Exija NF válida, contrato de prestação de serviço e que o prestador tenha autonomia.",
    "A loja não recolhe FGTS/INSS de empregado sobre PJ — o prestador responde pelos próprios tributos.",
  ];
  if (regime === TIPOS_VINCULO.MEI && valorNota > 6750) {
    alertas.push(
      "Atenção ao limite anual do MEI (verifique o teto vigente no ano). Acima do limite, o enquadramento pode ser irregular."
    );
  }
  return alertas;
}

export const CHECKLIST_CLT = [
  "Contrato de trabalho / registro em CTPS e eSocial",
  "Salário ≥ mínimo nacional ou piso da categoria",
  "Recolhimento de INSS do empregado + patronal",
  "Depósito mensal de FGTS (8%)",
  "13º salário e férias com 1/3 constitucional",
  "Jornada, intervalo e horas extras conforme CLT",
  "Entrega de holerite / demonstrativo mensal",
];

export const CHECKLIST_PJ = [
  "Contrato de prestação de serviço (objeto, prazo, valor, NF)",
  "Prestador com CNPJ ativo (MEI/LTDA/etc.) e autonomia",
  "Sem exclusividade forçada, sem subordinação típica de emprego",
  "Pagamento mediante nota fiscal (não “salário” fixo disfarçado)",
  "Prestador emite NF e recolhe seus tributos (DAS/Simples etc.)",
  "Evitar uniforme, ponto eletrônico e ordens como empregado",
  "Se a realidade for de emprego, regularize como CLT (evita processo)",
];

/**
 * Texto curto para colar em despesa / lembrete.
 * @param {object} simulacao
 * @param {string} [nome]
 */
export function resumoPagamentoTexto(simulacao, nome = "") {
  const quem = nome ? ` (${nome})` : "";
  if (simulacao.tipo === TIPOS_VINCULO.CLT) {
    return `CLT${quem}: bruto ${fmt(simulacao.salarioBruto)} → líquido ${fmt(
      simulacao.liquido
    )} | custo loja ~ ${fmt(simulacao.custoMensalEmpresa)}`;
  }
  return `${String(simulacao.tipo).toUpperCase()}${quem}: NF ${fmt(
    simulacao.valorNota
  )} → líquido prestador ~ ${fmt(simulacao.liquidoPrestador)} | custo loja ${fmt(
    simulacao.custoLoja
  )}`;
}

function fmt(n) {
  return Number(n || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
