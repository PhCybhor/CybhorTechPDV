import { ErroNegocio } from '../errors.js';
import * as authService from '../services/authService.js';
import { converterParaNumero, ehObjetoSimples, ehVerdadeiro } from '../utils/valores.js';

const MENSAGEM_DADOS_INVALIDOS = 'Dados invalidos.';

/** Corpo precisa ser um objeto JSON; o contrato antigo respondia 422 nos demais casos. */
export function exigirCorpoObjeto(req, _res, next) {
  if (!ehObjetoSimples(req.body)) {
    next(new ErroNegocio(MENSAGEM_DADOS_INVALIDOS, 422));
    return;
  }
  next();
}

/**
 * Lê um parâmetro de query obrigatório (último valor se repetido).
 * @throws {ErroNegocio} 422 quando ausente.
 */
export function lerQueryObrigatoria(req, nome) {
  const bruto = req.query[nome];
  const valor = Array.isArray(bruto) ? bruto[bruto.length - 1] : bruto;
  if (typeof valor !== 'string') throw new ErroNegocio(MENSAGEM_DADOS_INVALIDOS, 422);
  return valor;
}

/** Corpo já validado por `exigirCorpoObjeto`; usado para ler campos com segurança. */
export function corpoDe(req) {
  return ehObjetoSimples(req.body) ? req.body : {};
}

export function exigirPerm(auth, chave, mensagem) {
  return authService.exigirPerm({
    cargo: auth.cargo,
    lojaId: auth.lojaId,
    funcionarioId: auth.funcionarioId,
    chave,
    mensagem,
  });
}

export function exigirEscritaDados(auth, caminho) {
  return authService.exigirEscritaDados({
    cargo: auth.cargo,
    lojaId: auth.lojaId,
    funcionarioId: auth.funcionarioId,
    caminho,
  });
}

export function exigirRemocaoDados(auth, caminho) {
  return authService.exigirRemocaoDados({
    cargo: auth.cargo,
    lojaId: auth.lojaId,
    funcionarioId: auth.funcionarioId,
    caminho,
  });
}

export function exigirLoteDados(auth, atualizacoes) {
  return authService.exigirLoteDados({
    cargo: auth.cargo,
    lojaId: auth.lojaId,
    funcionarioId: auth.funcionarioId,
    atualizacoes: atualizacoes || {},
  });
}

/** Desconto e fiado são permissões do operador: valida antes de registrar a venda. */
export async function exigirDescontoEFiado(auth, payload) {
  const desconto = converterParaNumero(ehVerdadeiro(payload.desconto) ? payload.desconto : 0) ?? 0;
  if (desconto > 0) {
    await exigirPerm(auth, 'aplicarDesconto', 'Sem permissao para aplicar desconto.');
  }
  if (ehVerdadeiro(payload.fiado)) {
    await exigirPerm(auth, 'venderFiado', 'Sem permissao para venda fiado.');
  }
}
