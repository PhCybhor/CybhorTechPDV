import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { validarCpf } from '../cpf.js';
import * as db from '../db.js';
import { validarAceiteDiretrizes } from '../diretrizes.js';
import { ErroNegocio } from '../errors.js';
import { obterPlano } from '../planos.js';
import { objetoOuVazio, texto } from '../utils/valores.js';
import { criarLojaComAdmin } from './lojaService.js';
import {
  criarCheckoutAssinatura,
  criarPagamentoTransparente,
  obterConfiguracaoPagamentoSite,
  sincronizarPagamentoLoja,
} from './pagamentoService.js';

const TAMANHO_MINIMO_TOKEN = 32;
const PADRAO_TOKEN_ATIVACAO = /^[0-9a-f]{64}$/;
const DIAS_TESTE_GRATIS = 30;
const HORAS_CODIGO_VISIVEL = 24;

const SQL_ATIVACAO = `
  SELECT l.id, l.nome, l.codigo, l.ativa, a.status AS assinatura_status,
         a.atualizado_em, f.usuario AS admin_usuario
  FROM assinaturas a
  JOIN lojas l ON l.id = a.loja_id
  JOIN funcionarios f ON f.loja_id = l.id AND f.cargo = 'admin'
  WHERE a.token_ativacao = ?
  ORDER BY f.criado_em ASC
  LIMIT 1`;

/** Token de 256 bits que identifica a compra no navegador (substitui login nessa etapa). */
function gerarTokenAtivacao() {
  return randomBytes(32).toString('hex');
}

function resolverNomePagador(registro, nomeCompletoAdmin) {
  if (registro.responsavel_nome && registro.responsavel_sobrenome) {
    return [registro.responsavel_nome, registro.responsavel_sobrenome];
  }
  const partes = texto(nomeCompletoAdmin).split(/\s+/).filter(Boolean);
  if (partes.length >= 2) return [partes[0], partes.slice(1).join(' ')];
  const unico = partes[0] || 'Cliente';
  return [unico, unico];
}

/**
 * Cria a loja pelo site (teste grátis ou plano pago).
 *
 * O aceite das Diretrizes da comunidade é exigido antes de qualquer outra
 * validação, para nenhuma loja nascer sem ele.
 */
export async function comprarPeloSite({ loja, admin, plano = 'mensal', aceiteDiretrizes, ip = '', navegador = '' }) {
  const aceite = validarAceiteDiretrizes(aceiteDiretrizes, { ip, navegador });
  const dadosLoja = objetoOuVazio(loja);
  const dadosAdmin = objetoOuVazio(admin);
  const escolhido = obterPlano(plano);
  const cpf = validarCpf(dadosLoja.cpf || dadosAdmin.cpf || '');

  if (escolhido.gratis) {
    return iniciarTesteGratis({ loja: dadosLoja, admin: dadosAdmin, cpf, aceite });
  }

  if (!config.mpAccessToken) throw new ErroNegocio('Pagamentos indisponiveis no momento.', 503);

  const criada = await criarLojaComAdmin({
    loja: { ...dadosLoja, cpf },
    admin: dadosAdmin,
    aguardarPagamento: true,
    cpf,
    aceiteDiretrizes: aceite,
  });
  const token = gerarTokenAtivacao();
  await db.executar(
    `UPDATE assinaturas
     SET token_ativacao = ?, plano = ?, valor_mensal = ?, atualizado_em = NOW(3)
     WHERE loja_id = ?`,
    [token, escolhido.id, escolhido.valor, criada.lojaId],
  );
  const checkout = await criarCheckoutAssinatura(criada.lojaId, {
    email: texto(dadosLoja.email || dadosAdmin.email),
    origemSite: true,
    tokenAtivacao: token,
  });
  return {
    lojaId: criada.lojaId,
    tokenAtivacao: token,
    checkoutUrl: checkout.checkoutUrl,
    publicKey: config.mpPublicKey,
    trial: false,
  };
}

async function iniciarTesteGratis({ loja, admin, cpf, aceite }) {
  const jaUsou = await db.consultar('SELECT 1 FROM trials_cpf WHERE cpf = ?', [cpf]);
  if (jaUsou.length > 0) {
    throw new ErroNegocio('Este CPF ja usou o teste gratis de 30 dias. Escolha um plano pago.', 409);
  }

  const token = gerarTokenAtivacao();
  const criada = await criarLojaComAdmin({
    loja: { ...loja, cpf },
    admin,
    aguardarPagamento: false,
    cpf,
    diasValidade: DIAS_TESTE_GRATIS,
    plano: 'teste',
    trialCpf: cpf,
    aceiteDiretrizes: aceite,
  });
  await db.executar(
    `UPDATE assinaturas
     SET token_ativacao = ?, plano = 'teste', valor_mensal = 0, atualizado_em = NOW(3)
     WHERE loja_id = ?`,
    [token, criada.lojaId],
  );
  return {
    lojaId: criada.lojaId,
    tokenAtivacao: token,
    checkoutUrl: '',
    publicKey: '',
    trial: true,
    codigo: criada.codigo,
    usuario: texto(admin.usuario).toLowerCase(),
    redirectUrl: `/sucesso.html?token=${token}&trial=1`,
  };
}

