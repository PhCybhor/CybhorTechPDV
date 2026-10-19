import { createHmac, randomUUID } from 'node:crypto';
import {
  deveEstenderAssinatura,
  deveMarcarInadimplente,
} from '../assinatura.js';
import { config } from '../config.js';
import * as db from '../db.js';
import { ErroNegocio } from '../errors.js';
import { logger } from '../logger.js';
import {
  ROTULOS_METODOS,
  configuracaoBrickPagamento,
  montarCorpoPagamento,
} from '../mercadoPago.js';
import { obterPlano } from '../planos.js';
import { compararEmTempoConstante } from '../security.js';
import { objetoOuVazio, texto } from '../utils/valores.js';

const MP_API = 'https://api.mercadopago.com';
const TIMEOUT_MP_MS = 30_000;
const PADRAO_PAYMENT_ID = /^\d{6,24}$/;
const LIMITE_PAGAMENTOS_SINCRONIZACAO = 5;
const SEGUNDOS_ESPERA_LOCK_PAGAMENTO = 30;

/**
 * Chamada autenticada à API do Mercado Pago.
 * @param {string} caminho
 * @param {{ method?: string, body?: Record<string, any> | null }} [opcoes]
 * @returns {Promise<any>} JSON da resposta (ou {} se o corpo não for JSON).
 * @throws {ErroNegocio} 503 sem token configurado; 502 em falha de rede ou HTTP de erro.
 */
async function chamarMercadoPago(caminho, { method = 'GET', body = null } = {}) {
  if (!config.mpAccessToken) throw new ErroNegocio('Pagamentos indisponiveis no momento.', 503);

  const cabecalhos = {
    Authorization: `Bearer ${config.mpAccessToken}`,
    'Content-Type': 'application/json',
  };
  // A chave de idempotência evita cobrança duplicada se a requisição for reenviada.
  if (body !== null) cabecalhos['X-Idempotency-Key'] = randomUUID();

  let resposta;
  try {
    resposta = await fetch(`${MP_API}${caminho}`, {
      method,
      headers: cabecalhos,
      body: body === null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MP_MS),
    });
  } catch {
    logger.error(`mp_api_erro_rede method=${method}`);
    throw new ErroNegocio('Falha ao comunicar com o Mercado Pago.', 502);
  }

  let dados = {};
  try {
    dados = await resposta.json();
  } catch {
    dados = {};
  }

  if (!resposta.ok) {
    const codigo = objetoOuVazio(dados).error || objetoOuVazio(dados).code || '-';
    // Sem corpo MP no log (PII / detalhes internos).
    logger.error(`mp_api_erro http=${resposta.status} codigo=${String(codigo).slice(0, 64)} method=${method}`);
    throw new ErroNegocio('Falha ao comunicar com o Mercado Pago.', 502);
  }
  return dados;
}

function paymentIdParaLog(valor) {
  const normalizado = texto(valor);
  return PADRAO_PAYMENT_ID.test(normalizado) ? normalizado : '-';
}

/** Log estruturado de falha no webhook — sem PII, assinatura ou corpo MP. */
function logarFalhaWebhook(motivo, { paymentId = '', statusHttp = 0 } = {}) {
  logger.warn(
    `webhook_mp_falha motivo=${motivo} payment_id=${paymentIdParaLog(paymentId)} status_http=${statusHttp || '-'}`,
  );
}

function paymentIdSeguro(valor) {
  const normalizado = texto(valor);
  if (!PADRAO_PAYMENT_ID.test(normalizado)) {
    throw new ErroNegocio('Notificacao de pagamento invalida.', 400);
  }
  return normalizado;
}

/** Valida o cabeçalho x-signature do Mercado Pago (HMAC-SHA256 do manifesto). */
function verificarAssinaturaWebhook({ paymentId, assinatura, requestId }) {
  const segredo = config.mpWebhookSecret.trim();
  if (!segredo) {
    // Dev/local: aceita sem assinatura para facilitar testes do IPN.
    if (!config.emProducao) return;
    if (!config.mpWebhookSemAssinatura) {
      throw new ErroNegocio('Webhook MP sem segredo configurado.', 503);
    }
    logger.warn(`webhook_mp_sem_verificacao_assinatura payment_id=${paymentIdParaLog(paymentId)}`);
    return;
  }

  const partes = {};
  for (const pedaco of String(assinatura || '').split(',')) {
    const indice = pedaco.indexOf('=');
    if (indice === -1) continue;
    partes[pedaco.slice(0, indice).trim()] = pedaco.slice(indice + 1).trim();
  }
  const ts = partes.ts || '';
  const hashRecebido = partes.v1 || '';
  if (!ts || !hashRecebido || !requestId) throw new ErroNegocio('Assinatura do webhook ausente.', 401);

  const manifesto = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  const esperado = createHmac('sha256', segredo).update(manifesto, 'utf8').digest('hex');
  if (!compararEmTempoConstante(esperado, hashRecebido)) {
    throw new ErroNegocio('Assinatura do webhook invalida.', 401);
  }
}

