import { randomUUID } from 'node:crypto';
import * as db from '../db.js';
import { ErroNegocio } from '../errors.js';
import {
  converterParaInteiro,
  converterParaNumero,
  ehObjetoSimples,
  ehVerdadeiro,
  texto,
} from '../utils/valores.js';

const FORMAS_PAGAMENTO_VALIDAS = ['dinheiro', 'credito', 'debito', 'pix'];
const LIMITE_PADRAO = 100;
const LIMITE_MAXIMO = 500;

function lerQuantidadeInteira(item) {
  const quantidade = converterParaInteiro(item.quantidade);
  if (quantidade === null || quantidade <= 0) {
    throw new ErroNegocio('Quantidade invalida em um dos itens.');
  }
  return quantidade;
}

/**
 * Registra a venda relacional (tabelas vendas/venda_itens) baixando estoque com
 * SELECT … FOR UPDATE. O preço sempre vem do cadastro, nunca do cliente.
 */
export async function registrarVenda(lojaId, funcionario, dados) {
  const itens = Array.isArray(dados.itens) ? dados.itens : [];
  if (itens.length === 0) throw new ErroNegocio('A venda precisa de ao menos um item.');

  const forma = texto(dados.formaPagamento).toLowerCase();
  if (!FORMAS_PAGAMENTO_VALIDAS.includes(forma)) {
    throw new ErroNegocio('Forma de pagamento invalida.');
  }

  const desconto = ehVerdadeiro(dados.desconto) ? converterParaNumero(dados.desconto) : 0;
  if (desconto === null || desconto < 0) throw new ErroNegocio('Desconto invalido.');

  return db.transacao(async (cx) => {
    let subtotal = 0;
    const itensCalculados = [];

    for (const item of itens) {
      if (!ehObjetoSimples(item)) throw new ErroNegocio('Item de venda invalido.');
      const quantidade = lerQuantidadeInteira(item);

      const produtos = await cx.consultar(
        'SELECT id, nome, preco, estoque FROM produtos WHERE id = ? AND loja_id = ? FOR UPDATE',
        [texto(item.produtoId), lojaId],
      );
      if (produtos.length === 0) throw new ErroNegocio('Produto nao encontrado na loja.', 404);
      const produto = produtos[0];

      if (produto.estoque < quantidade) {
        throw new ErroNegocio(`Estoque insuficiente para "${produto.nome}".`);
      }

      const precoUnitario = Number(produto.preco);
      const subtotalItem = precoUnitario * quantidade;
      subtotal += subtotalItem;
      itensCalculados.push({
        produtoId: String(produto.id),
        nome: produto.nome,
        quantidade,
        precoUnitario,
        subtotal: subtotalItem,
      });
      await cx.executar(
        'UPDATE produtos SET estoque = estoque - ?, atualizado_em = NOW(3) WHERE id = ?',
        [quantidade, produto.id],
      );
    }

    if (desconto > subtotal) throw new ErroNegocio('Desconto maior que o subtotal.');
    const total = subtotal - desconto;

    const vendaId = randomUUID();
    const criadoEm = new Date();
    await cx.executar(
      `INSERT INTO vendas (id, loja_id, funcionario_id, funcionario_nome,
                           subtotal, desconto, total, forma_pagamento, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [vendaId, lojaId, funcionario.id, funcionario.nome, subtotal, desconto, total, forma, criadoEm],
    );

    for (const item of itensCalculados) {
      await cx.executar(
        `INSERT INTO venda_itens (venda_id, produto_id, nome, quantidade, preco_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [vendaId, item.produtoId, item.nome, item.quantidade, item.precoUnitario, item.subtotal],
      );
    }

    return {
      id: vendaId,
      criadoEm,
      subtotal,
      desconto,
      total,
      formaPagamento: forma,
      itens: itensCalculados,
    };
  });
}

/**
 * Lista as vendas mais recentes da loja com seus itens.
 * @param {string} lojaId
 * @param {number} [limite] normalizado para 1..500.
 */
export async function listarVendas(lojaId, limite = LIMITE_PADRAO) {
  const limiteSolicitado = limite || LIMITE_PADRAO;
  const limiteSeguro = Math.min(Math.max(limiteSolicitado, 1), LIMITE_MAXIMO);

  const vendas = await db.consultar(
    `SELECT id, funcionario_id AS funcionarioId, funcionario_nome AS funcionarioNome,
            subtotal, desconto, total, forma_pagamento AS formaPagamento,
            criado_em AS criadoEm
     FROM vendas WHERE loja_id = ? ORDER BY criado_em DESC LIMIT ?`,
    [lojaId, limiteSeguro],
  );
  if (vendas.length === 0) return [];

  const itens = await db.consultar(
    `SELECT venda_id AS vendaId, produto_id AS produtoId, nome, quantidade,
            preco_unitario AS precoUnitario, subtotal
     FROM venda_itens WHERE venda_id IN (?)`,
    [vendas.map((venda) => String(venda.id))],
  );

  const itensPorVenda = new Map();
  for (const item of itens) {
    const vendaId = String(item.vendaId);
    const lista = itensPorVenda.get(vendaId) ?? [];
    lista.push({
      ...item,
      vendaId,
      produtoId: item.produtoId === null ? null : String(item.produtoId),
    });
    itensPorVenda.set(vendaId, lista);
  }

  return vendas.map((venda) => ({
    ...venda,
    id: String(venda.id),
    funcionarioId: venda.funcionarioId === null ? null : String(venda.funcionarioId),
    subtotal: Number(venda.subtotal),
    desconto: Number(venda.desconto),
    total: Number(venda.total),
    itens: itensPorVenda.get(String(venda.id)) ?? [],
  }));
}
