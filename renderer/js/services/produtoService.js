import { ref, get, push, update, remove, onValue } from "firebase/database";
import { obterDatabase } from "../config/firebaseClient.js";
import { caminhoLoja } from "./tenantContext.js";

function caminhoProdutos() {
  return caminhoLoja("produtos");
}

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
/**
 * Custo de compra é opcional: só quem quer ver lucro preenche.
 * @param {unknown} valor
 * @returns {number | null}
 */
function normalizarCustoOpcional(valor) {
  if (valor === "" || valor === null || valor === undefined) return null;
  const custoNumero = Number(valor);
  if (!Number.isFinite(custoNumero) || custoNumero < 0) {
    throw new Error("Custo (quanto pagou) inválido.");
  }
  return custoNumero;
}

/**
 * Margem percentual sobre o preço de venda (0–100). Null se sem custo.
 * @param {number} preco
 * @param {number | null | undefined} custo
 * @returns {number | null}
 */
export function calcularMargemPercentual(preco, custo) {
  const p = Number(preco);
  const c = custo === null || custo === undefined ? null : Number(custo);
  if (!Number.isFinite(p) || p <= 0 || c === null || !Number.isFinite(c)) {
    return null;
  }
  return Number((((p - c) / p) * 100).toFixed(1));
}

/**
 * Sugere preço de venda a partir do custo e markup (% sobre o custo).
 * @param {number} custo
 * @param {number} [markupPercentual=40]
 * @returns {number}
 */
export function sugerirPrecoPorCusto(custo, markupPercentual = 40) {
  const c = Number(custo);
  const m = Number(markupPercentual);
  if (!Number.isFinite(c) || c < 0) return 0;
  const fator = 1 + (Number.isFinite(m) ? Math.max(0, m) : 40) / 100;
  return Number((c * fator).toFixed(2));
}

function normalizarProduto({
  nome,
  codigoBarras,
  codigoInterno,
  preco,
  estoque,
  categoria,
  custo,
  unidade,
  unidadesPorCaixa,
  validade,
  precoPromocao,
  promoInicio,
  promoFim,
}) {
  const nomeLimpo = (nome || "").trim();
  const precoNumero = Number(preco);
  const estoqueNumero = Number(estoque);
  const custoNumero = normalizarCustoOpcional(custo);
  const un = String(unidade || "un").toLowerCase() === "kg" ? "kg" : "un";
  const upc = Number(unidadesPorCaixa);
  const promo = normalizarCustoOpcional(precoPromocao);

  if (nomeLimpo.length < 2) throw new Error("Informe o nome do produto.");
  if (!Number.isFinite(precoNumero) || precoNumero < 0)
    throw new Error("Preço inválido.");
  if (!Number.isFinite(estoqueNumero) || estoqueNumero < 0)
    throw new Error("Estoque inválido.");

  return {
    nome: nomeLimpo,
    codigoBarras: (codigoBarras || "").trim(),
    codigoInterno: String(codigoInterno || "").trim(),
    preco: precoNumero,
    estoque: estoqueNumero,
    categoria: (categoria || "").trim(),
    // null limpa o campo no Firebase ao atualizar; omitir esconderia o lucro antigo
    custo: custoNumero,
    unidade: un,
    unidadesPorCaixa:
      Number.isFinite(upc) && upc > 1 ? Math.floor(upc) : null,
    validade: String(validade || "").trim() || null,
    precoPromocao: promo,
    promoInicio: String(promoInicio || "").trim() || null,
    promoFim: String(promoFim || "").trim() || null,
  };
}

/**
 * Produtos com validade nos próximos N dias (ou vencidos).
 */
export function listarVencendo(produtos, dias = 7) {
  const limite = Date.now() + dias * 86400000;
  return (produtos || [])
    .filter((p) => {
      if (!p.validade) return false;
      const t = Date.parse(p.validade);
      return Number.isFinite(t) && t <= limite;
    })
    .sort((a, b) => Date.parse(a.validade) - Date.parse(b.validade));
}

/**
 * Retorna todos os produtos cadastrados (leitura unica).
 * @returns {Promise<Array<object>>}
 */
export async function listarProdutos() {
  const db = await obterDatabase();
  const snapshot = await get(ref(db, caminhoProdutos()));
  return mapearProdutos(snapshot.val());
}

/**
 * Observa a lista de produtos em tempo real.
 * @param {(produtos: Array<object>) => void} callback
 * @returns {Promise<import("firebase/database").Unsubscribe>}
 */
export async function observarProdutos(callback) {
  const db = await obterDatabase();
  return onValue(ref(db, caminhoProdutos()), (snapshot) => {
    callback(mapearProdutos(snapshot.val()));
  });
}

