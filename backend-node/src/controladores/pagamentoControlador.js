import { criarCheckoutAssinatura, obterAssinatura, processarWebhook } from "../servicos/pagamentoServico.js";
import { lerCorpoOpcional } from "./requisicao.js";

const CHAVES_WEBHOOK_NA_QUERY = ["type", "topic", "id", "data.id"];

// O MP manda a notificação no corpo (webhook) ou só na query string (IPN antigo).
function montarNotificacao(req) {
  const notificacao = { ...lerCorpoOpcional(req) };
  for (const chave of CHAVES_WEBHOOK_NA_QUERY) {
    const valorQuery = req.query[chave];
    if (!Object.hasOwn(notificacao, chave) && typeof valorQuery === "string") notificacao[chave] = valorQuery;
  }
  if (!Object.hasOwn(notificacao, "data") && notificacao.id) notificacao.data = { id: notificacao.id };
  if (!Object.hasOwn(notificacao, "type") && notificacao.topic) notificacao.type = notificacao.topic;
  return notificacao;
}

export async function checkout(req, res) {
  res.json(await criarCheckoutAssinatura(req.auth.lojaId));
}

export async function assinatura(req, res) {
  res.json(await obterAssinatura(req.auth.lojaId));
}

export async function webhook(req, res) {
  await processarWebhook(montarNotificacao(req), {
    assinatura: req.get("x-signature") || "",
    requestId: req.get("x-request-id") || "",
  });
  res.json({ ok: true });
}
