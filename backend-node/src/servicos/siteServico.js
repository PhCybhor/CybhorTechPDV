import { randomBytes } from "node:crypto";
import { config } from "../config.js";
import * as db from "../db.js";
import { ErroNegocio } from "../erros.js";
import { validarCpf } from "../regras/cpf.js";
import { validarAceiteDiretrizes } from "../regras/diretrizes.js";
import { lerTextoLimpo } from "../regras/entrada.js";
import { obterPlano } from "../regras/planos.js";
import { criarLojaComAdmin } from "./lojaServico.js";
import {
  criarCheckoutAssinatura,
  criarPagamentoTransparente,
  obterConfiguracaoPagamentoSite,
  sincronizarPagamentoLoja,
} from "./pagamentoServico.js";

const DIAS_TESTE_GRATIS = 30;
const TOKEN_ATIVACAO_VALIDO = /^[0-9a-f]{64}$/;
// Depois de 24h a página de sucesso não mostra mais o código (link pode ter vazado).
const JANELA_EXIBICAO_CODIGO_MS = 24 * 60 * 60 * 1000;

const SQL_COMPRA_POR_TOKEN = `
  SELECT l.id, l.nome, l.codigo, l.ativa, a.status AS assinatura_status,
         a.atualizado_em, f.usuario AS admin_usuario
  FROM assinaturas a
  JOIN lojas l ON l.id = a.loja_id
  JOIN funcionarios f ON f.loja_id = l.id AND f.cargo = 'admin'
  WHERE a.token_ativacao = ?
  ORDER BY f.criado_em ASC
  LIMIT 1`;

/** @returns {string} 32 bytes aleatórios em hex (64 caracteres). */
export function gerarTokenAtivacao() {
  return randomBytes(32).toString("hex");
}