/**
 * Garante que o código de barras não esteja em outro produto.
 * @param {string} codigoBarras
 * @param {string | null} ignorarId
 */
async function garantirCodigoBarrasUnico(codigoBarras, ignorarId = null) {
  const codigo = (codigoBarras || "").trim();
  if (!codigo) return;

  const existentes = await listarProdutos();
  const conflito = existentes.find(
    (p) =>
      p.id !== ignorarId && (p.codigoBarras || "").trim() === codigo
  );
  if (conflito) {
    throw new Error(
      `Código de barras já usado em "${conflito.nome}".`
    );
  }
}

/**
 * Cadastra um novo produto.
 * @param {object} produto
 * @returns {Promise<string>} id gerado
 */
export async function criarProduto(produto) {
  const dados = normalizarProduto(produto);
  await garantirCodigoBarrasUnico(dados.codigoBarras);
  const db = await obterDatabase();
  const referencia = await push(ref(db, caminhoProdutos()), {
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
  if (!produtoId) throw new Error("Produto inválido.");
  const dados = normalizarProduto(produto);
  await garantirCodigoBarrasUnico(dados.codigoBarras, produtoId);
  const db = await obterDatabase();
  await update(ref(db, `${caminhoProdutos()}/${produtoId}`), {
    ...dados,
    atualizadoEm: Date.now(),
  });
}

/**
 * Produtos com estoque abaixo do mínimo (e ainda disponíveis ou zerados).
 * @param {Array<object>} produtos
 * @param {number} minimo
 * @returns {Array<object>}
 */
export function listarEstoqueBaixo(produtos, minimo = 5) {
  const limiar = Number.isFinite(Number(minimo)) ? Number(minimo) : 5;
  return (produtos || [])
    .filter((p) => (Number(p.estoque) || 0) <= limiar)
    .sort((a, b) => (Number(a.estoque) || 0) - (Number(b.estoque) || 0));
}

/**
 * Importa produtos a partir de texto CSV.
 * Cabeçalho: nome,preco,estoque,codigoBarras,categoria,custo (custo opcional)
 * @param {string} textoCsv
 * @returns {Promise<{criados: number, erros: Array<string>}>}
 */
export async function importarProdutosCsv(textoCsv) {
  const linhas = String(textoCsv || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (linhas.length === 0) {
    throw new Error("Arquivo CSV vazio.");
  }

  const cabecalhoBruto = linhas[0].toLowerCase();
  const temCabecalho =
    cabecalhoBruto.includes("nome") && cabecalhoBruto.includes("preco");
  const dados = temCabecalho ? linhas.slice(1) : linhas;

  /** @type {Record<string, number> | null} */
  let mapaCols = null;
  if (temCabecalho) {
    const colsCab = linhas[0]
      .split(/;|,/)
      .map((c) => c.trim().toLowerCase().replace(/^"|"$/g, ""));
    mapaCols = {};
    colsCab.forEach((nomeCol, idx) => {
      mapaCols[nomeCol] = idx;
    });
  }

  let criados = 0;
  const erros = [];

  for (let i = 0; i < dados.length; i++) {
    const cols = dados[i].split(/;|,/).map((c) => c.trim().replace(/^"|"$/g, ""));
    const ler = (chave, fallbackIdx) => {
      if (mapaCols && chave in mapaCols) return cols[mapaCols[chave]] ?? "";
      return cols[fallbackIdx] ?? "";
    };

    const nome = ler("nome", 0);
    const preco = ler("preco", 1);
    const estoque = ler("estoque", 2);
    const codigoBarras = ler("codigobarras", 3) || ler("codigo", 3);
    const categoria = ler("categoria", 4);
    const custo = ler("custo", 5);

    try {
      await criarProduto({
        nome,
        preco,
        estoque: estoque || "0",
        codigoBarras: codigoBarras || "",
        categoria: categoria || "",
        custo: custo === "" ? null : custo,
      });
      criados += 1;
    } catch (erro) {
      erros.push(`Linha ${i + (temCabecalho ? 2 : 1)}: ${erro.message}`);
    }
  }

  return { criados, erros };
}


/**
 * Remove um produto do catalogo.
 * @param {string} produtoId
 * @returns {Promise<void>}
 */
export async function excluirProduto(produtoId) {
  if (!produtoId) throw new Error("Produto inválido.");
  const db = await obterDatabase();
  await remove(ref(db, `${caminhoProdutos()}/${produtoId}`));
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
  await update(ref(db, `${caminhoProdutos()}/${produtoId}`), {
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
      (p) =>
        (p.codigoBarras || "").trim() === alvo ||
        (p.codigoInterno || "").trim() === alvo
    ) || null
  );
}