/** Dados para a página de pagamento (Brick transparente ou link do Checkout Pro). */
export async function obterDadosPagamento(token) {
  const tokenLimpo = texto(token);
  if (tokenLimpo.length < TAMANHO_MINIMO_TOKEN) throw new ErroNegocio('Token invalido.', 400);
  if (!config.mpAccessToken) throw new ErroNegocio('Pagamentos indisponiveis no momento.', 503);

  const linhas = await db.consultar(
    `SELECT l.id, l.nome, l.email, l.cpf, l.responsavel_nome, l.responsavel_sobrenome,
            a.status AS assinatura_status, a.plano, a.valor_mensal,
            f.nome AS admin_nome_completo
     FROM assinaturas a
     JOIN lojas l ON l.id = a.loja_id
     JOIN funcionarios f ON f.loja_id = l.id AND f.cargo = 'admin'
     WHERE a.token_ativacao = ?
     ORDER BY f.criado_em ASC
     LIMIT 1`,
    [tokenLimpo],
  );
  if (linhas.length === 0) throw new ErroNegocio('Compra nao encontrada.', 404);

  const registro = linhas[0];
  if (registro.assinatura_status === 'ativa') return { jaAtiva: true, tokenAtivacao: tokenLimpo };

  const [primeiroNome, sobrenome] = resolverNomePagador(registro, registro.admin_nome_completo);
  const lojaId = String(registro.id);
  const plano = obterPlano(registro.plano || 'mensal');
  const valor = Number(registro.valor_mensal) || plano.valor;

  const cpfLoja = texto(registro.cpf).replace(/\D/g, '');
  const resposta = {
    jaAtiva: false,
    tokenAtivacao: tokenLimpo,
    lojaId,
    nomeLoja: registro.nome,
    email: registro.email,
    primeiroNome,
    sobrenome,
    // CPF do cadastro pré-preenche o Brick (Pix/boleto exigem documento no Brasil).
    cpf: cpfLoja.length === 11 ? cpfLoja : '',
    publicKey: config.mpPublicKey,
    valorMensal: valor,
    plano: plano.id,
    planoNome: plano.nome,
    planoRotulo: plano.rotuloPeriodo,
    modo: config.mpPublicKey ? 'transparente' : 'checkout_pro',
  };

  if (config.mpPublicKey) {
    const configMp = await obterConfiguracaoPagamentoSite();
    resposta.customization = configMp.customization;
    resposta.metodosDisponiveis = configMp.metodosDisponiveis;
    resposta.metodosHabilitados = configMp.metodosHabilitados;
  } else {
    const checkout = await criarCheckoutAssinatura(lojaId, {
      email: registro.email,
      origemSite: true,
      tokenAtivacao: tokenLimpo,
    });
    resposta.checkoutUrl = checkout.checkoutUrl;
  }
  return resposta;
}

/** Cobra o formData do Brick e devolve para onde o navegador deve seguir. */
export async function processarPagamentoSite(token, formData) {
  const dados = await obterDadosPagamento(token);
  // Token já validado e aparado por obterDadosPagamento: seguro para montar a URL.
  const tokenSeguro = dados.tokenAtivacao;
  if (dados.jaAtiva) return { status: 'approved', redirectUrl: `/sucesso.html?token=${tokenSeguro}` };

  const pagamento = await criarPagamentoTransparente(dados.lojaId, dados.email, formData || {}, {
    firstName: dados.primeiroNome,
    lastName: dados.sobrenome,
  });

  const status = pagamento.status;
  if (status === 'approved') {
    return {
      status,
      paymentId: pagamento.id,
      metodo: pagamento.payment_method_id,
      redirectUrl: `/sucesso.html?token=${tokenSeguro}`,
    };
  }
  if (status === 'pending' || status === 'in_process') {
    return {
      status,
      paymentId: pagamento.id,
      metodo: pagamento.payment_method_id,
      redirectUrl: `/sucesso.html?token=${tokenSeguro}&pendente=1`,
      mensagem: 'Pagamento em processamento. Siga as instrucoes abaixo.',
      exibirStatus: true,
    };
  }
  throw new ErroNegocio('Pagamento nao aprovado. Tente outro metodo.', 402);
}

/**
 * Situação da compra para a página de sucesso (que faz polling).
 * O código da loja só aparece nas primeiras 24h, para o token não virar
 * uma chave permanente de consulta.
 */
export async function consultarAtivacao(token) {
  const tokenLimpo = texto(token);
  if (!PADRAO_TOKEN_ATIVACAO.test(tokenLimpo)) throw new ErroNegocio('Token invalido.', 400);

  let linhas = await db.consultar(SQL_ATIVACAO, [tokenLimpo]);
  if (linhas.length === 0) throw new ErroNegocio('Compra nao encontrada.', 404);

  let registro = linhas[0];
  if (registro.assinatura_status !== 'ativa') {
    await sincronizarPagamentoLoja(String(registro.id));
    linhas = await db.consultar(SQL_ATIVACAO, [tokenLimpo]);
    registro = linhas[0];
  }

  if (registro.assinatura_status === 'ativa' && registro.ativa) {
    const atualizado = registro.atualizado_em;
    const limite = Date.now() - HORAS_CODIGO_VISIVEL * 60 * 60 * 1000;
    if (atualizado instanceof Date && atualizado.getTime() < limite) {
      return {
        status: 'ativa',
        nomeLoja: registro.nome,
        codigo: '',
        usuario: '',
        mensagem: 'Pagamento confirmado. Consulte o codigo em Area do cliente.',
      };
    }
    return {
      status: 'ativa',
      nomeLoja: registro.nome,
      codigo: registro.codigo,
      usuario: registro.admin_usuario,
      mensagem: 'Loja ativa. Use o codigo abaixo no CybhorPDV.',
    };
  }
  return {
    status: 'pendente',
    mensagem: 'Aguardando confirmacao do pagamento. Esta pagina atualiza sozinha.',
  };
}