function resolverNomePagador(registro, nomeCompletoAdmin) {
  if (registro.responsavel_nome && registro.responsavel_sobrenome) {
    return [registro.responsavel_nome, registro.responsavel_sobrenome];
  }
  const partes = String(nomeCompletoAdmin || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (partes.length >= 2) return [partes[0], partes.slice(1).join(" ")];
  const unico = partes[0] || "Cliente";
  return [unico, unico];
}

async function iniciarTesteGratis({ loja, admin, cpf, aceite }) {
  const jaUsou = await db.consultar("SELECT 1 FROM trials_cpf WHERE cpf = ?", [cpf]);
  if (jaUsou.length) throw new ErroNegocio("Este CPF ja usou o teste gratis de 30 dias. Escolha um plano pago.", 409);

  const token = gerarTokenAtivacao();
  const criada = await criarLojaComAdmin({
    loja: { ...loja, cpf },
    admin,
    aguardarPagamento: false,
    cpf,
    diasValidade: DIAS_TESTE_GRATIS,
    plano: "teste",
    trialCpf: cpf,
    aceiteDiretrizes: aceite,
  });
  await db.executar(
    "UPDATE assinaturas SET token_ativacao = ?, plano = 'teste', valor_mensal = 0, atualizado_em = CURRENT_TIMESTAMP(3) WHERE loja_id = ?",
    [token, criada.lojaId],
  );
  return {
    lojaId: criada.lojaId,
    tokenAtivacao: token,
    checkoutUrl: "",
    publicKey: "",
    trial: true,
    codigo: criada.codigo,
    usuario: lerTextoLimpo(admin.usuario).toLowerCase(),
    redirectUrl: `/sucesso.html?token=${token}&trial=1`,
  };
}

/**
 * Cria a loja pelo site (teste grátis ou plano pago).
 * O aceite das Diretrizes é exigido antes de qualquer outra validação,
 * para nenhuma loja nascer sem ele.
 */
export async function comprarPeloSite({ loja = {}, admin = {}, plano = "mensal", aceiteDiretrizes = null, ip = "", navegador = "" }) {
  const aceite = validarAceiteDiretrizes(aceiteDiretrizes, { ip, navegador });
  const escolhido = obterPlano(plano);
  const cpf = validarCpf(loja.cpf || admin.cpf || "");

  if (escolhido.gratis) return iniciarTesteGratis({ loja, admin, cpf, aceite });

  if (!config.mpAccessToken) throw new ErroNegocio("Pagamentos indisponiveis no momento.", 503);

  const criada = await criarLojaComAdmin({
    loja: { ...loja, cpf },
    admin,
    aguardarPagamento: true,
    cpf,
    aceiteDiretrizes: aceite,
  });
  const token = gerarTokenAtivacao();
  await db.executar(
    "UPDATE assinaturas SET token_ativacao = ?, plano = ?, valor_mensal = ?, atualizado_em = CURRENT_TIMESTAMP(3) WHERE loja_id = ?",
    [token, escolhido.id, escolhido.valor, criada.lojaId],
  );
  const email = lerTextoLimpo(loja.email || admin.email);
  const checkout = await criarCheckoutAssinatura(criada.lojaId, { email, origemSite: true, tokenAtivacao: token });
  return {
    lojaId: criada.lojaId,
    tokenAtivacao: token,
    checkoutUrl: checkout.checkoutUrl,
    publicKey: config.mpPublicKey,
    trial: false,
  };
}

/** Dados da tela de pagamento do site (Brick transparente ou link do Checkout Pro). */
export async function obterDadosPagamento(token) {
  const tokenLimpo = lerTextoLimpo(token);
  if (tokenLimpo.length < 32) throw new ErroNegocio("Token invalido.", 400);
  if (!config.mpAccessToken) throw new ErroNegocio("Pagamentos indisponiveis no momento.", 503);

  const [registro] = await db.consultar(
    `SELECT l.id, l.nome, l.email, l.responsavel_nome, l.responsavel_sobrenome,
            a.status AS assinatura_status, a.plano, a.valor_mensal, f.nome AS admin_nome_completo
     FROM assinaturas a
     JOIN lojas l ON l.id = a.loja_id
     JOIN funcionarios f ON f.loja_id = l.id AND f.cargo = 'admin'
     WHERE a.token_ativacao = ?
     ORDER BY f.criado_em ASC
     LIMIT 1`,
    [tokenLimpo],
  );
  if (!registro) throw new ErroNegocio("Compra nao encontrada.", 404);
  if (registro.assinatura_status === "ativa") return { jaAtiva: true, tokenAtivacao: tokenLimpo };

  const [primeiroNome, sobrenome] = resolverNomePagador(registro, registro.admin_nome_completo);
  const plano = obterPlano(registro.plano || "mensal");
  const resposta = {
    jaAtiva: false,
    tokenAtivacao: tokenLimpo,
    lojaId: registro.id,
    nomeLoja: registro.nome,
    email: registro.email,
    primeiroNome,
    sobrenome,
    publicKey: config.mpPublicKey,
    valorMensal: Number(registro.valor_mensal || plano.valor),
    plano: plano.id,
    planoNome: plano.nome,
    planoRotulo: plano.rotuloPeriodo,
    modo: config.mpPublicKey ? "transparente" : "checkout_pro",
  };
  if (config.mpPublicKey) {
    const configuracaoMp = await obterConfiguracaoPagamentoSite();
    resposta.customization = configuracaoMp.customization;
    resposta.metodosDisponiveis = configuracaoMp.metodosDisponiveis;
    resposta.metodosHabilitados = configuracaoMp.metodosHabilitados;
  } else {
    const checkout = await criarCheckoutAssinatura(registro.id, {
      email: registro.email,
      origemSite: true,
      tokenAtivacao: tokenLimpo,
    });
    resposta.checkoutUrl = checkout.checkoutUrl;
  }
  return resposta;
}

/** Envia o formData do Brick ao MP e devolve para onde o site deve redirecionar. */
export async function processarPagamentoSite(token, dadosFormulario) {
  const dados = await obterDadosPagamento(token);
  if (dados.jaAtiva) return { status: "approved", redirectUrl: `/sucesso.html?token=${token}` };

  const pagamento = await criarPagamentoTransparente(dados.lojaId, dados.email, dadosFormulario || {}, {
    firstName: dados.primeiroNome,
    lastName: dados.sobrenome,
  });

  const { status } = pagamento;
  if (status === "approved") {
    return {
      status,
      paymentId: pagamento.id ?? null,
      metodo: pagamento.payment_method_id ?? null,
      redirectUrl: `/sucesso.html?token=${token}`,
    };
  }
  if (status === "pending" || status === "in_process") {
    return {
      status,
      paymentId: pagamento.id ?? null,
      metodo: pagamento.payment_method_id ?? null,
      redirectUrl: `/sucesso.html?token=${token}&pendente=1`,
      mensagem: "Pagamento em processamento. Siga as instrucoes abaixo.",
      exibirStatus: true,
    };
  }
  throw new ErroNegocio("Pagamento nao aprovado. Tente outro metodo.", 402);
}

/** Página de sucesso: mostra código e usuário da loja quando o pagamento confirmar. */
export async function consultarAtivacao(token) {
  const tokenLimpo = lerTextoLimpo(token);
  if (!TOKEN_ATIVACAO_VALIDO.test(tokenLimpo)) throw new ErroNegocio("Token invalido.", 400);

  let [registro] = await db.consultar(SQL_COMPRA_POR_TOKEN, [tokenLimpo]);
  if (!registro) throw new ErroNegocio("Compra nao encontrada.", 404);

  if (registro.assinatura_status !== "ativa") {
    await sincronizarPagamentoLoja(registro.id);
    [registro] = await db.consultar(SQL_COMPRA_POR_TOKEN, [tokenLimpo]);
  }

  if (registro.assinatura_status === "ativa" && registro.ativa) {
    const atualizadoEm = registro.atualizado_em instanceof Date ? registro.atualizado_em.getTime() : null;
    if (atualizadoEm !== null && atualizadoEm < Date.now() - JANELA_EXIBICAO_CODIGO_MS) {
      return {
        status: "ativa",
        nomeLoja: registro.nome,
        codigo: "",
        usuario: "",
        mensagem: "Pagamento confirmado. Consulte o codigo em Area do cliente.",
      };
    }
    return {
      status: "ativa",
      nomeLoja: registro.nome,
      codigo: registro.codigo,
      usuario: registro.admin_usuario,
      mensagem: "Loja ativa. Use o codigo abaixo no CybhorPDV.",
    };
  }
  return { status: "pendente", mensagem: "Aguardando confirmacao do pagamento. Esta pagina atualiza sozinha." };
}
