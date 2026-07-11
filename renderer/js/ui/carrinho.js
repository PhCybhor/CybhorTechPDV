import { formatarMoeda } from "../utils/formato.js";
import { escapeHtml } from "../utils/escape.js";

/**
 * Gerencia o estado e a renderizacao do carrinho da venda atual.
 * Inclui desconto e calculo de troco para pagamento em dinheiro.
 */
export class Carrinho {
  /**
   * @param {object} opcoes
   * @param {HTMLElement} opcoes.containerItens
   * @param {HTMLElement} opcoes.elementoSubtotal
   * @param {HTMLInputElement} opcoes.inputDesconto
   * @param {HTMLElement} opcoes.elementoTotal
   * @param {HTMLButtonElement} opcoes.botaoFinalizar
   * @param {HTMLSelectElement} [opcoes.selectPagamento]
   * @param {HTMLElement} [opcoes.blocoTroco]
   * @param {HTMLInputElement} [opcoes.inputRecebido]
   * @param {HTMLElement} [opcoes.elementoTroco]
   */
  constructor({
    containerItens,
    elementoSubtotal,
    inputDesconto,
    elementoTotal,
    botaoFinalizar,
    selectPagamento = null,
    blocoTroco = null,
    inputRecebido = null,
    elementoTroco = null,
  }) {
    this.containerItens = containerItens;
    this.elementoSubtotal = elementoSubtotal;
    this.inputDesconto = inputDesconto;
    this.elementoTotal = elementoTotal;
    this.botaoFinalizar = botaoFinalizar;
    this.selectPagamento = selectPagamento;
    this.blocoTroco = blocoTroco;
    this.inputRecebido = inputRecebido;
    this.elementoTroco = elementoTroco;
    /** @type {Map<string, object>} */
    this.itens = new Map();
    this.desconto = 0;
    this.valorRecebido = 0;
    this._destruido = false;
    this._aoCliqueItens = (evento) => this._tratarCliqueItens(evento);
    this._aoDesconto = () => {
      this.desconto = Number(this.inputDesconto.value) || 0;
      this._atualizarTotais();
    };
    this._aoRecebido = () => {
      this.valorRecebido = Number(this.inputRecebido?.value) || 0;
      this._atualizarTotais();
    };
    this._aoPagamento = () => this._atualizarTotais();
    this._registrarEventos();
  }

  _registrarEventos() {
    this.containerItens.addEventListener("click", this._aoCliqueItens);
    this.inputDesconto.addEventListener("input", this._aoDesconto);
    this.inputRecebido?.addEventListener("input", this._aoRecebido);
    this.selectPagamento?.addEventListener("change", this._aoPagamento);
  }

  /** Remove listeners para evitar duplicacao em re-login. */
  destruir() {
    if (this._destruido) return;
    this._destruido = true;
    this.containerItens.removeEventListener("click", this._aoCliqueItens);
    this.inputDesconto.removeEventListener("input", this._aoDesconto);
    this.inputRecebido?.removeEventListener("input", this._aoRecebido);
    this.selectPagamento?.removeEventListener("change", this._aoPagamento);
    this.itens.clear();
  }

  _tratarCliqueItens(evento) {
    const alvo = evento.target.closest("[data-acao]");
    if (!alvo) return;
    const { acao, id } = alvo.dataset;
    if (acao === "aumentar") this.alterarQuantidade(id, 1);
    if (acao === "diminuir") this.alterarQuantidade(id, -1);
    if (acao === "remover") this.remover(id);
  }

  /**
   * @param {object} produto
   * @returns {boolean}
   */
  adicionar(produto) {
    const existente = this.itens.get(produto.id);
    const estoque = Number(produto.estoque) || 0;

    if (existente) {
      if (existente.quantidade + 1 > estoque) return false;
      existente.quantidade += 1;
      existente.estoqueAtual = estoque;
    } else {
      if (estoque < 1) return false;
      this.itens.set(produto.id, {
        produtoId: produto.id,
        nome: produto.nome,
        precoUnitario: Number(produto.preco) || 0,
        estoqueAtual: estoque,
        quantidade: 1,
      });
    }
    this.renderizar();
    return true;
  }

