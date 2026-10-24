import { ErroNegocio } from '../errors.js';
import { obter } from './dadosService.js';
import * as caixaService from './caixaService.js';
import { ehObjetoSimples } from '../utils/valores.js';

const LIMITE_PADRAO = 100;
const LIMITE_MAXIMO = 500;

/**
 * O caixa grava em `documentos_loja` (recurso vendas) via /api/caixa/venda.
 * POST /api/vendas antigo apontava para tabelas relacionais órfãs — redireciona
 * para o mesmo fluxo atômico do caixa.
 */
export async function registrarVenda(lojaId, funcionario, dados) {
  return caixaService.finalizarVenda(lojaId, funcionario, dados);
}

/**
 * Lista as vendas mais recentes da loja (fonte: documentos do caixa).
 * @param {string} lojaId
 * @param {number} [limite] normalizado para 1..500.
 */
export async function listarVendas(lojaId, limite = LIMITE_PADRAO) {
  const limiteSolicitado = limite || LIMITE_PADRAO;
  const limiteSeguro = Math.min(Math.max(limiteSolicitado, 1), LIMITE_MAXIMO);

  let documento;
  try {
    documento = await obter(lojaId, 'vendas');
  } catch (erro) {
    if (erro instanceof ErroNegocio) throw erro;
    throw new ErroNegocio('Nao foi possivel carregar as vendas.', 500);
  }

  if (!ehObjetoSimples(documento)) return [];

  // Documento legado: uma única venda na raiz (sem mapa id → venda).
  if (Array.isArray(documento.itens) && documento.criadoEm != null) {
    return [
      {
        id: 'legado',
        ...documento,
        subtotal: Number(documento.subtotal) || 0,
        desconto: Number(documento.desconto) || 0,
        total: Number(documento.total) || 0,
        cancelada: Boolean(documento.cancelada),
        itens: Array.isArray(documento.itens) ? documento.itens : [],
      },
    ].slice(0, limiteSeguro);
  }

  return Object.entries(documento)
    .filter(
      ([, dados]) =>
        ehObjetoSimples(dados) &&
        (dados.criadoEm != null || Array.isArray(dados.itens)),
    )
    .map(([id, dados]) => ({
      id: String(id),
      funcionarioId: dados.funcionarioId ?? null,
      funcionarioNome: dados.funcionarioNome || '',
      subtotal: Number(dados.subtotal) || 0,
      desconto: Number(dados.desconto) || 0,
      total: Number(dados.total) || 0,
      formaPagamento: dados.formaPagamento || '',
      formasPagamento: Array.isArray(dados.formasPagamento) ? dados.formasPagamento : [],
      criadoEm: dados.criadoEm,
      cancelada: Boolean(dados.cancelada),
      clienteId: dados.clienteId ?? null,
      clienteNome: dados.clienteNome ?? null,
      fiado: Boolean(dados.fiado),
      itens: Array.isArray(dados.itens) ? dados.itens : [],
    }))
    .sort((a, b) => (Number(b.criadoEm) || 0) - (Number(a.criadoEm) || 0))
    .slice(0, limiteSeguro);
}
