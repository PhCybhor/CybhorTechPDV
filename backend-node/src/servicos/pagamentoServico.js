import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import * as db from "../db.js";
import { ErroNegocio } from "../erros.js";
import { logger } from "../logger.js";
import { deveEstenderAssinatura, deveMarcarInadimplente } from "../regras/assinatura.js";
import { ehObjetoSimples, lerTextoLimpo } from "../regras/entrada.js";
import { configuracaoBrickPagamento, montarCorpoPagamento, ROTULOS_METODOS } from "../regras/mercadoPago.js";
import { obterPlano } from "../regras/planos.js";

const MP_API = "https://api.mercadopago.com";
const TIMEOUT_MP_MS = 30_000;
const PAYMENT_ID_VALIDO = /^\d{6,24}$/;

/**
 * Chama a API do Mercado Pago com o token do .env.
 * @throws {ErroNegocio} 503 sem token, 502 em erro HTTP/rede (sem vazar corpo do MP).
 */
async function chamarMercadoPago(caminho, { metodo = "GET", corpo } = {}) {
  if (!config.mpAccessToken) throw new ErroNegocio("Pagamentos indisponiveis no momento.", 503);

  const cabecalhos = { Authorization: `Bearer ${config.mpAccessToken}`, "Content-Type": "application/json" };
  if (corpo !== undefined) cabecalhos["X-Idempotency-Key"] = randomUUID();

  let resposta;
  try {
    resposta = await fetch(`${MP_API}${caminho}`, {
      method: metodo,
      headers: cabecalhos,
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MP_MS),
    });
  } catch (erro) {
    logger.erro("mp_api_rede", erro, { metodo });
    throw new ErroNegocio("Falha ao comunicar com o Mercado Pago.", 502);
  }

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const codigo = ehObjetoSimples(dados) ? String(dados.error || dados.code || "-").slice(0, 64) : "-";
    // Sem corpo MP no log (PII / detalhes internos).
    logger.erro("mp_api_erro", null, { http: resposta.status, codigo, metodo });
    throw new ErroNegocio("Falha ao comunicar com o Mercado Pago.", 502);
  }
  return dados;
}

function paymentIdParaLog(valor) {
  const texto = String(valor ?? "").trim();
  return PAYMENT_ID_VALIDO.test(texto) ? texto : "-";
}

/** Log estruturado de falha no webhook — sem PII, assinatura ou corpo MP. */
function registrarFalhaWebhook(motivo, { paymentId = "", statusHttp = 0 } = {}) {
  logger.aviso("webhook_mp_falha", { motivo, paymentId: paymentIdParaLog(paymentId), statusHttp: statusHttp || "-" });
}

function paymentIdSeguro(valor) {
  const texto = String(valor ?? "").trim();
  if (!PAYMENT_ID_VALIDO.test(texto)) throw new ErroNegocio("Notificacao de pagamento invalida.", 400);
  return texto;
}

