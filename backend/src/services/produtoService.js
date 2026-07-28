"use strict";

const { consultar } = require("../config/db");
const { ErroNegocio } = require("../middlewares/erros");

/**
 * Normaliza e valida os campos de produto vindos do cliente.
 * @param {object} dados
 */
function validarProduto(dados) {
  const nome = (dados?.nome || "").trim();
  const preco = Number(dados?.preco);
  const estoque = Number.parseInt(dados?.estoque, 10);

  if (nome.length < 2) throw new ErroNegocio("Informe o nome do produto.");
  if (!Number.isFinite(preco) || preco < 0) throw new ErroNegocio("Preco invalido.");
  if (!Number.isInteger(estoque) || estoque < 0) throw new ErroNegocio("Estoque invalido.");

  return {
    nome,
    preco,
    estoque,
    codigoBarras: (dados.codigoBarras || "").trim(),
    categoria: (dados.categoria || "").trim(),
  };
}

/** @param {string} lojaId */
async function listar(lojaId) {
  const resultado = await consultar(
    `SELECT id, nome, codigo_barras AS "codigoBarras", preco, estoque, categoria,
            criado_em AS "criadoEm", atualizado_em AS "atualizadoEm"
     FROM produtos WHERE loja_id = $1 ORDER BY nome`,
    [lojaId]
  );
  return resultado.rows;
}

/**
 * @param {string} lojaId
 * @param {object} dados
 */
async function criar(lojaId, dados) {
  const p = validarProduto(dados);
  const criado = await consultar(
    `INSERT INTO produtos (loja_id, nome, codigo_barras, preco, estoque, categoria)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [lojaId, p.nome, p.codigoBarras, p.preco, p.estoque, p.categoria]
  );
  return { id: criado.rows[0].id };
}

/**
 * @param {string} lojaId
 * @param {string} produtoId
 * @param {object} dados
 */
async function atualizar(lojaId, produtoId, dados) {
  const p = validarProduto(dados);
  const resultado = await consultar(
    `UPDATE produtos
     SET nome = $1, codigo_barras = $2, preco = $3, estoque = $4, categoria = $5,
         atualizado_em = now()
     WHERE id = $6 AND loja_id = $7`,
    [p.nome, p.codigoBarras, p.preco, p.estoque, p.categoria, produtoId, lojaId]
  );
  if (resultado.rowCount === 0) throw new ErroNegocio("Produto nao encontrado.", 404);
}

/**
 * @param {string} lojaId
 * @param {string} produtoId
 */
async function remover(lojaId, produtoId) {
  const resultado = await consultar(
    "DELETE FROM produtos WHERE id = $1 AND loja_id = $2",
    [produtoId, lojaId]
  );
  if (resultado.rowCount === 0) throw new ErroNegocio("Produto nao encontrado.", 404);
}

module.exports = { listar, criar, atualizar, remover };
