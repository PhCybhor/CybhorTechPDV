import { ref, get, push, update, onValue } from "firebase/database";
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
 * @param {{nome: string, codigoBarras?: string, preco: number, estoque: number, categoria?: string}} produto
 * @returns {Promise<string>} id gerado
 */
export async function criarProduto({ nome, codigoBarras, preco, estoque, categoria }) {
  const nomeLimpo = (nome || "").trim();
  const precoNumero = Number(preco);
  const estoqueNumero = Number(estoque);

  if (nomeLimpo.length < 2) throw new Error("Informe o nome do produto.");
  if (!Number.isFinite(precoNumero) || precoNumero < 0)
    throw new Error("Preco invalido.");
  if (!Number.isFinite(estoqueNumero) || estoqueNumero < 0)
    throw new Error("Estoque invalido.");

  const db = await obterDatabase();
  const referencia = await push(ref(db, CAMINHO_PRODUTOS), {
    nome: nomeLimpo,
    codigoBarras: (codigoBarras || "").trim(),
    preco: precoNumero,
    estoque: estoqueNumero,
    categoria: (categoria || "").trim(),
    criadoEm: Date.now(),
  });

  return referencia.key;
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
  });
}
