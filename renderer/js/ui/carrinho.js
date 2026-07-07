import { formatarMoeda } from "../utils/formato.js";
import { escapeHtml } from "../utils/escape.js";

/**
 * Gerencia o estado e a renderizacao do carrinho da venda atual.
 * Mantem os itens em memoria e atualiza a interface a cada alteracao.
 */
export class Carrinho {
  /**
   * @param {object} opcoes
   * @param {HTMLElement} opcoes.containerItens
   * @param {HTMLElement} opcoes.elementoSubtotal
   * @param {HTMLInputElement} opcoes.inputDesconto
   * @param {HTMLElement} opcoes.elementoTotal
   * @param {HTMLButtonElement} opcoes.botaoFinalizar
   */
  constructor({
    containerItens,
    elementoSubtotal,
    inputDesconto,
    elementoTotal,
    botaoFinalizar,
  }) {
    this.containerItens = containerItens;
    this.elementoSubtotal = elementoSubtotal;
    this.inputDesconto = inputDesconto;
    this.elementoTotal = elementoTotal;
    this.botaoFinalizar = botaoFinalizar;
    /** @type {Map<string, object>} */
    this.itens = new Map();
    this.desconto = 0;
    this._registrarEventos();
  }

  _registrarEventos() {
    this.containerItens.addEventListener("click", (evento) => {
      const alvo = evento.target.closest("[data-acao]");
      if (!alvo) return;

      const { acao, id } = alvo.dataset;
      if (acao === "aumentar") this.alterarQuantidade(id, 1);
      if (acao === "diminuir") this.alterarQuantidade(id, -1);
      if (acao === "remover") this.remover(id);
    });

    this.inputDesconto.addEventListener("input", () => {
      this.desconto = Number(this.inputDesconto.value) || 0;
      this._atualizarTotais();
    });
  }

  /**
   * Adiciona um produto ao carrinho, respeitando o estoque disponivel.
   * @param {object} produto
   */
  adicionar(produto) {
    const existente = this.itens.get(produto.id);
    const estoque = Number(produto.estoque) || 0;

    if (existente) {
      if (existente.quantidade + 1 > estoque) return false;
      existente.quantidade += 1;
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
   * Altera a quantidade de um item; remove quando chega a zero.
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

  /**
   * Remove um item do carrinho.
   * @param {string} produtoId
   */
  remover(produtoId) {
    this.itens.delete(produtoId);
    this.renderizar();
  }

  /** Esvazia o carrinho e zera o desconto. */
  limpar() {
    this.itens.clear();
    this.desconto = 0;
    this.inputDesconto.value = "0";
    this.renderizar();
  }

  /** @returns {Array<object>} itens do carrinho. */
  obterItens() {
    return Array.from(this.itens.values());
  }

  /** @returns {number} soma dos itens, sem desconto. */
  obterSubtotal() {
    return this.obterItens().reduce(
      (soma, item) => soma + item.precoUnitario * item.quantidade,
      0
    );
  }

  /**
   * Desconto efetivo aplicado, limitado ao intervalo [0, subtotal].
   * @returns {number}
   */
  obterDesconto() {
    const subtotal = this.obterSubtotal();
    return Math.min(Math.max(0, this.desconto), subtotal);
  }

  /** @returns {number} total da venda ja com o desconto aplicado. */
  obterTotal() {
    return this.obterSubtotal() - this.obterDesconto();
  }

  /** Atualiza a interface do carrinho. */
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
          <span class="item-nome">${escapeHtml(item.nome)}</span>
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
    this.botaoFinalizar.disabled = itens.length === 0;
  }

  /** Recalcula e exibe subtotal, desconto e total. */
  _atualizarTotais() {
    this.elementoSubtotal.textContent = formatarMoeda(this.obterSubtotal());
    this.elementoTotal.textContent = formatarMoeda(this.obterTotal());
  }
}
