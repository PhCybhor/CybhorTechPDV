import { ref, get, push, update, remove, onValue } from "../config/databaseClient.js";
import { obterDatabase } from "../config/databaseClient.js";
import { caminhoLoja } from "./tenantContext.js";

function caminho() {
  return caminhoLoja("clientes");
}

function mapear(valor) {
  if (!valor) return [];
  return Object.entries(valor).map(([id, d]) => ({ id, ...d }));
}

function normalizar(dados) {
  const nome = String(dados.nome || "").trim();
  if (nome.length < 2) throw new Error("Informe o nome do cliente.");
  const limite = Number(dados.limiteFiado);
  return {
    nome,
    whatsapp: String(dados.whatsapp || "").trim(),
    telefone: String(dados.telefone || "").trim(),
    aniversario: String(dados.aniversario || "").trim(), // MM-DD
    limiteFiado: Number.isFinite(limite) && limite >= 0 ? limite : 0,
    saldoFiado: Number(dados.saldoFiado) || 0,
    pontosFidelidade: Number(dados.pontosFidelidade) || 0,
    cashbackSaldo: Number(dados.cashbackSaldo) || 0,
    observacao: String(dados.observacao || "").trim(),
    ativo: dados.ativo !== false,
  };
}

export async function observarClientes(callback) {
  const db = await obterDatabase();
  return onValue(ref(db, caminho()), (snap) => {
    callback(
      mapear(snap.val()).sort((a, b) =>
        String(a.nome).localeCompare(String(b.nome), "pt-BR")
      )
    );
  });
}

export async function criarCliente(dados) {
  const n = normalizar({ ...dados, saldoFiado: 0, pontosFidelidade: 0, cashbackSaldo: 0 });
  const db = await obterDatabase();
  const r = await push(ref(db, caminho()), { ...n, criadoEm: Date.now() });
  return r.key;
}

export async function atualizarCliente(id, dados) {
  if (!id) throw new Error("Cliente inválido.");
  const atual = await obterCliente(id);
  const n = normalizar({
    ...atual,
    ...dados,
    saldoFiado: dados.saldoFiado ?? atual?.saldoFiado,
    pontosFidelidade: dados.pontosFidelidade ?? atual?.pontosFidelidade,
    cashbackSaldo: dados.cashbackSaldo ?? atual?.cashbackSaldo,
  });
  const db = await obterDatabase();
  await update(ref(db, `${caminho()}/${id}`), { ...n, atualizadoEm: Date.now() });
}

export async function obterCliente(id) {
  if (!id) return null;
  const db = await obterDatabase();
  const snap = await get(ref(db, `${caminho()}/${id}`));
  if (!snap.exists()) return null;
  return { id, ...snap.val() };
}

export async function excluirCliente(id) {
  if (!id) throw new Error("Cliente inválido.");
  const db = await obterDatabase();
  await remove(ref(db, `${caminho()}/${id}`));
}

/**
 * Ajusta fiado / cashback / pontos após venda.
 */
export async function aplicarPosVendaCliente(clienteId, {
  total = 0,
  foiFiado = false,
  cashbackPct = 0,
  pontosPorReal = 0.1,
}) {
  if (!clienteId) return;
  const c = await obterCliente(clienteId);
  if (!c) return;
  let saldoFiado = Number(c.saldoFiado) || 0;
  if (foiFiado) saldoFiado += Number(total) || 0;
  const cashbackSaldo =
    (Number(c.cashbackSaldo) || 0) +
    ((Number(total) || 0) * (Number(cashbackPct) || 0)) / 100;
  const pontosFidelidade =
    (Number(c.pontosFidelidade) || 0) +
    (Number(total) || 0) * (Number(pontosPorReal) || 0);
  const db = await obterDatabase();
  await update(ref(db, `${caminho()}/${clienteId}`), {
    saldoFiado,
    cashbackSaldo: Math.round(cashbackSaldo * 100) / 100,
    pontosFidelidade: Math.round(pontosFidelidade * 10) / 10,
    ultimaCompraEm: Date.now(),
  });
}

export async function quitarFiado(clienteId, valor) {
  const c = await obterCliente(clienteId);
  if (!c) throw new Error("Cliente não encontrado.");
  const v = Number(valor);
  if (!Number.isFinite(v) || v <= 0) throw new Error("Valor inválido.");
  const novo = Math.max(0, (Number(c.saldoFiado) || 0) - v);
  const db = await obterDatabase();
  await update(ref(db, `${caminho()}/${clienteId}`), {
    saldoFiado: novo,
    atualizadoEm: Date.now(),
  });
  return novo;
}

/**
 * Itens mais comprados por um cliente (a partir das vendas).
 */
export function historicoPreferenciasCliente(vendas, clienteId, limite = 8) {
  const contagem = new Map();
  for (const v of vendas || []) {
    if (v.cancelada || v.clienteId !== clienteId) continue;
    for (const i of v.itens || []) {
      if (!i.produtoId) continue;
      const prev = contagem.get(i.produtoId) || { nome: i.nome, qtd: 0 };
      prev.qtd += Number(i.quantidade) || 0;
      prev.nome = i.nome || prev.nome;
      contagem.set(i.produtoId, prev);
    }
  }
  return Array.from(contagem.entries())
    .map(([produtoId, d]) => ({ produtoId, ...d }))
    .sort((a, b) => b.qtd - a.qtd)
    .slice(0, limite);
}

export function clientesAniversariantesHoje(clientes) {
  const agora = new Date();
  const chave = `${String(agora.getMonth() + 1).padStart(2, "0")}-${String(
    agora.getDate()
  ).padStart(2, "0")}`;
  return (clientes || []).filter(
    (c) => c.ativo !== false && String(c.aniversario || "").slice(0, 5) === chave
  );
}
