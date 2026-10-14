import { randomUUID } from "node:crypto";
import * as db from "../db.js";
import { ErroNegocio } from "../erros.js";
import { converterDecimal, converterInteiro, lerTextoLimpo } from "../regras/entrada.js";

function validarProduto(dados) {
  const nome = lerTextoLimpo(dados.nome);
  const preco = converterDecimal(dados.preco);
  if (preco === null) throw new ErroNegocio("Preco invalido.");
  const estoque = converterInteiro(dados.estoque);
  if (estoque === null) throw new ErroNegocio("Estoque invalido.");

  if (nome.length < 2) throw new ErroNegocio("Informe o nome do produto.");
  if (preco < 0) throw new ErroNegocio("Preco invalido.");
  if (estoque < 0) throw new ErroNegocio("Estoque invalido.");

  return {
    nome,
    preco,
    estoque,
    codigoBarras: lerTextoLimpo(dados.codigoBarras),
    categoria: lerTextoLimpo(dados.categoria),
  };
}

/** @returns {Promise<object[]>} produtos da loja em ordem alfabética. */
export function listarProdutos(lojaId) {
  return db.consultar(
    `SELECT id, nome, codigo_barras AS codigoBarras, preco, estoque, categoria,
            criado_em AS criadoEm, atualizado_em AS atualizadoEm
     FROM produtos WHERE loja_id = ? ORDER BY nome`,
    [lojaId],
  );
}

/** @returns {Promise<{ id: string }>} */
export async function criarProduto(lojaId, dados) {
  const produto = validarProduto(dados);
  const id = randomUUID();
  await db.executar(
    `INSERT INTO produtos (id, loja_id, nome, codigo_barras, preco, estoque, categoria)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, lojaId, produto.nome, produto.codigoBarras, produto.preco, produto.estoque, produto.categoria],
  );
  return { id };
}

/** @throws {ErroNegocio} 404 se o produto não for da loja. */
export async function atualizarProduto(lojaId, produtoId, dados) {
  const produto = validarProduto(dados);
  const afetadas = await db.executar(
    `UPDATE produtos
     SET nome = ?, codigo_barras = ?, preco = ?, estoque = ?, categoria = ?, atualizado_em = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND loja_id = ?`,
    [produto.nome, produto.codigoBarras, produto.preco, produto.estoque, produto.categoria, produtoId, lojaId],
  );
  if (afetadas === 0) throw new ErroNegocio("Produto nao encontrado.", 404);
}

/** @throws {ErroNegocio} 404 se o produto não for da loja. */
export async function removerProduto(lojaId, produtoId) {
  const afetadas = await db.executar("DELETE FROM produtos WHERE id = ? AND loja_id = ?", [produtoId, lojaId]);
  if (afetadas === 0) throw new ErroNegocio("Produto nao encontrado.", 404);
}
