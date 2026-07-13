import { ref, push, update, get, onValue } from "firebase/database";
import { obterDatabase } from "../config/firebaseClient.js";

const CAMINHO_VENDAS = "vendas";
const CAMINHO_PRODUTOS = "produtos";

/**
 * Normaliza o snapshot de vendas em uma lista de objetos com id.
 * @param {object | null} valor
 * @returns {Array<object>}
 */
function mapearVendas(valor) {
  if (!valor) return [];
  return Object.entries(valor).map(([id, dados]) => ({ id, ...dados }));
}

/**
 * Retorna todas as vendas registradas (leitura unica).
 * @returns {Promise<Array<object>>}
 */
export async function listarVendas() {
  const db = await obterDatabase();
  const snapshot = await get(ref(db, CAMINHO_VENDAS));
  return mapearVendas(snapshot.val());
}

/**
 * Observa a lista de vendas em tempo real.
 * @param {(vendas: Array<object>) => void} callback
 * @returns {Promise<import("firebase/database").Unsubscribe>}
 */
export async function observarVendas(callback) {
  const db = await obterDatabase();
  return onValue(ref(db, CAMINHO_VENDAS), (snapshot) => {
    callback(mapearVendas(snapshot.val()));
  });
}

/**
 * Registra uma venda e da baixa no estoque dos produtos de forma atomica
 * (uma unica operacao de update no Realtime Database).
 *
 * @param {{
 *   itens: Array<{produtoId: string, nome: string, quantidade: number, precoUnitario: number, estoqueAtual: number}>,
 *   desconto?: number,
 *   formaPagamento: string,
 *   funcionario: {id: string, nome: string}
 * }} venda
 * @returns {Promise<{
 *   id: string,
 *   total: number,
 *   subtotal: number,
 *   desconto: number,
 *   formaPagamento: string,
 *   funcionarioNome: string,
 *   itens: Array<object>,
 *   criadoEm: number
 * }>}
 */
export async function registrarVenda({
  itens,
  desconto = 0,
  formaPagamento,
  funcionario,
}) {
  if (!Array.isArray(itens) || itens.length === 0)
    throw new Error("Adicione ao menos um item para finalizar a venda.");

  const db = await obterDatabase();

  const subtotal = itens.reduce(
    (soma, item) => soma + item.precoUnitario * item.quantidade,
    0
  );
  const descontoAplicado = Math.min(Math.max(0, Number(desconto) || 0), subtotal);
  const total = subtotal - descontoAplicado;

  const referenciaVenda = push(ref(db, CAMINHO_VENDAS));
  const atualizacoes = {};

  const criadoEm = Date.now();
  const itensVenda = itens.map((item) => ({
    produtoId: item.produtoId,
    nome: item.nome,
    quantidade: item.quantidade,
    precoUnitario: item.precoUnitario,
    subtotal: item.precoUnitario * item.quantidade,
  }));

  atualizacoes[`${CAMINHO_VENDAS}/${referenciaVenda.key}`] = {
    itens: itensVenda,
    subtotal,
    desconto: descontoAplicado,
    total,
    formaPagamento,
    funcionarioId: funcionario.id,
    funcionarioNome: funcionario.nome,
    criadoEm,
  };

  for (const item of itens) {
    const novoEstoque = Math.max(0, item.estoqueAtual - item.quantidade);
    atualizacoes[`${CAMINHO_PRODUTOS}/${item.produtoId}/estoque`] = novoEstoque;
  }

  await update(ref(db), atualizacoes);

  return {
    id: referenciaVenda.key,
    total,
    subtotal,
    desconto: descontoAplicado,
    formaPagamento,
    funcionarioNome: funcionario.nome,
    itens: itensVenda,
    criadoEm,
  };
}
