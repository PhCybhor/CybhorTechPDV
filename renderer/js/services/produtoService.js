import { ref, get, push, update, remove, onValue } from "firebase/database";
import { obterDatabase } from "../config/firebaseClient.js";

const CAMINHO_PRODUTOS = "produtos";

/**
 * Normaliza o snapshot de produtos em uma lista de objetos com id.
 * @param {object | null} valor
 * @returns {Array<object>}
 */
function mapearProdutos(valor) {
  if (!valor) return [];
  return Object.entries(valor).map(([id, dados]) => ({ id, ...dados }));
}

/**
 * Valida e normaliza os campos de um produto.
 * @param {object} dados
 * @returns {object}
 */
function normalizarProduto({ nome, codigoBarras, preco, estoque, categoria }) {
  const nomeLimpo = (nome || "").trim();
  const precoNumero = Number(preco);
  const estoqueNumero = Number(estoque);

  if (nomeLimpo.length < 2) throw new Error("Informe o nome do produto.");
  if (!Number.isFinite(precoNumero) || precoNumero < 0)
    throw new Error("Preco invalido.");
  if (!Number.isFinite(estoqueNumero) || estoqueNumero < 0)
    throw new Error("Estoque invalido.");

  return {
    nome: nomeLimpo,
    codigoBarras: (codigoBarras || "").trim(),
    preco: precoNumero,
    estoque: estoqueNumero,
    categoria: (categoria || "").trim(),
  };
}

/**
 * Retorna todos os produtos cadastrados (leitura unica).
 * @returns {Promise<Array<object>>}
 */
export async function listarProdutos() {
  const db = await obterDatabase();
  const snapshot = await get(ref(db, CAMINHO_PRODUTOS));
  return mapearProdutos(snapshot.val());
}

/**
 * Observa a lista de produtos em tempo real.
 * @param {(produtos: Array<object>) => void} callback
 * @returns {Promise<import("firebase/database").Unsubscribe>}
 */
export async function observarProdutos(callback) {
  const db = await obterDatabase();
  return onValue(ref(db, CAMINHO_PRODUTOS), (snapshot) => {
    callback(mapearProdutos(snapshot.val()));
  });
}

/**
 * Cadastra um novo produto.
 * @param {object} produto
 * @returns {Promise<string>} id gerado
 */
export async function criarProduto(produto) {
  const dados = normalizarProduto(produto);
  const db = await obterDatabase();
  const referencia = await push(ref(db, CAMINHO_PRODUTOS), {
    ...dados,
    criadoEm: Date.now(),
  });
  return referencia.key;
}

/**
 * Atualiza um produto existente.
 * @param {string} produtoId
 * @param {object} produto
 * @returns {Promise<void>}
 */
export async function atualizarProduto(produtoId, produto) {
  if (!produtoId) throw new Error("Produto invalido.");
  const dados = normalizarProduto(produto);
  const db = await obterDatabase();
  await update(ref(db, `${CAMINHO_PRODUTOS}/${produtoId}`), {
    ...dados,
    atualizadoEm: Date.now(),
  });
}

/**
 * Remove um produto do catalogo.
 * @param {string} produtoId
 * @returns {Promise<void>}
 */
export async function excluirProduto(produtoId) {
  if (!produtoId) throw new Error("Produto invalido.");
  const db = await obterDatabase();
  await remove(ref(db, `${CAMINHO_PRODUTOS}/${produtoId}`));
}

/**
 * Ajusta o estoque de um produto por uma quantidade (positiva ou negativa).
 * @param {string} produtoId
 * @param {number} estoqueAtual
 * @param {number} variacao
 * @returns {Promise<void>}
 */
export async function ajustarEstoque(produtoId, estoqueAtual, variacao) {
  const novoEstoque = Math.max(0, Number(estoqueAtual) + Number(variacao));
  const db = await obterDatabase();
  await update(ref(db, `${CAMINHO_PRODUTOS}/${produtoId}`), {
    estoque: novoEstoque,
    atualizadoEm: Date.now(),
  });
}

/**
 * Busca produto por codigo de barras exato (para leitor).
 * @param {Array<object>} produtos
 * @param {string} codigo
 * @returns {object | null}
 */
export function encontrarPorCodigoBarras(produtos, codigo) {
  const alvo = (codigo || "").trim();
  if (!alvo) return null;
  return (
    produtos.find(
      (p) => (p.codigoBarras || "").trim() === alvo
    ) || null
  );
}
