import { exigirEscritaDados, exigirLoteDados, exigirRemocaoDados } from "../servicos/authServico.js";
import { atualizarLote, definirDados, mesclarDados, obterDados, removerDados } from "../servicos/dadosServico.js";
import { caminhoDados, contextoPermissao, lerCorpo } from "./requisicao.js";

export async function lote(req, res) {
  const atualizacoes = lerCorpo(req).atualizacoes || {};
  await exigirLoteDados({ ...contextoPermissao(req), atualizacoes });
  await atualizarLote(req.auth.lojaId, atualizacoes);
  res.status(204).end();
}

export async function obter(req, res) {
  res.json({ valor: await obterDados(req.auth.lojaId, caminhoDados(req)) });
}

export async function definir(req, res) {
  const corpo = lerCorpo(req);
  const caminho = caminhoDados(req);
  await exigirEscritaDados({ ...contextoPermissao(req), caminho });
  await definirDados(req.auth.lojaId, caminho, corpo.valor ?? null);
  res.status(204).end();
}

export async function mesclar(req, res) {
  const corpo = lerCorpo(req);
  const caminho = caminhoDados(req);
  await exigirEscritaDados({ ...contextoPermissao(req), caminho });
  await mesclarDados(req.auth.lojaId, caminho, corpo.patch || {});
  res.status(204).end();
}

export async function remover(req, res) {
  const caminho = caminhoDados(req);
  await exigirRemocaoDados({ ...contextoPermissao(req), caminho });
  await removerDados(req.auth.lojaId, caminho);
  res.status(204).end();
}