async function ativarAssinaturaNaTransacao(cx, lojaId) {
  const linhas = await cx.consultar('SELECT plano FROM assinaturas WHERE loja_id = ?', [lojaId]);
  const planoId = linhas.length > 0 ? linhas[0].plano : 'mensal';
  const meses = Number(obterPlano(planoId).meses);
  // Renovação antecipada soma ao saldo restante; assinatura vencida conta a partir de hoje.
  await cx.executar(
    `UPDATE assinaturas
     SET status = 'ativa',
         valida_ate = DATE_ADD(GREATEST(COALESCE(valida_ate, CURDATE()), CURDATE()), INTERVAL ? MONTH),
         atualizado_em = NOW(3)
     WHERE loja_id = ?`,
    [meses, lojaId],
  );
  await cx.executar('UPDATE lojas SET ativa = TRUE, atualizado_em = NOW(3) WHERE id = ?', [lojaId]);
}

/**
 * Registra pagamento MP. Só estende a validade na 1ª aprovação do payment_id.
 *
 * Serializa por mp_payment_id (GET_LOCK) para webhooks concorrentes não
 * estenderem a assinatura duas vezes, além da idempotência por status.
 */
export async function registrarPagamento(lojaId, pagamento) {
  const mpId = String(pagamento.id);
  const statusNovo = pagamento.status;
  const payload = JSON.stringify({
    status: pagamento.status ?? null,
    status_detail: pagamento.status_detail ?? null,
    date_approved: pagamento.date_approved ?? null,
  });
  const valor = pagamento.transaction_amount ?? null;

  await db.transacao(
    async (cx) => {
      const anterior = await cx.consultar('SELECT status FROM pagamentos WHERE mp_payment_id = ?', [mpId]);
      const statusAnterior = anterior.length > 0 ? anterior[0].status : null;

      if (anterior.length === 0) {
        await cx.executar(
          `INSERT INTO pagamentos (id, loja_id, mp_payment_id, status, valor, payload)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [randomUUID(), lojaId, mpId, statusNovo, valor, payload],
        );
      } else {
        await cx.executar('UPDATE pagamentos SET status = ?, payload = ? WHERE mp_payment_id = ?', [
          statusNovo,
          payload,
          mpId,
        ]);
      }

      if (deveEstenderAssinatura(statusAnterior, statusNovo)) {
        await ativarAssinaturaNaTransacao(cx, lojaId);
      } else if (deveMarcarInadimplente(statusAnterior, statusNovo)) {
        // Estorno/chargeback: marca inadimplente (acesso segue liberado com aviso).
        await cx.executar(
          `UPDATE assinaturas SET status = 'inadimplente', atualizado_em = NOW(3)
           WHERE loja_id = ? AND status = 'ativa'`,
          [lojaId],
        );
      }
    },
    {
      lockNome: `cybhor:pagamento:${mpId}`,
      lockTimeoutSegundos: SEGUNDOS_ESPERA_LOCK_PAGAMENTO,
    },
  );
}

/** Consulta o MP e registra a primeira aprovação da loja (rede de segurança do webhook). */
export async function sincronizarPagamentoLoja(lojaId) {
  if (!config.mpAccessToken) return;
  try {
    const busca = await chamarMercadoPago(
      `/v1/payments/search?sort=date_created&criteria=desc` +
        `&external_reference=${encodeURIComponent(lojaId)}&limit=${LIMITE_PAGAMENTOS_SINCRONIZACAO}`,
    );
    const pagamentos = Array.isArray(objetoOuVazio(busca).results) ? busca.results : [];
    const aprovado = pagamentos.find((pagamento) => pagamento?.status === 'approved');
    if (aprovado) await registrarPagamento(lojaId, aprovado);
  } catch (erro) {
    logger.error('Falha ao sincronizar pagamento MP', erro?.message ?? erro);
  }
}

async function listarMetodosSeguro() {
  if (!config.mpAccessToken) return [];
  try {
    const resposta = await fetch(`${MP_API}/v1/payment_methods`, {
      headers: {
        Authorization: `Bearer ${config.mpAccessToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MP_MS),
    });
    const dados = await resposta.json();
    if (!resposta.ok || !Array.isArray(dados)) return [];
    return dados
      .filter((metodo) => metodo?.status === 'active')
      .map((metodo) => ({
        id: metodo.id,
        nome: metodo.name ?? null,
        tipo: metodo.payment_type_id ?? null,
        thumbnail: metodo.secure_thumbnail || metodo.thumbnail || null,
      }));
  } catch (erro) {
    logger.error('Nao foi possivel listar metodos MP', erro?.message ?? erro);
    return [];
  }
}

export async function obterConfiguracaoPagamentoSite() {
  return {
    customization: configuracaoBrickPagamento(),
    metodosDisponiveis: await listarMetodosSeguro(),
    metodosHabilitados: Object.entries(ROTULOS_METODOS).map(([chave, rotulo]) => ({ chave, rotulo })),
  };
}

async function carregarPlanoEValor(lojaId) {
  const assinatura = await db.consultar(
    'SELECT plano, valor_mensal FROM assinaturas WHERE loja_id = ?',
    [lojaId],
  );
  const plano = obterPlano(assinatura.length > 0 ? assinatura[0].plano : 'mensal');
  const valorGravado = assinatura.length > 0 ? Number(assinatura[0].valor_mensal) : 0;
  return { plano, valor: valorGravado || plano.valor };
}

/**
 * Cria a preferência do Checkout Pro e grava o id/valor na assinatura.
 * @param {string} lojaId
 * @param {{ email?: string, origemSite?: boolean, tokenAtivacao?: string }} [opcoes]
 * @returns {Promise<{ checkoutUrl: string, preferenciaId: string }>}
 */
export async function criarCheckoutAssinatura(lojaId, opcoes = {}) {
  const lojas = await db.consultar(
    `SELECT id, nome, email, responsavel_nome, responsavel_sobrenome
     FROM lojas WHERE id = ?`,
    [lojaId],
  );
  if (lojas.length === 0) throw new ErroNegocio('Loja nao encontrada.', 404);

  const registro = lojas[0];
  const siteBase = config.urlPublicaSite.replace(/\/+$/, '');
  const apiBase = (config.urlPublicaApi || siteBase).replace(/\/+$/, '');
  const { plano, valor } = await carregarPlanoEValor(lojaId);

  const preferencia = {
    items: [
      {
        id: `cybhorpdv-${plano.id}`,
        title: `CybhorPDV — assinatura ${plano.nome.toLowerCase()} (${registro.nome})`,
        description:
          `Acesso ao sistema PDV CybhorPDV por ${plano.meses} ${plano.meses === 1 ? 'mes' : 'meses'}. ` +
          'Codigo individual da loja liberado apos pagamento.',
        quantity: 1,
        currency_id: 'BRL',
        unit_price: valor,
        category_id: 'services',
      },
    ],
    external_reference: lojaId,
    statement_descriptor: 'CYBHORPDV',
    payment_methods: { installments: 12, default_installments: 1 },
    metadata: { loja_id: lojaId, produto: `assinatura-${plano.id}` },
  };
  if (apiBase.startsWith('https://')) {
    preferencia.notification_url = `${apiBase}/api/pagamentos/webhook`;
  }

  const pagador = {};
  const email = texto(opcoes.email || registro.email);
  if (email) pagador.email = email;
  if (registro.responsavel_nome) pagador.name = registro.responsavel_nome;
  if (registro.responsavel_sobrenome) pagador.surname = registro.responsavel_sobrenome;
  if (Object.keys(pagador).length > 0) preferencia.payer = pagador;

  if (opcoes.origemSite && opcoes.tokenAtivacao) {
    const urlSucesso = `${siteBase}/sucesso.html?token=${encodeURIComponent(String(opcoes.tokenAtivacao))}`;
    preferencia.back_urls = {
      success: urlSucesso,
      failure: `${siteBase}/falha.html`,
      pending: `${urlSucesso}&pendente=1`,
    };
    preferencia.metadata.token_ativacao = opcoes.tokenAtivacao;
    if (siteBase.startsWith('https://')) preferencia.auto_return = 'approved';
  }

  const criada = await chamarMercadoPago('/checkout/preferences', { method: 'POST', body: preferencia });
  if (!criada || !criada.id) throw new ErroNegocio('Falha ao criar checkout no Mercado Pago.', 502);

  const urlCheckout = criada.init_point || criada.sandbox_init_point;
  if (!urlCheckout) throw new ErroNegocio('Mercado Pago nao devolveu o link de pagamento.', 502);

  await db.executar(
    'UPDATE assinaturas SET mp_preference_id = ?, valor_mensal = ?, atualizado_em = NOW(3) WHERE loja_id = ?',
    [String(criada.id), valor, lojaId],
  );
  return { checkoutUrl: urlCheckout, preferenciaId: criada.id };
}

/**
 * Cobra pelo Checkout Transparente (Payment Brick) e registra o resultado.
 * @param {string} lojaId
 * @param {string} email
 * @param {Record<string, any>} formData dados do Brick.
 * @param {{ firstName?: string, lastName?: string }} [pagador]
 */
export async function criarPagamentoTransparente(lojaId, email, formData, pagador = {}) {
  const lojas = await db.consultar(
    'SELECT id, nome, responsavel_nome, responsavel_sobrenome FROM lojas WHERE id = ?',
    [lojaId],
  );
  if (lojas.length === 0) throw new ErroNegocio('Loja nao encontrada.', 404);

  const registro = lojas[0];
  const { valor } = await carregarPlanoEValor(lojaId);
  const dadosForm = objetoOuVazio(formData);
  const pagadorEntrada = objetoOuVazio(dadosForm.payer);

  const primeiroNome = pagadorEntrada.first_name || pagador.firstName || registro.responsavel_nome || '';
  const sobrenome = pagadorEntrada.last_name || pagador.lastName || registro.responsavel_sobrenome || '';
  if (!dadosForm.payment_method_id) throw new ErroNegocio('Forma de pagamento nao informada.');

  const corpo = montarCorpoPagamento({
    lojaId,
    valor,
    nomeLoja: registro.nome,
    email,
    firstName: primeiroNome,
    lastName: sobrenome,
    formData: dadosForm,
  });

  const apiBase = config.urlPublicaApi.replace(/\/+$/, '');
  if (apiBase.startsWith('https://')) corpo.notification_url = `${apiBase}/api/pagamentos/webhook`;
  corpo.statement_descriptor = 'CYBHORPDV';

  const pagamento = await chamarMercadoPago('/v1/payments', { method: 'POST', body: corpo });
  if (!pagamento || !pagamento.id) {
    throw new ErroNegocio('Falha ao processar pagamento no Mercado Pago.', 502);
  }
  await registrarPagamento(lojaId, pagamento);
  await db.executar(
    'UPDATE assinaturas SET valor_mensal = ?, atualizado_em = NOW(3) WHERE loja_id = ?',
    [valor, lojaId],
  );
  return pagamento;
}

function motivoDaFalhaWebhook(erro) {
  const mensagem = erro.mensagem.toLowerCase();
  if (erro.status === 401) return 'assinatura';
  if (mensagem.includes('notificacao de pagamento')) return 'payment_id_invalido';
  if (mensagem.includes('segredo')) return 'segredo_ausente';
  if (mensagem.includes('mercado pago')) return 'mp_api';
  return 'erro_negocio';
}

/**
 * Processa a notificação do MP. O corpo é só um aviso: o pagamento é sempre
 * reconsultado na API do MP com o nosso token antes de liberar a assinatura.
 */
export async function processarWebhook(notificacao, { assinatura = '', requestId = '' } = {}) {
  const tipo = texto(notificacao.type || notificacao.topic).toLowerCase();
  const dados = objetoOuVazio(notificacao.data);
  let paymentId = dados.id || notificacao.id || notificacao['data.id'];

  try {
    if (!['payment', ''].includes(tipo) || !paymentId) {
      if (texto(notificacao.topic).toLowerCase() !== 'payment') return { ignorado: true };
      paymentId = notificacao.id;
      if (!paymentId) return { ignorado: true };
    }

    paymentId = paymentIdSeguro(paymentId);
    verificarAssinaturaWebhook({ paymentId, assinatura, requestId });

    const pagamento = await chamarMercadoPago(`/v1/payments/${paymentId}`);
    if (!pagamento || typeof pagamento !== 'object' || Array.isArray(pagamento)) {
      logarFalhaWebhook('resposta_mp_invalida', { paymentId });
      return { ignorado: true };
    }
    const lojaId = pagamento.external_reference;
    if (!lojaId) {
      logarFalhaWebhook('sem_external_reference', { paymentId });
      return { ignorado: true };
    }

    await registrarPagamento(String(lojaId), pagamento);
    return { processado: true, status: pagamento.status };
  } catch (erro) {
    if (erro instanceof ErroNegocio) {
      logarFalhaWebhook(motivoDaFalhaWebhook(erro), { paymentId, statusHttp: erro.status });
    } else {
      logarFalhaWebhook('excecao', { paymentId, statusHttp: 500 });
    }
    throw erro;
  }
}

/** Situação da assinatura da loja; antes sincroniza com o MP caso o webhook tenha falhado. */
export async function obterAssinatura(lojaId) {
  await sincronizarPagamentoLoja(lojaId);
  const linhas = await db.consultar(
    `SELECT status, plano, valor_mensal AS valorMensal, valida_ate AS validaAte
     FROM assinaturas WHERE loja_id = ?`,
    [lojaId],
  );
  if (linhas.length === 0) throw new ErroNegocio('Assinatura nao encontrada.', 404);
  return { ...linhas[0], valorMensal: Number(linhas[0].valorMensal || 0) };
}