  /**
   * @param {string} produtoId
   * @param {number} delta
   */
  alterarQuantidade(produtoId, delta) {
    const item = this.itens.get(produtoId);
    if (!item) return;

    const novaQuantidade = item.quantidade + delta;
    if (novaQuantidade <= 0) {
      this.itens.delete(produtoId);
    } else if (novaQuantidade > item.estoqueAtual) {
      return;
    } else {
      item.quantidade = novaQuantidade;
    }
    this.renderizar();
  }

  /** @param {string} produtoId */
  remover(produtoId) {
    this.itens.delete(produtoId);
    this.renderizar();
  }

  limpar() {
    this.itens.clear();
    this.desconto = 0;
    this.valorRecebido = 0;
    this.inputDesconto.value = "0";
    if (this.inputRecebido) this.inputRecebido.value = "0";
    this.renderizar();
  }

  /** @returns {Array<object>} */
  obterItens() {
    return Array.from(this.itens.values());
  }

  /** @returns {number} */
  obterSubtotal() {
    return this.obterItens().reduce(
      (soma, item) => soma + item.precoUnitario * item.quantidade,
      0
    );
  }

  /** @returns {number} */
  obterDesconto() {
    const subtotal = this.obterSubtotal();
    return Math.min(Math.max(0, this.desconto), subtotal);
  }

  /** @returns {number} */
  obterTotal() {
    return this.obterSubtotal() - this.obterDesconto();
  }

  /** @returns {number} */
  obterTroco() {
    if (this.selectPagamento?.value !== "dinheiro") return 0;
    return Math.max(0, this.valorRecebido - this.obterTotal());
  }

  /** @returns {boolean} */
  pagamentoDinheiroOk() {
    if (this.selectPagamento?.value !== "dinheiro") return true;
    if (this.obterTotal() <= 0) return true;
    return this.valorRecebido + 0.001 >= this.obterTotal();
  }

  renderizar() {
    const itens = this.obterItens();

    if (itens.length === 0) {
      this.containerItens.innerHTML =
        '<p class="carrinho-vazio">Nenhum item adicionado.</p>';
    } else {
      this.containerItens.innerHTML = itens
        .map(
          (item) => `
        <div class="item">
          <span class="item-nome" title="${escapeHtml(item.nome)}">${escapeHtml(item.nome)}</span>
          <span class="item-subtotal">${formatarMoeda(
            item.precoUnitario * item.quantidade
          )}</span>
          <div class="item-controles">
            <button class="item-qtd-btn" data-acao="diminuir" data-id="${escapeHtml(item.produtoId)}" aria-label="Diminuir">-</button>
            <span class="item-qtd">${item.quantidade}</span>
            <button class="item-qtd-btn" data-acao="aumentar" data-id="${escapeHtml(item.produtoId)}" aria-label="Aumentar">+</button>
            <button class="item-remover" data-acao="remover" data-id="${escapeHtml(item.produtoId)}">Remover</button>
          </div>
        </div>`
        )
        .join("");
    }

    this._atualizarTotais();
  }

  _atualizarTotais() {
    const total = this.obterTotal();
    this.elementoSubtotal.textContent = formatarMoeda(this.obterSubtotal());
    this.elementoTotal.textContent = formatarMoeda(total);

    const ehDinheiro = this.selectPagamento?.value === "dinheiro";
    this.blocoTroco?.classList.toggle("oculto", !ehDinheiro);

    if (this.elementoTroco) {
      this.elementoTroco.textContent = formatarMoeda(this.obterTroco());
    }

    const temItens = this.itens.size > 0;
    this.botaoFinalizar.disabled = !temItens || !this.pagamentoDinheiroOk();
  }
}
