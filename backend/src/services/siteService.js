"use strict";

const crypto = require("crypto");
const { consultar } = require("../config/db");
const { env } = require("../config/env");
const { ErroNegocio } = require("../middlewares/erros");
const { criarLojaComAdmin } = require("./lojaService");
const {
  criarPagamentoTransparente,
  sincronizarPagamentoLoja,
  obterConfiguracaoPagamentoSite,
} = require("./pagamentoService");

function gerarTokenAtivacao() {
  return crypto.randomBytes(32).toString("hex");
}

/** Nome/sobrenome exigidos pelo boleto registrado do Mercado Pago. */
function resolverNomePagador(registro, nomeCompletoAdmin) {
  if (registro.responsavel_nome && registro.responsavel_sobrenome) {
    return {
      primeiroNome: registro.responsavel_nome,
      sobrenome: registro.responsavel_sobrenome,
    };
  }
  const partes = (nomeCompletoAdmin || "").trim().split(/\s+/);
  if (partes.length >= 2) {
    return { primeiroNome: partes[0], sobrenome: partes.slice(1).join(" ") };
  }
  const unico = partes[0] || "Cliente";
  return { primeiroNome: unico, sobrenome: unico };
}

/**
 * Cadastro pelo site: cria loja inativa e token para a etapa de pagamento.
 * O codigo individual so e revelado apos pagamento aprovado.
 */
async function comprarPeloSite({ loja, admin }) {
  const { lojaId } = await criarLojaComAdmin({
    loja,
    admin,
    aguardarPagamento: true,
  });

  const tokenAtivacao = gerarTokenAtivacao();
  await consultar(
    `UPDATE assinaturas
     SET token_ativacao = $1, valor_mensal = $2, atualizado_em = now()
     WHERE loja_id = $3`,
    [tokenAtivacao, env.mercadoPago.valorMensal, lojaId]
  );

  return { lojaId, tokenAtivacao };
}

/**
 * Dados para montar o Payment Brick na pagina de pagamento.
 * @param {string} token
 */
async function obterDadosPagamento(token) {
  const tokenLimpo = (token || "").trim();
  if (tokenLimpo.length < 32) throw new ErroNegocio("Token invalido.", 400);

  if (!env.mercadoPago.publicKey)
    throw new ErroNegocio("Pagamentos indisponiveis no momento.", 503);

  const resultado = await consultar(
    `SELECT l.id, l.nome, l.email, l.responsavel_nome, l.responsavel_sobrenome,
            a.status AS assinatura_status, f.nome AS admin_nome_completo
     FROM assinaturas a
     JOIN lojas l ON l.id = a.loja_id
     JOIN funcionarios f ON f.loja_id = l.id AND f.cargo = 'admin'
     WHERE a.token_ativacao = $1`,
    [tokenLimpo]
  );
  if (resultado.rowCount === 0) throw new ErroNegocio("Compra nao encontrada.", 404);

  const registro = resultado.rows[0];
  if (registro.assinatura_status === "ativa") {
    return { jaAtiva: true, tokenAtivacao: tokenLimpo };
  }

  const { primeiroNome, sobrenome } = resolverNomePagador(
    registro,
    registro.admin_nome_completo
  );

  const configMp = await obterConfiguracaoPagamentoSite();

  return {
    jaAtiva: false,
    tokenAtivacao: tokenLimpo,
    lojaId: registro.id,
    nomeLoja: registro.nome,
    email: registro.email,
    primeiroNome,
    sobrenome,
    publicKey: env.mercadoPago.publicKey,
    valorMensal: env.mercadoPago.valorMensal,
    customization: configMp.customization,
    metodosDisponiveis: configMp.metodosDisponiveis,
    metodosHabilitados: configMp.metodosHabilitados,
  };
}

/**
 * Processa pagamento do Checkout Transparente (Payment Brick + API Pagamentos).
 * @param {string} token
 * @param {object} formData
 */
async function processarPagamentoSite(token, formData) {
  const dados = await obterDadosPagamento(token);
  if (dados.jaAtiva) {
    return { status: "approved", redirectUrl: `/sucesso.html?token=${token}` };
  }

  const pagamento = await criarPagamentoTransparente(
    dados.lojaId,
    dados.email,
    formData || {},
    { firstName: dados.primeiroNome, lastName: dados.sobrenome }
  );

  const aprovado = pagamento.status === "approved";
  const pendente = pagamento.status === "pending" || pagamento.status === "in_process";

  if (aprovado) {
    return {
      status: pagamento.status,
      paymentId: pagamento.id,
      metodo: pagamento.payment_method_id,
      redirectUrl: `/sucesso.html?token=${token}`,
    };
  }

  if (pendente) {
    return {
      status: pagamento.status,
      paymentId: pagamento.id,
      metodo: pagamento.payment_method_id,
      redirectUrl: `/sucesso.html?token=${token}&pendente=1`,
      mensagem: "Pagamento em processamento. Siga as instrucoes abaixo.",
      exibirStatus: true,
    };
  }

  throw new ErroNegocio(
    pagamento.status_detail || "Pagamento nao aprovado. Tente outro metodo.",
    402
  );
}

/**
 * Consulta status da compra pelo token (pagina de sucesso).
 */
async function consultarAtivacao(token) {
  const tokenLimpo = (token || "").trim();
  if (tokenLimpo.length < 32) throw new ErroNegocio("Token invalido.", 400);

  const resultado = await consultar(
    `SELECT l.id, l.nome, l.codigo, l.ativa, a.status AS assinatura_status,
            f.usuario AS admin_usuario
     FROM assinaturas a
     JOIN lojas l ON l.id = a.loja_id
     JOIN funcionarios f ON f.loja_id = l.id AND f.cargo = 'admin'
     WHERE a.token_ativacao = $1`,
    [tokenLimpo]
  );
  if (resultado.rowCount === 0) throw new ErroNegocio("Compra nao encontrada.", 404);

  let registro = resultado.rows[0];

  if (registro.assinatura_status !== "ativa") {
    await sincronizarPagamentoLoja(registro.id);
    const atualizado = await consultar(
      `SELECT l.id, l.nome, l.codigo, l.ativa, a.status AS assinatura_status,
              f.usuario AS admin_usuario
       FROM assinaturas a
       JOIN lojas l ON l.id = a.loja_id
       JOIN funcionarios f ON f.loja_id = l.id AND f.cargo = 'admin'
       WHERE a.token_ativacao = $1`,
      [tokenLimpo]
    );
    registro = atualizado.rows[0];
  }

  if (registro.assinatura_status === "ativa" && registro.ativa) {
    return {
      status: "ativa",
      nomeLoja: registro.nome,
      codigo: registro.codigo,
      usuario: registro.admin_usuario,
      mensagem: "Pagamento confirmado! Use o codigo abaixo no CybhorPDV.",
    };
  }

  return {
    status: "pendente",
    mensagem: "Aguardando confirmacao do pagamento. Esta pagina atualiza sozinha.",
  };
}

module.exports = {
  comprarPeloSite,
  obterDadosPagamento,
  processarPagamentoSite,
  consultarAtivacao,
};