function compararSeguro(textoA, textoB) {
  const bufferA = Buffer.from(textoA, "utf8");
  const bufferB = Buffer.from(textoB, "utf8");
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

/**
 * Valida o cabeçalho x-signature (HMAC-SHA256 do manifesto do MP).
 * @throws {ErroNegocio} 401 assinatura ausente/inválida; 503 sem segredo em produção.
 */
export function verificarAssinaturaWebhook({ paymentId, assinatura, requestId }) {
  const segredo = config.mpWebhookSecret.trim();
  if (!segredo) {
    // Dev/local: aceita sem assinatura para facilitar testes do IPN.
    if (!config.emProducao) return;
    if (!config.mpWebhookSemAssinatura) throw new ErroNegocio("Webhook MP sem segredo configurado.", 503);
    logger.aviso("webhook_mp_sem_verificacao_assinatura", { paymentId: paymentIdParaLog(paymentId) });
    return;
  }

  const partes = {};
  for (const pedaco of String(assinatura || "").split(",")) {
    const separador = pedaco.indexOf("=");
    if (separador === -1) continue;
    partes[pedaco.slice(0, separador).trim()] = pedaco.slice(separador + 1).trim();
  }
  const ts = partes.ts || "";
  const hashRecebido = partes.v1 || "";
  if (!ts || !hashRecebido || !requestId) throw new ErroNegocio("Assinatura do webhook ausente.", 401);

  const manifesto = `id:${paymentId};request-id:${requestId};ts:${ts};`;
  const esperado = createHmac("sha256", segredo).update(manifesto, "utf8").digest("hex");
  if (!compararSeguro(esperado, hashRecebido)) throw new ErroNegocio("Assinatura do webhook invalida.", 401);
}

async function ativarAssinaturaNaTransacao(tx, lojaId) {
  const [linha] = await tx.consultar("SELECT plano FROM assinaturas WHERE loja_id = ?", [lojaId]);
  const meses = obterPlano(linha?.plano || "mensal").meses;
  await tx.executar(
    `UPDATE assinaturas
     SET status = 'ativa',
         valida_ate = DATE_ADD(GREATEST(COALESCE(valida_ate, CURRENT_DATE), CURRENT_DATE), INTERVAL ? MONTH),
         atualizado_em = CURRENT_TIMESTAMP(3)
     WHERE loja_id = ?`,
    [meses, lojaId],
  );
  await tx.executar("UPDATE lojas SET ativa = TRUE, atualizado_em = CURRENT_TIMESTAMP(3) WHERE id = ?", [lojaId]);
}

/** Ativa a loja e estende a validade pelos meses do plano. */
export function ativarAssinaturaLoja(lojaId) {
  return db.transacao((tx) => ativarAssinaturaNaTransacao(tx, lojaId));
}

/**
 * Registra pagamento MP. Só estende a validade na 1ª aprovação do payment_id.
 * O GET_LOCK por mp_payment_id põe webhooks concorrentes em fila, para não
 * estenderem a assinatura duas vezes.
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
    async (tx) => {
      const [anterior] = await tx.consultar("SELECT status FROM pagamentos WHERE mp_payment_id = ? FOR UPDATE", [mpId]);
      const statusAnterior = anterior?.status ?? null;

      if (!anterior) {
        await tx.executar(
          "INSERT INTO pagamentos (id, loja_id, mp_payment_id, status, valor, payload) VALUES (?, ?, ?, ?, ?, ?)",
          [randomUUID(), lojaId, mpId, statusNovo, valor, payload],
        );
      } else {
        await tx.executar("UPDATE pagamentos SET status = ?, payload = ? WHERE mp_payment_id = ?", [
          statusNovo,
          payload,
          mpId,
        ]);
      }

      if (deveEstenderAssinatura(statusAnterior, statusNovo)) {
        await ativarAssinaturaNaTransacao(tx, lojaId);
      } else if (deveMarcarInadimplente(statusAnterior, statusNovo)) {
        // Estorno/chargeback: marca inadimplente (acesso segue liberado com aviso).
        await tx.executar(
          "UPDATE assinaturas SET status = 'inadimplente', atualizado_em = CURRENT_TIMESTAMP(3) WHERE loja_id = ? AND status = 'ativa'",
          [lojaId],
        );
      }
    },
    { bloqueio: `cybhorpdv:mp:${mpId}` },
  );
}

/** Busca o último pagamento aprovado da loja no MP (o webhook pode ter se perdido). */
export async function sincronizarPagamentoLoja(lojaId) {
  if (!config.mpAccessToken) return;
  try {
    const busca = await chamarMercadoPago(
      `/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(lojaId)}&limit=5`,
    );
    if (!ehObjetoSimples(busca)) return;
    const resultados = Array.isArray(busca.results) ? busca.results : [];
    const aprovado = resultados.find((pagamento) => pagamento?.status === "approved");
    if (aprovado) await registrarPagamento(lojaId, aprovado);
  } catch (erro) {
    logger.erro("Falha ao sincronizar pagamento MP", erro);
  }
}

async function listarMetodosSeguro() {
  if (!config.mpAccessToken) return [];
  try {
    const metodos = await chamarMercadoPago("/v1/payment_methods");
    if (!Array.isArray(metodos)) return [];
    return metodos
      .filter((metodo) => ehObjetoSimples(metodo) && metodo.status === "active")
      .map((metodo) => ({
        id: metodo.id,
        nome: metodo.name ?? null,
        tipo: metodo.payment_type_id ?? null,
        thumbnail: metodo.secure_thumbnail || metodo.thumbnail || null,
      }));
  } catch (erro) {
    logger.erro("Nao foi possivel listar metodos MP", erro);
    return [];
  }
}

/** Customização do Brick, métodos ativos no MP e rótulos habilitados. */
export async function obterConfiguracaoPagamentoSite() {
  return {
    customization: configuracaoBrickPagamento(),
    metodosDisponiveis: await listarMetodosSeguro(),
    metodosHabilitados: Object.entries(ROTULOS_METODOS).map(([chave, rotulo]) => ({ chave, rotulo })),
  };
}

async function obterPlanoEValor(lojaId) {
  const [assinatura] = await db.consultar("SELECT plano, valor_mensal FROM assinaturas WHERE loja_id = ?", [lojaId]);
  const plano = obterPlano(assinatura?.plano || "mensal");
  return { plano, valor: Number(assinatura?.valor_mensal || plano.valor) };
}

function montarPreferencia({ lojaId, registro, plano, valor, opcoes, siteBase, apiBase }) {
  const preferencia = {
    items: [
      {
        id: `cybhorpdv-${plano.id}`,
        title: `CybhorPDV — assinatura ${plano.nome.toLowerCase()} (${registro.nome})`,
        description:
          `Acesso ao sistema PDV CybhorPDV por ${plano.meses} ${plano.meses === 1 ? "mes" : "meses"}. ` +
          "Codigo individual da loja liberado apos pagamento.",
        quantity: 1,
        currency_id: "BRL",
        unit_price: valor,
        category_id: "services",
      },
    ],
    external_reference: lojaId,
    statement_descriptor: "CYBHORPDV",
    payment_methods: { installments: 12, default_installments: 1 },
    metadata: { loja_id: lojaId, produto: `assinatura-${plano.id}` },
  };
  if (apiBase.startsWith("https://")) preferencia.notification_url = `${apiBase}/api/pagamentos/webhook`;

  const pagador = {};
  const email = lerTextoLimpo(opcoes.email || registro.email);
  if (email) pagador.email = email;
  if (registro.responsavel_nome) pagador.name = registro.responsavel_nome;
  if (registro.responsavel_sobrenome) pagador.surname = registro.responsavel_sobrenome;
  if (Object.keys(pagador).length) preferencia.payer = pagador;

  if (opcoes.origemSite && opcoes.tokenAtivacao) {
    const urlSucesso = `${siteBase}/sucesso.html?token=${encodeURIComponent(String(opcoes.tokenAtivacao))}`;
    preferencia.back_urls = {
      success: urlSucesso,
      failure: `${siteBase}/falha.html`,
      pending: `${urlSucesso}&pendente=1`,
    };
    preferencia.metadata.token_ativacao = opcoes.tokenAtivacao;
    if (siteBase.startsWith("https://")) preferencia.auto_return = "approved";
  }
  return preferencia;
}

/**
 * Cria a preferência do Checkout Pro para a assinatura da loja.
 * @returns {Promise<{ checkoutUrl: string, preferenciaId: string }>}
 */
export async function criarCheckoutAssinatura(lojaId, opcoes = {}) {
  const [registro] = await db.consultar(
    "SELECT id, nome, email, responsavel_nome, responsavel_sobrenome FROM lojas WHERE id = ?",
    [lojaId],
  );
  if (!registro) throw new ErroNegocio("Loja nao encontrada.", 404);

  const siteBase = config.urlPublicaSite.replace(/\/+$/, "");
  const apiBase = (config.urlPublicaApi || siteBase).replace(/\/+$/, "");
  const { plano, valor } = await obterPlanoEValor(lojaId);

  const preferencia = await chamarMercadoPago("/checkout/preferences", {
    metodo: "POST",
    corpo: montarPreferencia({ lojaId, registro, plano, valor, opcoes, siteBase, apiBase }),
  });
  if (!ehObjetoSimples(preferencia) || !preferencia.id) {
    throw new ErroNegocio("Falha ao criar checkout no Mercado Pago.", 502);
  }
  const linkPagamento = preferencia.init_point || preferencia.sandbox_init_point;
  if (!linkPagamento) throw new ErroNegocio("Mercado Pago nao devolveu o link de pagamento.", 502);

  await db.executar(
    "UPDATE assinaturas SET mp_preference_id = ?, valor_mensal = ?, atualizado_em = CURRENT_TIMESTAMP(3) WHERE loja_id = ?",
    [String(preferencia.id), valor, lojaId],
  );
  return { checkoutUrl: linkPagamento, preferenciaId: preferencia.id };
}

/**
 * Pagamento transparente (Payment Brick) já registrado no histórico.
 * @returns {Promise<Record<string, any>>} pagamento devolvido pelo MP.
 */
export async function criarPagamentoTransparente(lojaId, email, dadosFormulario, pagadorPadrao = {}) {
  const [registro] = await db.consultar(
    "SELECT id, nome, responsavel_nome, responsavel_sobrenome FROM lojas WHERE id = ?",
    [lojaId],
  );
  if (!registro) throw new ErroNegocio("Loja nao encontrada.", 404);

  const { valor } = await obterPlanoEValor(lojaId);
  const pagadorRecebido = ehObjetoSimples(dadosFormulario.payer) ? dadosFormulario.payer : {};
  const primeiroNome = pagadorRecebido.first_name || pagadorPadrao.firstName || registro.responsavel_nome || "";
  const sobrenome = pagadorRecebido.last_name || pagadorPadrao.lastName || registro.responsavel_sobrenome || "";
  if (!dadosFormulario.payment_method_id) throw new ErroNegocio("Forma de pagamento nao informada.");

  let corpo;
  try {
    corpo = montarCorpoPagamento({
      lojaId,
      valor,
      nomeLoja: registro.nome,
      email,
      primeiroNome,
      sobrenome,
      dadosFormulario,
    });
  } catch (erro) {
    throw new ErroNegocio(erro.message);
  }

  const apiBase = config.urlPublicaApi.replace(/\/+$/, "");
  if (apiBase.startsWith("https://")) corpo.notification_url = `${apiBase}/api/pagamentos/webhook`;
  corpo.statement_descriptor = "CYBHORPDV";

  const pagamento = await chamarMercadoPago("/v1/payments", { metodo: "POST", corpo });
  if (!ehObjetoSimples(pagamento) || !pagamento.id) {
    throw new ErroNegocio("Falha ao processar pagamento no Mercado Pago.", 502);
  }
  await registrarPagamento(lojaId, pagamento);
  await db.executar("UPDATE assinaturas SET valor_mensal = ?, atualizado_em = CURRENT_TIMESTAMP(3) WHERE loja_id = ?", [
    valor,
    lojaId,
  ]);
  return pagamento;
}

function classificarFalhaWebhook(erro) {
  const mensagem = erro.message.toLowerCase();
  if (erro.status === 401) return "assinatura";
  if (mensagem.includes("notificacao de pagamento")) return "payment_id_invalido";
  if (mensagem.includes("segredo")) return "segredo_ausente";
  if (mensagem.includes("mercado pago")) return "mp_api";
  return "erro_negocio";
}

function extrairPaymentId(notificacao) {
  const tipo = lerTextoLimpo(notificacao.type || notificacao.topic).toLowerCase();
  const dados = ehObjetoSimples(notificacao.data) ? notificacao.data : {};
  const paymentId = dados.id || notificacao.id || notificacao["data.id"];
  if (["payment", ""].includes(tipo) && paymentId) return paymentId;
  if (String(notificacao.topic || "").toLowerCase() !== "payment") return null;
  return notificacao.id || null;
}

/**
 * Processa a notificação do MP: valida assinatura, reconsulta o pagamento e registra.
 * @returns {Promise<{ ignorado: true } | { processado: true, status: string }>}
 */
export async function processarWebhook(notificacao, { assinatura = "", requestId = "" } = {}) {
  let paymentId = extrairPaymentId(notificacao);
  if (!paymentId) return { ignorado: true };
  try {
    paymentId = paymentIdSeguro(paymentId);
    verificarAssinaturaWebhook({ paymentId, assinatura, requestId });

    const pagamento = await chamarMercadoPago(`/v1/payments/${paymentId}`);
    if (!ehObjetoSimples(pagamento)) {
      registrarFalhaWebhook("resposta_mp_invalida", { paymentId });
      return { ignorado: true };
    }
    const lojaId = pagamento.external_reference;
    if (!lojaId) {
      registrarFalhaWebhook("sem_external_reference", { paymentId });
      return { ignorado: true };
    }
    await registrarPagamento(String(lojaId), pagamento);
    return { processado: true, status: pagamento.status };
  } catch (erro) {
    if (erro instanceof ErroNegocio) {
      registrarFalhaWebhook(classificarFalhaWebhook(erro), { paymentId, statusHttp: erro.status });
    } else {
      registrarFalhaWebhook("excecao", { paymentId, statusHttp: 500 });
    }
    throw erro;
  }
}

/** Situação da assinatura da loja (sincroniza com o MP antes). */
export async function obterAssinatura(lojaId) {
  await sincronizarPagamentoLoja(lojaId);
  const [assinatura] = await db.consultar(
    "SELECT status, plano, valor_mensal AS valorMensal, valida_ate AS validaAte FROM assinaturas WHERE loja_id = ?",
    [lojaId],
  );
  if (!assinatura) throw new ErroNegocio("Assinatura nao encontrada.", 404);
  return { ...assinatura, valorMensal: Number(assinatura.valorMensal || 0) };
}
