import { atualizarProduto, criarProduto, listarProdutos, removerProduto } from "../servicos/produtoServico.js";
import { lerCorpo } from "./requisicao.js";

export async function listar(req, res) {
  res.json(await listarProdutos(req.auth.lojaId));
}

export async function criar(req, res) {
  const corpo = lerCorpo(req);
  res.status(201).json(await criarProduto(req.auth.lojaId, corpo));
}

export async function atualizar(req, res) {
  const corpo = lerCorpo(req);
  await atualizarProduto(req.auth.lojaId, req.params.produtoId, corpo);
  res.status(204).end();
}

export async function remover(req, res) {
  await removerProduto(req.auth.lojaId, req.params.produtoId);
  res.status(204).end();
}
