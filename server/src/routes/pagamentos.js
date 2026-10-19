import { Router } from 'express';
import { autenticarLoja, exigirAdminLoja } from '../deps.js';
import { ErroNegocio } from '../errors.js';
import { criarLimitador } from '../httpSeguranca.js';
import * as pagamentoService from '../services/pagamentoService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ehObjetoSimples, ehVerdadeiro } from '../utils/valores.js';

const CHAVES_WEBHOOK_VIA_QUERY = ['type', 'topic', 'id', 'data.id'];

function primeiroValorQuery(valor) {
  const unico = Array.isArray(valor) ? valor[valor.length - 1] : valor;
  return typeof unico === 'string' ? unico : undefined;
}

/**
 * O MP envia dados no corpo (webhooks) ou na query (IPN legado). Junta os dois no
 * formato que o serviço espera, sem sobrescrever o que veio no corpo.
 */
function montarNotificacao(req) {
  if (!ehObjetoSimples(req.body)) throw new ErroNegocio('Dados invalidos.', 422);
  const notificacao = { ...req.body };
  for (const chave of CHAVES_WEBHOOK_VIA_QUERY) {
    const valor = primeiroValorQuery(req.query[chave]);
    if (!Object.hasOwn(notificacao, chave) && valor !== undefined) notificacao[chave] = valor;
  }
  if (!Object.hasOwn(notificacao, 'data') && ehVerdadeiro(notificacao.id)) {
    notificacao.data = { id: notificacao.id };
  }
  if (!Object.hasOwn(notificacao, 'type') && ehVerdadeiro(notificacao.topic)) {
    notificacao.type = notificacao.topic;
  }
  return notificacao;
}

export function criarRotasPagamentos() {
  const rotas = Router();
  const limitarWebhook = criarLimitador(60, 1);

  rotas.post(
    '/pagamentos/checkout',
    autenticarLoja,
    exigirAdminLoja,
    asyncHandler(async (req, res) => {
      res.json(await pagamentoService.criarCheckoutAssinatura(req.authLoja.lojaId));
    }),
  );

  rotas.get(
    '/pagamentos/assinatura',
    autenticarLoja,
    asyncHandler(async (req, res) => {
      res.json(await pagamentoService.obterAssinatura(req.authLoja.lojaId));
    }),
  );

  rotas.post(
    '/pagamentos/webhook',
    limitarWebhook,
    asyncHandler(async (req, res) => {
      await pagamentoService.processarWebhook(montarNotificacao(req), {
        assinatura: req.headers['x-signature'] || '',
        requestId: req.headers['x-request-id'] || '',
      });
      res.json({ ok: true });
    }),
  );

  return rotas;
}
