import { ErroNegocio } from './errors.js';
import { converterParaInteiro, ehVerdadeiro, objetoOuVazio } from './utils/valores.js';

export const ROTULOS_METODOS = {
  creditCard: 'Cartao de credito',
  debitCard: 'Cartao de debito',
  prepaidCard: 'Cartao pre-pago',
  ticket: 'Boleto bancario',
  bankTransfer: 'Pix',
  mercadoPago: 'Saldo Mercado Pago',
};

const METODOS_BRASIL = {
  creditCard: 'all',
  debitCard: 'all',
  prepaidCard: 'all',
  ticket: ['bolbradesco'],
  bankTransfer: ['pix'],
  mercadoPago: ['wallet_purchase'],
  maxInstallments: 1,
};

const DIAS_VENCIMENTO_BOLETO = 3;

/** Configuração visual e de métodos do Payment Brick (checkout transparente). */
export function configuracaoBrickPagamento() {
  return {
    visual: {
      // Mesma paleta do site (claro, ação em tinta, cantos 4/6/8px).
      style: {
        theme: 'default',
        customVariables: {
          baseColor: '#171717',
          borderRadiusSmall: '4px',
          borderRadiusMedium: '6px',
          borderRadiusLarge: '8px',
        },
      },
      texts: {
        paymentMethods: {
          creditCardTitle: 'Cartao de credito',
          debitCardTitle: 'Cartao de debito',
          ticketTitle: 'Boleto bancario',
          bankTransferTitle: 'Pix',
        },
      },
    },
    paymentMethods: { ...METODOS_BRASIL },
  };
}

function somenteDigitos(valor) {
  return String(valor).replace(/\D/g, '');
}

function montarIdentificacao(documento) {
  const dados = objetoOuVazio(documento);
  if (!dados.type || !dados.number) return null;
  return { type: dados.type, number: somenteDigitos(dados.number) };
}

/**
 * Monta o corpo do POST /v1/payments do Mercado Pago a partir do formData do Brick.
 * @returns {Record<string, any>}
 * @throws {ErroNegocio} quando faltam dados do pagamento.
 */
export function montarCorpoPagamento({ lojaId, valor, nomeLoja, email, firstName, lastName, formData }) {
  const metodo = formData.payment_method_id;
  if (!metodo) throw new ErroNegocio('Forma de pagamento nao informada.');

  const pagadorEntrada = objetoOuVazio(formData.payer);
  const pagador = {
    email: pagadorEntrada.email || email,
    first_name: firstName,
    last_name: lastName,
  };

  const identificacao = montarIdentificacao(pagadorEntrada.identification);
  if (identificacao) pagador.identification = identificacao;

  const corpo = {
    transaction_amount: valor,
    description: `CybhorPDV — assinatura mensal (${nomeLoja})`,
    payment_method_id: metodo,
    external_reference: lojaId,
    payer: pagador,
  };

  if (formData.token) {
    corpo.token = formData.token;
    corpo.installments = converterParaInteiro(formData.installments || 1);
    if (corpo.installments === null) throw new ErroNegocio('Parcelamento invalido.');
    if (formData.issuer_id) {
      const emissor = converterParaInteiro(formData.issuer_id);
      if (emissor === null) throw new ErroNegocio('Emissor do cartao invalido.');
      corpo.issuer_id = emissor;
    }
  }

  if (metodo === 'bolbradesco') {
    const vencimento = new Date(Date.now() + DIAS_VENCIMENTO_BOLETO * 24 * 60 * 60 * 1000);
    corpo.date_of_expiration = vencimento.toISOString();
  }

  if (metodo === 'pix' && !pagador.identification) {
    const origemDocumento = ehVerdadeiro(pagadorEntrada.identification)
      ? pagadorEntrada.identification
      : formData.identification;
    const documento = montarIdentificacao(origemDocumento);
    if (documento) pagador.identification = documento;
  }

  return corpo;
}
