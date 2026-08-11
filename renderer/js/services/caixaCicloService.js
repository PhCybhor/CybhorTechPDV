import { ref, get, set, push, onValue, remove } from "../config/databaseClient.js";
import { obterDatabase } from "../config/databaseClient.js";
import { caminhoLoja } from "./tenantContext.js";

/**
 * Ciclo de caixa: fundo inicial + suprimentos (entrada de dinheiro no gaveteiro).
 * Esperado em dinheiro = fundo + suprimentos + vendas dinheiro − sangrias.
 */

function caminhoEstado() {
  return caminhoLoja("caixaEstado");
}

function caminhoSuprimentos() {
  return caminhoLoja("suprimentos");
}

function inicioFimDoDia(ms = Date.now()) {
  const d = new Date(ms);
  const inicio = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return { inicio, fim: inicio + 24 * 60 * 60 * 1000 };
}

/**
 * @returns {Promise<{ fundoInicial: number, abertoEm: number | null, abertoPorNome: string | null }>}
 */
export async function lerEstadoCaixa() {
  const db = await obterDatabase();
  const snap = await get(ref(db, caminhoEstado()));
  const v = snap.val() || {};
  return {
    fundoInicial: Number(v.fundoInicial) || 0,
    abertoEm: v.abertoEm || null,
    abertoPorNome: v.abertoPorNome || null,
  };
}

/**
 * @param {{ fundoInicial: number, funcionario: { id: string, nome: string } }} dados
 */
export async function abrirCaixaDia({ fundoInicial, funcionario }) {
  const valor = Number(fundoInicial);
  if (!Number.isFinite(valor) || valor < 0) {
    throw new Error("Fundo de caixa inválido.");
  }
  const db = await obterDatabase();
  const { inicio } = inicioFimDoDia();
  await set(ref(db, caminhoEstado()), {
    fundoInicial: valor,
    abertoEm: Date.now(),
    abertoDiaInicio: inicio,
    abertoPorId: funcionario?.id || null,
    abertoPorNome: funcionario?.nome || null,
  });
}

/**
 * True se o caixa já foi aberto hoje (fundo registrado no dia).
 */
export async function caixaAbertoHoje() {
  const estado = await lerEstadoCaixa();
  if (!estado.abertoEm) return false;
  const { inicio, fim } = inicioFimDoDia();
  const t = Number(estado.abertoEm) || 0;
  return t >= inicio && t < fim;
}

/**
 * @param {object} dados
 * @returns {Promise<string>}
 */
export async function registrarSuprimento({ valor, motivo, funcionario }) {
  const v = Number(valor);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error("Informe um valor de suprimento maior que zero.");
  }
  const db = await obterDatabase();
  const refNovo = await push(ref(db, caminhoSuprimentos()), {
    valor: v,
    motivo: String(motivo || "Suprimento de caixa").trim(),
    funcionarioId: funcionario?.id || null,
    funcionarioNome: funcionario?.nome || null,
    criadoEm: Date.now(),
  });
  return refNovo.key;
}

/**
 * @param {(lista: Array<object>) => void} callback
 */
export async function observarSuprimentos(callback) {
  const db = await obterDatabase();
  return onValue(ref(db, caminhoSuprimentos()), (snap) => {
    const valor = snap.val() || {};
    const lista = Object.entries(valor).map(([id, d]) => ({ id, ...d }));
    callback(lista.sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0)));
  });
}

/**
 * @param {string} id
 */
export async function excluirSuprimento(id) {
  if (!id) return;
  const db = await obterDatabase();
  await remove(ref(db, `${caminhoSuprimentos()}/${id}`));
}

/**
 * @param {Array<object>} suprimentos
 * @param {number} [diaMs]
 */
export function somarSuprimentosDoDia(suprimentos, diaMs = Date.now()) {
  const { inicio, fim } = inicioFimDoDia(diaMs);
  return (suprimentos || [])
    .filter((s) => {
      const t = Number(s.criadoEm) || 0;
      return t >= inicio && t < fim;
    })
    .reduce((soma, s) => soma + (Number(s.valor) || 0), 0);
}

/**
 * Dinheiro esperado no gaveteiro.
 * @param {{
 *   fundoInicial?: number,
 *   suprimentosDia?: number,
 *   vendasDinheiro?: number,
 *   sangriasDia?: number,
 * }} p
 */
export function calcularDinheiroEsperado({
  fundoInicial = 0,
  suprimentosDia = 0,
  vendasDinheiro = 0,
  sangriasDia = 0,
}) {
  return (
    (Number(fundoInicial) || 0) +
    (Number(suprimentosDia) || 0) +
    (Number(vendasDinheiro) || 0) -
    (Number(sangriasDia) || 0)
  );
}

/**
 * Soma parte em dinheiro de uma venda (split ou forma única).
 * @param {object} venda
 */
export function valorDinheiroDaVenda(venda) {
  if (!venda || venda.cancelada) return 0;
  const partes = venda.formasPagamento;
  if (Array.isArray(partes) && partes.length) {
    return partes
      .filter((p) => p.tipo === "dinheiro")
      .reduce((s, p) => s + (Number(p.valor) || 0), 0);
  }
  if (venda.formaPagamento === "dinheiro") {
    return Number(venda.total) || 0;
  }
  return 0;
}

/**
 * @param {Array<object>} vendas
 * @param {number} [diaMs]
 */
export function somarVendasDinheiroDoDia(vendas, diaMs = Date.now()) {
  const { inicio, fim } = inicioFimDoDia(diaMs);
  return (vendas || [])
    .filter((v) => {
      if (v.cancelada) return false;
      const t = Number(v.criadoEm) || 0;
      return t >= inicio && t < fim;
    })
    .reduce((s, v) => s + valorDinheiroDaVenda(v), 0);
}
