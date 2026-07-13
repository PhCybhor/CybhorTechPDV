"use strict";

/**
 * Gera o HTML do cupom termico (80mm) para impressoras Jetway ESC/POS.
 * @param {object} dados
 * @param {object} loja
 * @returns {string}
 */
function escapar(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {number} valor
 * @returns {string}
 */
function moeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/**
 * @param {string} forma
 * @returns {string}
 */
function rotuloPagamento(forma) {
  const mapa = {
    dinheiro: "Dinheiro",
    pix: "PIX",
    debito: "Cartao de debito",
    credito: "Cartao de credito",
  };
  return mapa[forma] || String(forma || "-");
}

/**
 * Monta o HTML do comprovante de venda para bobina de 80mm.
 * @param {{
 *   id: string,
 *   itens: Array<{nome: string, quantidade: number, precoUnitario: number, subtotal: number}>,
 *   subtotal: number,
 *   desconto: number,
 *   total: number,
 *   formaPagamento: string,
 *   funcionarioNome: string,
 *   criadoEm: number,
 *   valorRecebido?: number,
 *   troco?: number
 * }} dados
 * @param {{
 *   nome?: string,
 *   cnpj?: string,
 *   endereco?: string,
 *   telefone?: string
 * }} loja
 * @returns {string}
 */
function gerarHtmlCupom(dados, loja = {}) {
  const dataHora = new Date(dados.criadoEm || Date.now()).toLocaleString("pt-BR");
  const nomeLoja = escapar(loja.nome || "CybhorPDV");
  const linhasItens = (dados.itens || [])
    .map((item) => {
      const qtd = Number(item.quantidade) || 0;
      const unit = moeda(item.precoUnitario);
      const sub = moeda(item.subtotal ?? qtd * item.precoUnitario);
      return `
        <tr>
          <td colspan="3" class="item-nome">${escapar(item.nome)}</td>
        </tr>
        <tr>
          <td>${qtd} x ${unit}</td>
          <td></td>
          <td class="dir">${sub}</td>
        </tr>`;
    })
    .join("");

  const blocoTroco =
    dados.formaPagamento === "dinheiro" && Number(dados.valorRecebido) > 0
      ? `
        <div class="linha"><span>Recebido</span><span>${moeda(dados.valorRecebido)}</span></div>
        <div class="linha"><span>Troco</span><span>${moeda(dados.troco || 0)}</span></div>`
      : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 72mm;
      margin: 0 auto;
      padding: 2mm 1.5mm 8mm;
      font-family: "Courier New", Courier, monospace;
      font-size: 11px;
      color: #000;
      background: #fff;
      line-height: 1.25;
    }
    .centro { text-align: center; }
    .dir { text-align: right; }
    .titulo {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 2px;
    }
    .sep {
      border: none;
      border-top: 1px dashed #000;
      margin: 6px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    td {
      vertical-align: top;
      padding: 1px 0;
    }
    .item-nome { font-weight: bold; padding-top: 4px; }
    .linha {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin: 2px 0;
    }
    .total {
      font-size: 13px;
      font-weight: bold;
      margin-top: 4px;
    }
    .rodape {
      margin-top: 8px;
      font-size: 10px;
    }
  </style>
</head>
<body>
  <div class="centro">
    <div class="titulo">${nomeLoja}</div>
    ${loja.cnpj ? `<div>CNPJ: ${escapar(loja.cnpj)}</div>` : ""}
    ${loja.endereco ? `<div>${escapar(loja.endereco)}</div>` : ""}
    ${loja.telefone ? `<div>Tel: ${escapar(loja.telefone)}</div>` : ""}
  </div>
  <hr class="sep" />
  <div class="centro"><strong>COMPROVANTE DE VENDA</strong></div>
  <div class="centro">Documento auxiliar (nao fiscal)</div>
  <hr class="sep" />
  <div>Venda: ${escapar(String(dados.id || "").slice(-8).toUpperCase())}</div>
  <div>Data: ${escapar(dataHora)}</div>
  <div>Operador: ${escapar(dados.funcionarioNome || "-")}</div>
  <hr class="sep" />
  <table>
    <tbody>${linhasItens}</tbody>
  </table>
  <hr class="sep" />
  <div class="linha"><span>Subtotal</span><span>${moeda(dados.subtotal)}</span></div>
  ${
    Number(dados.desconto) > 0
      ? `<div class="linha"><span>Desconto</span><span>- ${moeda(dados.desconto)}</span></div>`
      : ""
  }
  <div class="linha total"><span>TOTAL</span><span>${moeda(dados.total)}</span></div>
  <div class="linha"><span>Pagamento</span><span>${escapar(rotuloPagamento(dados.formaPagamento))}</span></div>
  ${blocoTroco}
  <hr class="sep" />
  <div class="centro rodape">
    Obrigado pela preferencia!<br />
    CybhorPDV
  </div>
</body>
</html>`;
}

module.exports = { gerarHtmlCupom };
