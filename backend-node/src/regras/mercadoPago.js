import { ehObjetoSimples, somenteDigitos } from "./entrada.js";

export const ROTULOS_METODOS = {
  creditCard: "Cartao de credito",
  debitCard: "Cartao de debito",
  prepaidCard: "Cartao pre-pago",
  ticket: "Boleto bancario",
  bankTransfer: "Pix",
  mercadoPago: "Saldo Mercado Pago",
};

const METODOS_BRASIL = {
  creditCard: "all",
  debitCard: "all",
  prepaidCard: "all",
  ticket: ["bolbradesco"],
  bankTransfer: ["pix"],
  mercadoPago: ["wallet_purchase"],
  maxInstallments: 1,
};

const DIAS_VENCIMENTO_BOLETO = 3;

/** Configuração do Payment Brick com a paleta do site. */
export function configuracaoBrickPagamento() {
  return {
    visual: {
      style: {
        theme: "default",
        customVariables: {
          baseColor: "#171717",
          borderRadiusSmall: "4px",
          borderRadiusMedium: "6px",
          borderRadiusLarge: "8px",
        },
      },
      texts: {
        paymentMethods: {
          creditCardTitle: "Cartao de credito",
          debitCardTitle: "Cartao de debito",
          ticketTitle: "Boleto bancario",
          bankTransferTitle: "Pix",
        },
      },
    },
    paymentMethods: structuredClone(METODOS_BRASIL),
  };
}

function lerIdentificacao(origem) {
  const identificacao = ehObjetoSimples(origem) ? origem : {};
  if (!identificacao.type || !identificacao.number) return null;
  return { type: identificacao.type, number: somenteDigitos(String(identificacao.number)) };
}

/**
 * Monta o corpo de POST /v1/payments a partir do formData do Brick.
 * @throws {Error} sem forma de pagamento (o serviço converte em ErroNegocio).
 */
export function montarCorpoPagamento({ lojaId, valor, nomeLoja, email, primeiroNome, sobrenome, dadosFormulario }) {
  const metodo = dadosFormulario.payment_method_id;
  if (!metodo) throw new Error("Forma de pagamento nao informada.");

  const pagadorRecebido = ehObjetoSimples(dadosFormulario.payer) ? dadosFormulario.payer : {};
  const pagador = {
    email: pagadorRecebido.email || email,
    first_name: primeiroNome,
    last_name: sobrenome,
  };
  const identificacao = lerIdentificacao(pagadorRecebido.identification);
  if (identificacao) pagador.identification = identificacao;

  const corpo = {
    transaction_amount: valor,
    description: `CybhorPDV — assinatura mensal (${nomeLoja})`,
    payment_method_id: metodo,
    external_reference: lojaId,
    payer: pagador,
  };

  if (dadosFormulario.token) {
    corpo.token = dadosFormulario.token;
    corpo.installments = Number.parseInt(dadosFormulario.installments, 10) || 1;
    if (dadosFormulario.issuer_id) corpo.issuer_id = Number.parseInt(dadosFormulario.issuer_id, 10);
  }

  if (metodo === "bolbradesco") {
    const vencimento = new Date(Date.now() + DIAS_VENCIMENTO_BOLETO * 86_400_000);
    corpo.date_of_expiration = vencimento.toISOString();
  }

  if (metodo === "pix" && !pagador.identification) {
    const documento = lerIdentificacao(dadosFormulario.identification);
    if (documento) pagador.identification = documento;
  }

  return corpo;
}
