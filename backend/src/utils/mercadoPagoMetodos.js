"use strict";

/**
 * Tipos oficiais de pagamento do Mercado Pago (Brasil — MLB)
 * conforme documentacao do Payment Brick.
 * @see https://www.mercadopago.com.br/developers/pt/docs/checkout-bricks/payment-brick/advanced-features/manage-payment-methods
 */
const METODOS_BRASIL = {
  creditCard: "all",
  debitCard: "all",
  prepaidCard: "all",
  ticket: ["bolbradesco"],
  bankTransfer: ["pix"],
  mercadoPago: ["wallet_purchase"],
  maxInstallments: 1,
};

const ROTULOS_METODOS = {
  creditCard: "Cartao de credito",
  debitCard: "Cartao de debito",
  prepaidCard: "Cartao pre-pago",
  ticket: "Boleto bancario",
  bankTransfer: "Pix",
  mercadoPago: "Saldo Mercado Pago",
};

/**
 * Customizacao visual + metodos oficiais para o Payment Brick (MLB).
 */
function configuracaoBrickPagamento() {
  return {
    visual: {
      style: { theme: "dark" },
      texts: {
        paymentMethods: {
          creditCardTitle: "Cartao de credito",
          debitCardTitle: "Cartao de debito",
          ticketTitle: "Boleto bancario",
          bankTransferTitle: "Pix",
        },
      },
    },
    paymentMethods: { ...METODOS_BRASIL },
  };
}

/**
 * Monta o corpo do POST /v1/payments conforme o tipo escolhido no Brick.
 */
function montarCorpoPagamento({ lojaId, valor, nomeLoja, email, firstName, lastName, formData }) {
  const metodo = formData.payment_method_id;
  if (!metodo) throw new Error("Forma de pagamento nao informada.");

  const payer = {
    email: formData.payer?.email || email,
    first_name: firstName,
    last_name: lastName,
  };

  if (formData.payer?.identification?.type && formData.payer?.identification?.number) {
    payer.identification = {
      type: formData.payer.identification.type,
      number: String(formData.payer.identification.number).replace(/\D/g, ""),
    };
  }

  const corpo = {
    transaction_amount: valor,
    description: `CybhorPDV — assinatura mensal (${nomeLoja})`,
    payment_method_id: metodo,
    external_reference: lojaId,
    payer,
  };

  // Cartao (credito, debito, pre-pago)
  if (formData.token) {
    corpo.token = formData.token;
    corpo.installments = Number(formData.installments) || 1;
    if (formData.issuer_id) corpo.issuer_id = Number(formData.issuer_id);
  }

  // Boleto registrado (bolbradesco)
  if (metodo === "bolbradesco") {
    const vencimento = new Date();
    vencimento.setDate(vencimento.getDate() + 3);
    corpo.date_of_expiration = vencimento.toISOString();
  }

  // Pix
  if (metodo === "pix" && !payer.identification) {
    // Brick costuma enviar CPF no payer quando o usuario preenche
    const doc = formData.payer?.identification || formData.identification;
    if (doc?.type && doc?.number) {
      payer.identification = {
        type: doc.type,
        number: String(doc.number).replace(/\D/g, ""),
      };
    }
  }

  return corpo;
}

module.exports = {
  METODOS_BRASIL,
  ROTULOS_METODOS,
  configuracaoBrickPagamento,
  montarCorpoPagamento,
};
