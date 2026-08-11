import { caminhoLoja } from "./tenantContext.js";
import { obterDatabase } from "../config/databaseClient.js";
import { ref, push, get, query, orderByChild, startAt, endAt } from "../config/databaseClient.js";

/**
 * Agrega vendas do dia para fechamento de caixa.
 * @param {Array<object>} vendas
 * @param {number} [inicioMs]
 * @param {number} [fimMs]
 */
export function resumirFechamento(vendas, inicioMs, fimMs) {
  const inicio =
    inicioMs ??
    new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      new Date().getDate()
    ).getTime();
  const fim = fimMs ?? inicio + 24 * 60 * 60 * 1000;

  const doDia = (vendas || []).filter((v) => {
    const t = Number(v.criadoEm) || 0;
    return t >= inicio && t < fim;
  });

  const ativas = doDia.filter((v) => !v.cancelada);
  const canceladas = doDia.filter((v) => v.cancelada);

  const porForma = {};
  const porOperador = {};
  let bruto = 0;
  let descontos = 0;
  let itens = 0;

  for (const v of ativas) {
    const total = Number(v.total) || 0;
    const desc = Number(v.desconto) || 0;
    bruto += total;
    descontos += desc;
    itens += (v.itens || []).reduce((s, i) => s + (Number(i.quantidade) || 0), 0);

    const partes =
      Array.isArray(v.formasPagamento) && v.formasPagamento.length
        ? v.formasPagamento
        : [{ tipo: v.formaPagamento || "outros", valor: total }];
    for (const p of partes) {
      const tipo = p.tipo || "outros";
      porForma[tipo] = (porForma[tipo] || 0) + (Number(p.valor) || 0);
    }

    const op = v.funcionarioNome || "—";
    porOperador[op] = (porOperador[op] || 0) + total;
  }

  return {
    inicio,
    fim,
    quantidadeVendas: ativas.length,
    quantidadeCanceladas: canceladas.length,
    itensVendidos: itens,
    totalLiquido: bruto,
    totalDescontos: descontos,
    porForma,
    porOperador,
    vendas: ativas,
  };
}

/**
 * Persiste um fechamento no RTDB da loja.
 * @param {object} resumo
 * @param {{id: string, nome: string}} funcionario
 */
export async function registrarFechamento(resumo, funcionario) {
  const db = await obterDatabase();
  const caminho = caminhoLoja("fechamentos");
  const referencia = await push(ref(db, caminho), {
    ...resumo,
    vendas: undefined,
    funcionarioId: funcionario.id,
    funcionarioNome: funcionario.nome,
    criadoEm: Date.now(),
  });
  return referencia.key;
}

/**
 * Lista fechamentos recentes (últimos 30 dias).
 */
export async function listarFechamentosRecentes() {
  const db = await obterDatabase();
  const inicio = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const consulta = query(
    ref(db, caminhoLoja("fechamentos")),
    orderByChild("criadoEm"),
    startAt(inicio),
    endAt(Date.now() + 1000)
  );
  const snap = await get(consulta);
  if (!snap.exists()) return [];
  return Object.entries(snap.val())
    .map(([id, dados]) => ({ id, ...dados }))
    .sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
}
