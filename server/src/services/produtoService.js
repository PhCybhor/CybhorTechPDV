import { randomUUID } from 'node:crypto';
import * as db from '../db.js';
import { ErroNegocio } from '../errors.js';
import { converterParaInteiro, converterParaNumero, texto } from '../utils/valores.js';

function validarProduto(dados) {
  const nome = texto(dados.nome);
  const preco = converterParaNumero(dados.preco);
  if (preco === null) throw new ErroNegocio('Preco invalido.');
  const estoque = converterParaInteiro(dados.estoque);
  if (estoque === null) throw new ErroNegocio('Estoque invalido.');

  if (Array.from(nome).length < 2) throw new ErroNegocio('Informe o nome do produto.');
  if (preco < 0) throw new ErroNegocio('Preco invalido.');
  if (estoque < 0) throw new ErroNegocio('Estoque invalido.');

  return {
    nome,
    preco,
    estoque,
    codigoBarras: texto(dados.codigoBarras),
    categoria: texto(dados.categoria),
  };
}

export async function listar(lojaId) {
  const linhas = await db.consultar(
    `SELECT id, nome, codigo_barras AS codigoBarras, preco, estoque, categoria,
            criado_em AS criadoEm, atualizado_em AS atualizadoEm
     FROM produtos WHERE loja_id = ? ORDER BY nome`,
    [lojaId],
  );
  return linhas.map((produto) => ({
    ...produto,
    id: String(produto.id),
    preco: Number(produto.preco),
  }));
}

export async function criar(lojaId, dados) {
  const produto = validarProduto(dados);
  const id = randomUUID();
  await db.executar(
    `INSERT INTO produtos (id, loja_id, nome, codigo_barras, preco, estoque, categoria)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, lojaId, produto.nome, produto.codigoBarras, produto.preco, produto.estoque, produto.categoria],
  );
  return { id };
}

export async function atualizar(lojaId, produtoId, dados) {
  const produto = validarProduto(dados);
  const afetadas = await db.executar(
    `UPDATE produtos
     SET nome = ?, codigo_barras = ?, preco = ?, estoque = ?, categoria = ?,
         atualizado_em = NOW(3)
     WHERE id = ? AND loja_id = ?`,
    [
      produto.nome,
      produto.codigoBarras,
      produto.preco,
      produto.estoque,
      produto.categoria,
      produtoId,
      lojaId,
    ],
  );
  if (afetadas === 0) throw new ErroNegocio('Produto nao encontrado.', 404);
}

export async function remover(lojaId, produtoId) {
  const afetadas = await db.executar('DELETE FROM produtos WHERE id = ? AND loja_id = ?', [
    produtoId,
    lojaId,
  ]);
  if (afetadas === 0) throw new ErroNegocio('Produto nao encontrado.', 404);
}
