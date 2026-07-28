"use strict";

const crypto = require("crypto");
const { consultar } = require("../config/db");
const { env } = require("../config/env");
const { ErroNegocio } = require("../middlewares/erros");
const {
  configuracaoBrickPagamento,
  montarCorpoPagamento,
  ROTULOS_METODOS,
} = require("../utils/mercadoPagoMetodos");

const MP_API = "https://api.mercadopago.com";

/**
 * Chamada autenticada a API REST do Mercado Pago.
 */
async function chamarMercadoPago(caminho, { method = "GET", body } = {}) {
  if (!env.mercadoPago.accessToken)
    throw new ErroNegocio("Pagamentos indisponiveis no momento.", 503);

  const resposta = await fetch(`${MP_API}${caminho}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.mercadoPago.accessToken}`,
      "Content-Type": "application/json",
      ...(body ? { "X-Idempotency-Key": crypto.randomUUID() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    console.error("Mercado Pago respondeu erro:", resposta.status, dados);
    const msgMp = dados?.message || dados?.cause?.[0]?.description;
    throw new ErroNegocio(msgMp || "Falha ao comunicar com o Mercado Pago.", 502);
  }
  return dados;
}

/**
 * Ativa loja e assinatura apos pagamento aprovado.
 * @param {string} lojaId
 */
async function ativarAssinaturaLoja(lojaId) {
  await consultar(
    `UPDATE assinaturas
     SET status = 'ativa', valida_ate = (CURRENT_DATE + interval '1 month')::date,
         atualizado_em = now()
     WHERE loja_id = $1`,
    [lojaId]
  );
  await consultar(
    "UPDATE lojas SET ativa = TRUE, atualizado_em = now() WHERE id = $1",
    [lojaId]
  );
}

/**
 * Registra pagamento no historico e ativa a loja se aprovado.
 * @param {string} lojaId
 * @param {object} pagamento
 */
async function registrarPagamento(lojaId, pagamento) {
  await consultar(
    `INSERT INTO pagamentos (loja_id, mp_payment_id, status, valor, payload)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (mp_payment_id)
     DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload`,
    [
      lojaId,
      String(pagamento.id),
      pagamento.status,
      pagamento.transaction_amount || null,
      JSON.stringify({
        status: pagamento.status,
        status_detail: pagamento.status_detail,
        date_approved: pagamento.date_approved,
      }),
    ]
  );

  if (pagamento.status === "approved") {
    await ativarAssinaturaLoja(lojaId);
  }
}

/**
 * Busca pagamentos aprovados no MP quando o webhook ainda nao chegou
 * (util em desenvolvimento local ou atraso de rede).
 * @param {string} lojaId
 */
async function sincronizarPagamentoLoja(lojaId) {
  if (!env.mercadoPago.accessToken) return;

  try {
    const busca = await chamarMercadoPago(
      `/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(lojaId)}&limit=5`
    );
    const pagamentos = busca.results || [];
    const aprovado = pagamentos.find((p) => p.status === "approved");
    if (aprovado) {
      await registrarPagamento(lojaId, aprovado);
    }
  } catch (erro) {
    console.error("Falha ao sincronizar pagamento MP:", erro.message);
  }
}

/**
 * Lista metodos habilitados na conta MP (API oficial).
 */
async function listarMetodosPagamentoMp() {
  const metodos = await chamarMercadoPago("/v1/payment_methods");
  return (metodos || [])
    .filter((m) => m.status === "active")
    .map((m) => ({
      id: m.id,
      nome: m.name,
      tipo: m.payment_type_id,
      thumbnail: m.secure_thumbnail || m.thumbnail,
    }));
}

/** Configuracao do Payment Brick + metodos disponiveis na conta. */
async function obterConfiguracaoPagamentoSite() {
  let metodosDisponiveis = [];
  try {
    metodosDisponiveis = await listarMetodosPagamentoMp();
  } catch (erro) {
    console.error("Nao foi possivel listar metodos MP:", erro.message);
  }

  return {
    customization: configuracaoBrickPagamento(),
    metodosDisponiveis,
    metodosHabilitados: Object.entries(ROTULOS_METODOS).map(([chave, rotulo]) => ({
      chave,
      rotulo,
    })),
  };
}

/**
 * Cria preferencia de pagamento da mensalidade.
 * @param {string} lojaId
 * @param {{email?: string, nomeAdmin?: string, origemSite?: boolean, tokenAtivacao?: string}} [opcoes]
 */
async function criarCheckoutAssinatura(lojaId, opcoes = {}) {
  const loja = await consultar("SELECT id, nome FROM lojas WHERE id = $1", [lojaId]);
  if (loja.rowCount === 0) throw new ErroNegocio("Loja nao encontrada.", 404);

  const nomeLoja = loja.rows[0].nome;
  const siteBase = env.mercadoPago.urlPublicaSite.replace(/\/$/, "");

  const preferenciaBody = {
    items: [
      {
        id: "cybhorpdv-mensal",
        title: `CybhorPDV — assinatura mensal (${nomeLoja})`,
        description: "Acesso ao sistema PDV CybhorPDV por 1 mes. Codigo individual da loja liberado apos pagamento.",
        quantity: 1,
        currency_id: "BRL",
        unit_price: env.mercadoPago.valorMensal,
      },
    ],
    external_reference: lojaId,
    notification_url: env.mercadoPago.urlPublicaApi
      ? `${env.mercadoPago.urlPublicaApi}/api/pagamentos/webhook`
      : undefined,
  };

  if (opcoes.email) {
    preferenciaBody.payer = { email: opcoes.email };
  }

  if (opcoes.origemSite && opcoes.tokenAtivacao) {
    const urlSucesso = `${siteBase}/sucesso.html?token=${opcoes.tokenAtivacao}`;
    preferenciaBody.back_urls = {
      success: urlSucesso,
      failure: `${siteBase}/cadastro.html`,
      pending: `${urlSucesso}&pendente=1`,
    };
    // auto_return exige URL HTTPS publica — so em producao.
    if (siteBase.startsWith("https://")) {
      preferenciaBody.auto_return = "approved";
    }
  }

  const preferencia = await chamarMercadoPago("/checkout/preferences", {
    method: "POST",
    body: preferenciaBody,
  });

  await consultar(
    `UPDATE assinaturas
     SET mp_preference_id = $1, valor_mensal = $2, atualizado_em = now()
     WHERE loja_id = $3`,
    [preferencia.id, env.mercadoPago.valorMensal, lojaId]
  );

  return { checkoutUrl: preferencia.init_point, preferenciaId: preferencia.id };
}

/**
 * Checkout Transparente — cria pagamento via API Pagamentos (/v1/payments).
 * Compativel com Payment Brick (cartao, Pix, boleto).
 *
 * @param {string} lojaId
 * @param {string} email
 * @param {object} formData
 * @param {{firstName?: string, lastName?: string}} [pagador]
 */
async function criarPagamentoTransparente(lojaId, email, formData, pagador = {}) {
  const loja = await consultar(
    "SELECT id, nome, responsavel_nome, responsavel_sobrenome FROM lojas WHERE id = $1",
    [lojaId]
  );
  if (loja.rowCount === 0) throw new ErroNegocio("Loja nao encontrada.", 404);

  const valor = env.mercadoPago.valorMensal;
  const registro = loja.rows[0];
  const nomeLoja = registro.nome;

  const firstName =
    formData.payer?.first_name ||
    pagador.firstName ||
    registro.responsavel_nome ||
    "";
  const lastName =
    formData.payer?.last_name ||
    pagador.lastName ||
    registro.responsavel_sobrenome ||
    "";

  const metodo = formData.payment_method_id;
  if (!metodo) throw new ErroNegocio("Forma de pagamento nao informada.");

  const corpo = montarCorpoPagamento({
    lojaId,
    valor,
    nomeLoja,
    email,
    firstName,
    lastName,
    formData,
  });

  corpo.notification_url = env.mercadoPago.urlPublicaApi
    ? `${env.mercadoPago.urlPublicaApi}/api/pagamentos/webhook`
    : undefined;

  const pagamento = await chamarMercadoPago("/v1/payments", { method: "POST", body: corpo });
  await registrarPagamento(lojaId, pagamento);

  await consultar(
    `UPDATE assinaturas SET valor_mensal = $1, atualizado_em = now() WHERE loja_id = $2`,
    [valor, lojaId]
  );

  return pagamento;
}

/**
 * Webhook do Mercado Pago.
 */
async function processarWebhook(notificacao) {
  if (notificacao?.type !== "payment" || !notificacao?.data?.id) {
    return { ignorado: true };
  }

  const pagamento = await chamarMercadoPago(`/v1/payments/${notificacao.data.id}`);
  const lojaId = pagamento.external_reference;
  if (!lojaId) return { ignorado: true };

  await registrarPagamento(lojaId, pagamento);
  return { processado: true, status: pagamento.status };
}

async function obterAssinatura(lojaId) {
  const resultado = await consultar(
    `SELECT status, plano, valor_mensal AS "valorMensal", valida_ate AS "validaAte"
     FROM assinaturas WHERE loja_id = $1`,
    [lojaId]
  );
  if (resultado.rowCount === 0) throw new ErroNegocio("Assinatura nao encontrada.", 404);
  return resultado.rows[0];
}

module.exports = {
  criarCheckoutAssinatura,
  criarPagamentoTransparente,
  obterConfiguracaoPagamentoSite,
  processarWebhook,
  obterAssinatura,
  sincronizarPagamentoLoja,
  registrarPagamento,
};
