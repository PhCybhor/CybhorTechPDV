"use strict";

const { consultar, transacao } = require("../config/db");
const { ErroNegocio } = require("../middlewares/erros");

/**
 * Registra uma venda com baixa de estoque atomica.
 * O total e recalculado no servidor a partir do preco atual do banco —
 * o cliente nao dita valores, apenas itens e quantidades.
 *
 * @param {string} lojaId
 * @param {{id: string, nome: string}} funcionario
 * @param {{itens: Array<{produtoId: string, quantidade: number}>, desconto?: number, formaPagamento: string}} dados
 */
async function registrarVenda(lojaId, funcionario, dados) {
  const itens = Array.isArray(dados?.itens) ? dados.itens : [];
  if (itens.length === 0) throw new ErroNegocio("A venda precisa de ao menos um item.");

  const formaPagamento = (dados.formaPagamento || "").trim().toLowerCase();
  if (!["dinheiro", "credito", "debito", "pix"].includes(formaPagamento))
    throw new ErroNegocio("Forma de pagamento invalida.");

  const desconto = Number(dados.desconto) || 0;
  if (desconto < 0) throw new ErroNegocio("Desconto invalido.");

  return transacao(async (cliente) => {
    let subtotal = 0;
    const itensCalculados = [];

    for (const item of itens) {
      const quantidade = Number.parseInt(item?.quantidade, 10);
      if (!Number.isInteger(quantidade) || quantidade <= 0)
        throw new ErroNegocio("Quantidade invalida em um dos itens.");

      // FOR UPDATE trava a linha do produto ate o COMMIT, evitando que dois
      // caixas vendam o mesmo estoque ao mesmo tempo.
      const resultado = await cliente.query(
        `SELECT id, nome, preco, estoque FROM produtos
         WHERE id = $1 AND loja_id = $2 FOR UPDATE`,
        [item.produtoId, lojaId]
      );
      if (resultado.rowCount === 0)
        throw new ErroNegocio("Produto nao encontrado na loja.", 404);

      const produto = resultado.rows[0];
      if (produto.estoque < quantidade)
        throw new ErroNegocio(`Estoque insuficiente para "${produto.nome}".`);

      const precoUnitario = Number(produto.preco);
      const subtotalItem = precoUnitario * quantidade;
      subtotal += subtotalItem;
      itensCalculados.push({
        produtoId: produto.id,
        nome: produto.nome,
        quantidade,
        precoUnitario,
        subtotal: subtotalItem,
      });

      await cliente.query(
        "UPDATE produtos SET estoque = estoque - $1, atualizado_em = now() WHERE id = $2",
        [quantidade, produto.id]
      );
    }

    if (desconto > subtotal) throw new ErroNegocio("Desconto maior que o subtotal.");
    const total = subtotal - desconto;

    const venda = await cliente.query(
      `INSERT INTO vendas (loja_id, funcionario_id, funcionario_nome, subtotal, desconto, total, forma_pagamento)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, criado_em AS "criadoEm"`,
      [lojaId, funcionario.id, funcionario.nome, subtotal, desconto, total, formaPagamento]
    );
    const vendaId = venda.rows[0].id;

    for (const item of itensCalculados) {
      await cliente.query(
        `INSERT INTO venda_itens (venda_id, produto_id, nome, quantidade, preco_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [vendaId, item.produtoId, item.nome, item.quantidade, item.precoUnitario, item.subtotal]
      );
    }

    return {
      id: vendaId,
      criadoEm: venda.rows[0].criadoEm,
      subtotal,
      desconto,
      total,
      formaPagamento,
      itens: itensCalculados,
    };
  });
}

/**
 * Lista vendas da loja (mais recentes primeiro), com itens.
 * @param {string} lojaId
 * @param {{limite?: number}} [opcoes]
 */
async function listarVendas(lojaId, { limite = 100 } = {}) {
  const limiteSeguro = Math.min(Math.max(Number(limite) || 100, 1), 500);
  const vendas = await consultar(
    `SELECT id, funcionario_id AS "funcionarioId", funcionario_nome AS "funcionarioNome",
            subtotal, desconto, total, forma_pagamento AS "formaPagamento",
            criado_em AS "criadoEm"
     FROM vendas WHERE loja_id = $1 ORDER BY criado_em DESC LIMIT $2`,
    [lojaId, limiteSeguro]
  );
  if (vendas.rowCount === 0) return [];

  const ids = vendas.rows.map((v) => v.id);
  const itens = await consultar(
    `SELECT venda_id AS "vendaId", produto_id AS "produtoId", nome, quantidade,
            preco_unitario AS "precoUnitario", subtotal
     FROM venda_itens WHERE venda_id = ANY($1::uuid[])`,
    [ids]
  );

  const porVenda = new Map();
  for (const item of itens.rows) {
    if (!porVenda.has(item.vendaId)) porVenda.set(item.vendaId, []);
    porVenda.get(item.vendaId).push(item);
  }

  return vendas.rows.map((v) => ({ ...v, itens: porVenda.get(v.id) || [] }));
}

module.exports = { registrarVenda, listarVendas };
