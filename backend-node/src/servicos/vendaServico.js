import { randomUUID } from "node:crypto";
import * as db from "../db.js";
import { ErroNegocio } from "../erros.js";
import { converterDecimal, converterInteiro, ehObjetoSimples, lerTexto, lerTextoLimpo } from "../regras/entrada.js";

const FORMAS_PAGAMENTO = new Set(["dinheiro", "credito", "debito", "pix"]);
const LIMITE_PADRAO = 100;
const LIMITE_MAXIMO = 500;

function validarCabecalhoVenda(dados) {
  const itens = Array.isArray(dados.itens) ? dados.itens : [];
  if (!itens.length) throw new ErroNegocio("A venda precisa de ao menos um item.");

  const forma = lerTextoLimpo(dados.formaPagamento).toLowerCase();
  if (!FORMAS_PAGAMENTO.has(forma)) throw new ErroNegocio("Forma de pagamento invalida.");

  const desconto = converterDecimal(dados.desconto || 0);
  if (desconto === null || desconto < 0) throw new ErroNegocio("Desconto invalido.");
  return { itens, forma, desconto };
}

function lerQuantidade(item) {
  const quantidade = ehObjetoSimples(item) ? converterInteiro(item.quantidade) : null;
  if (quantidade === null || quantidade <= 0) throw new ErroNegocio("Quantidade invalida em um dos itens.");
  return quantidade;
}

/**
 * Registra venda online com baixa de estoque atômica (linhas travadas com FOR UPDATE).
 * @param {string} lojaId
 * @param {{ id: string, nome: string }} funcionario
 * @param {Record<string, any>} dados
 */
export async function registrarVenda(lojaId, funcionario, dados) {
  const { itens, forma, desconto } = validarCabecalhoVenda(dados);

  return db.transacao(async (tx) => {
    let subtotal = 0;
    const itensCalculados = [];

    for (const item of itens) {
      const quantidade = lerQuantidade(item);
      const [produto] = await tx.consultar(
        "SELECT id, nome, preco, estoque FROM produtos WHERE id = ? AND loja_id = ? FOR UPDATE",
        [lerTexto(item.produtoId), lojaId],
      );
      if (!produto) throw new ErroNegocio("Produto nao encontrado na loja.", 404);
      if (produto.estoque < quantidade) throw new ErroNegocio(`Estoque insuficiente para "${produto.nome}".`);

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
      await tx.executar("UPDATE produtos SET estoque = estoque - ?, atualizado_em = CURRENT_TIMESTAMP(3) WHERE id = ?", [
        quantidade,
        produto.id,
      ]);
    }

    if (desconto > subtotal) throw new ErroNegocio("Desconto maior que o subtotal.");
    const total = subtotal - desconto;
    const vendaId = randomUUID();
    const criadoEm = new Date();

    await tx.executar(
      `INSERT INTO vendas (id, loja_id, funcionario_id, funcionario_nome, subtotal, desconto, total, forma_pagamento, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [vendaId, lojaId, funcionario.id, funcionario.nome, subtotal, desconto, total, forma, criadoEm],
    );
    for (const item of itensCalculados) {
      await tx.executar(
        `INSERT INTO venda_itens (venda_id, produto_id, nome, quantidade, preco_unitario, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [vendaId, item.produtoId, item.nome, item.quantidade, item.precoUnitario, item.subtotal],
      );
    }

    return { id: vendaId, criadoEm, subtotal, desconto, total, formaPagamento: forma, itens: itensCalculados };
  });
}

/**
 * Últimas vendas da loja com os itens.
 * @param {string} lojaId
 * @param {number} [limite=100] limitado a 1..500.
 */
export async function listarVendas(lojaId, limite = LIMITE_PADRAO) {
  const limiteSeguro = Math.min(Math.max(Math.trunc(limite) || LIMITE_PADRAO, 1), LIMITE_MAXIMO);
  const vendas = await db.consultar(
    `SELECT id, funcionario_id AS funcionarioId, funcionario_nome AS funcionarioNome,
            subtotal, desconto, total, forma_pagamento AS formaPagamento, criado_em AS criadoEm
     FROM vendas WHERE loja_id = ? ORDER BY criado_em DESC LIMIT ?`,
    [lojaId, limiteSeguro],
  );
  if (!vendas.length) return [];

  const ids = vendas.map((venda) => venda.id);
  const itens = await db.consultar(
    `SELECT venda_id AS vendaId, produto_id AS produtoId, nome, quantidade,
            preco_unitario AS precoUnitario, subtotal
     FROM venda_itens WHERE venda_id IN (${db.marcadores(ids.length)})`,
    ids,
  );

  const itensPorVenda = new Map();
  for (const item of itens) {
    if (!itensPorVenda.has(item.vendaId)) itensPorVenda.set(item.vendaId, []);
    itensPorVenda.get(item.vendaId).push(item);
  }
  return vendas.map((venda) => ({ ...venda, itens: itensPorVenda.get(venda.id) || [] }));
}
