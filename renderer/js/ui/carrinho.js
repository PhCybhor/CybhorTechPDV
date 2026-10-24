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
   * @param {HTMLElement} [opcoes.elementoQtdItens]
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
    elementoQtdItens = null,
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
    this.elementoQtdItens = elementoQtdItens;
    /** @type {Map<string, object>} */
    this.itens = new Map();
    this.desconto = 0;
    this.descontoDesligado = false;
    this.valorRecebido = 0;
    /** Pagamento dividido (ex.: parte dinheiro + PIX). */
    this.dividirPagamento = false;
    this.valorParteDinheiro = 0;
    this.formaRestante = "pix";
    this._destruido = false;
    /** Quando true, o botão Finalizar permanece desabilitado (venda em curso). */
    this.bloqueadoFinalizar = false;
    this._aoCliqueItens = (evento) => this._tratarCliqueItens(evento);
    this._aoDesconto = () => {
      if (this.descontoDesligado) {
        this.desconto = 0;
        if (this.inputDesconto) this.inputDesconto.value = "";
        this._atualizarTotais();
        return;
      }
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
   * @param {number} [quantidade=1]
   * @returns {boolean}
   */
  adicionar(produto, quantidade = 1) {
    const porPeso = String(produto.unidade || "un").toLowerCase() === "kg";
    const qtdPedida = porPeso
      ? Math.max(0.001, Number(quantidade) || 0.001)
      : Math.max(1, Math.floor(Number(quantidade) || 1));
    const existente = this.itens.get(produto.id);
    const estoque = Number(produto.estoque) || 0;
    const qtdAtual = existente ? existente.quantidade : 0;

    if (qtdAtual + qtdPedida > estoque + 0.0001) return false;

    if (existente) {
      existente.quantidade = porPeso
        ? Number((existente.quantidade + qtdPedida).toFixed(3))
        : existente.quantidade + qtdPedida;
      existente.estoqueAtual = estoque;
      existente.precoUnitario = Number(produto.preco) || existente.precoUnitario;
    } else {
      if (estoque < (porPeso ? 0.001 : 1)) return false;
      const custoRaw = produto.custo;
      const custoUnitario =
        custoRaw === null || custoRaw === undefined || custoRaw === ""
          ? null
          : Number(custoRaw);
      this.itens.set(produto.id, {
        produtoId: produto.id,
        nome: produto.nome,
        precoUnitario: Number(produto.preco) || 0,
        estoqueAtual: estoque,
        quantidade: porPeso ? Number(qtdPedida.toFixed(3)) : qtdPedida,
        unidade: porPeso ? "kg" : "un",
        custoUnitario:
          custoUnitario !== null && Number.isFinite(custoUnitario)
            ? custoUnitario
            : null,
      });
    }
    this.renderizar();
    return true;
  }

  /**
   * Último item do carrinho (ordem de inserção Map).
   * @returns {object | null}
   */
  obterUltimoItem() {
    const itens = this.obterItens();
    return itens.length ? itens[itens.length - 1] : null;
  }

  /**
   * @param {string} produtoId
   * @param {number} delta
   */
  alterarQuantidade(produtoId, delta) {
    const item = this.itens.get(produtoId);
    if (!item) return;

    const passo = item.unidade === "kg" ? 0.1 * Math.sign(delta || 1) : delta;
    const novaQuantidade =
      item.unidade === "kg"
        ? Number((item.quantidade + passo).toFixed(3))
        : item.quantidade + delta;
    if (novaQuantidade <= 0) {
      this.itens.delete(produtoId);
    } else if (novaQuantidade > item.estoqueAtual + 0.0001) {
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
    this.dividirPagamento = false;
    this.valorParteDinheiro = 0;
    this.formaRestante = "pix";
    this.inputDesconto.value = "";
    if (this.inputRecebido) this.inputRecebido.value = "";
    this.renderizar();
  }

  /**
   * @param {boolean} desligado
   */
  definirDescontoDesligado(desligado) {
    this.descontoDesligado = Boolean(desligado);
    if (this.descontoDesligado) {
      this.desconto = 0;
      if (this.inputDesconto) this.inputDesconto.value = "";
    }
    this._atualizarTotais();
  }

  /** @param {boolean} ativo */
  definirDividir(ativo) {
    this.dividirPagamento = Boolean(ativo);
    this._atualizarTotais();
  }

  /**
   * @param {number} valor
   */
  definirParteDinheiro(valor) {
    this.valorParteDinheiro = Math.max(0, Number(valor) || 0);
    this._atualizarTotais();
  }

  /**
   * @param {string} forma
   */
  definirFormaRestante(forma) {
    this.formaRestante = forma || "pix";
    this._atualizarTotais();
  }

  /**
   * @returns {Array<{ tipo: string, valor: number }> | null}
   */
  obterFormasPagamento() {
    if (!this.dividirPagamento) return null;
    const total = this.obterTotal();
    const dinheiro = Math.min(this.valorParteDinheiro, total);
    const resto = Math.round((total - dinheiro) * 100) / 100;
    if (dinheiro <= 0 || resto <= 0) return null;
    return [
      { tipo: "dinheiro", valor: dinheiro },
      { tipo: this.formaRestante || "pix", valor: resto },
    ];
  }

  /** @returns {Array<object>} */
  obterItens() {
    return Array.from(this.itens.values());
  }

  /**
   * Restaura itens capturados antes de logout por sessão expirada.
   * Não revalida estoque — o operador já tinha esses itens no caixa.
   * @param {Array<object>} itens
   */
  restaurarDeSnapshot(itens) {
    this.itens.clear();
    for (const bruto of itens || []) {
      if (!bruto || !bruto.produtoId) continue;
      const porPeso = String(bruto.unidade || "un").toLowerCase() === "kg";
      const qtd = porPeso
        ? Math.max(0.001, Number(bruto.quantidade) || 0.001)
        : Math.max(1, Math.floor(Number(bruto.quantidade) || 1));
      const custoRaw = bruto.custoUnitario;
      const custoUnitario =
        custoRaw === null || custoRaw === undefined || custoRaw === ""
          ? null
          : Number(custoRaw);
      this.itens.set(bruto.produtoId, {
        produtoId: bruto.produtoId,
        nome: String(bruto.nome || ""),
        precoUnitario: Number(bruto.precoUnitario) || 0,
        estoqueAtual: Math.max(
          Number(bruto.estoqueAtual) || 0,
          porPeso ? qtd : qtd
        ),
        quantidade: porPeso ? Number(qtd.toFixed(3)) : qtd,
        unidade: porPeso ? "kg" : "un",
        custoUnitario:
          custoUnitario !== null && Number.isFinite(custoUnitario)
            ? custoUnitario
            : null,
      });
    }
    this.renderizar();
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
    if (this.descontoDesligado) return 0;
    const subtotal = this.obterSubtotal();
    return Math.min(Math.max(0, this.desconto), subtotal);
  }

  /** @returns {number} */
  obterTotal() {
    return this.obterSubtotal() - this.obterDesconto();
  }

  /** @returns {number} */
  obterValorRecebido() {
    return Number(this.valorRecebido) || 0;
  }

  /** @returns {number} */
  obterTroco() {
    if (this.dividirPagamento) {
      const parte = Math.min(this.valorParteDinheiro, this.obterTotal());
      return Math.max(0, this.valorRecebido - parte);
    }
    if (this.selectPagamento?.value !== "dinheiro") return 0;
    return Math.max(0, this.valorRecebido - this.obterTotal());
  }

  /** @returns {boolean} */
  pagamentoDinheiroOk() {
    if (this.obterTotal() <= 0) return true;
    if (this.dividirPagamento) {
      const formas = this.obterFormasPagamento();
      if (!formas) return false;
      const parteDinheiro = formas.find((f) => f.tipo === "dinheiro")?.valor || 0;
      return this.valorRecebido + 0.001 >= parteDinheiro;
    }
    if (this.selectPagamento?.value !== "dinheiro") return true;
    return this.valorRecebido + 0.001 >= this.obterTotal();
  }

  /**
   * @param {object} item
   * @returns {string}
   */
  _rotuloQuantidade(item) {
    if (item.unidade === "kg") {
      const q = Number(item.quantidade) || 0;
      const texto = q % 1 === 0 ? String(q) : q.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
      return `${texto} kg`;
    }
    return String(item.quantidade);
  }

  renderizar() {
    const itens = this.obterItens();
    const qtdLinhas = itens.length;
    const qtdUnidades = itens.reduce((soma, item) => {
      if (item.unidade === "kg") return soma + 1;
      return soma + (Number(item.quantidade) || 0);
    }, 0);

    if (this.elementoQtdItens) {
      if (qtdLinhas === 0) {
        this.elementoQtdItens.textContent = "0 itens";
      } else if (qtdUnidades === 1) {
        this.elementoQtdItens.textContent = "1 item";
      } else {
        this.elementoQtdItens.textContent = `${qtdUnidades} itens`;
      }
    }

    if (itens.length === 0) {
      this.containerItens.innerHTML = `
        <div class="estado-vazio">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/>
            <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.5L21 8H7"/>
          </svg>
          <p>Sem itens</p>
          <span>Bipe ou digite e Enter</span>
        </div>`;
    } else {
      this.containerItens.innerHTML = itens
        .map((item) => {
          const qtdLabel = this._rotuloQuantidade(item);
          const unitario = formatarMoeda(item.precoUnitario);
          return `
        <div class="item">
          <span class="item-nome" title="${escapeHtml(item.nome)}">${escapeHtml(item.nome)}</span>
          <span class="item-subtotal">${formatarMoeda(
            item.precoUnitario * item.quantidade
          )}</span>
          <span class="item-detalhe">${escapeHtml(qtdLabel)} × ${unitario}</span>
          <div class="item-controles">
            <button type="button" class="item-qtd-btn" data-acao="diminuir" data-id="${escapeHtml(item.produtoId)}" aria-label="Diminuir">−</button>
            <span class="item-qtd" title="Quantidade">${escapeHtml(qtdLabel)}</span>
            <button type="button" class="item-qtd-btn" data-acao="aumentar" data-id="${escapeHtml(item.produtoId)}" aria-label="Aumentar">+</button>
            <button type="button" class="item-remover" data-acao="remover" data-id="${escapeHtml(item.produtoId)}">Remover</button>
          </div>
        </div>`;
        })
        .join("");
    }

    this._atualizarTotais();
  }

  _atualizarTotais() {
    const total = this.obterTotal();
    this.elementoSubtotal.textContent = formatarMoeda(this.obterSubtotal());
    this.elementoTotal.textContent = formatarMoeda(total);

    const ehDinheiro =
      this.dividirPagamento || this.selectPagamento?.value === "dinheiro";
    this.blocoTroco?.classList.toggle("oculto", !ehDinheiro);

    // Dinheiro é o padrão: sem valor recebido o botão ficava cinza e parecia
    // "quebrado". Preenche o valor exato automaticamente (operador ainda pode mudar).
    if (
      ehDinheiro &&
      !this.dividirPagamento &&
      total > 0 &&
      this.valorRecebido <= 0 &&
      document.activeElement !== this.inputRecebido
    ) {
      const exato = Number(total.toFixed(2));
      this.valorRecebido = exato;
      if (this.inputRecebido) this.inputRecebido.value = String(exato);
    }

    if (this.elementoTroco) {
      this.elementoTroco.textContent = formatarMoeda(this.obterTroco());
    }

    const temItens = this.itens.size > 0;
    // Só bloqueia sem itens ou durante a finalização — a validação de troco
    // acontece no clique (com aviso), para o botão nunca parecer "morto".
    this.botaoFinalizar.disabled = this.bloqueadoFinalizar || !temItens;
    if (this.botaoFinalizar) {
      this.botaoFinalizar.title =
        temItens && !this.pagamentoDinheiroOk()
          ? "Informe o valor recebido em dinheiro (atalho Exato) ou troque a forma de pagamento"
          : "Finalizar venda (F12)";
    }

    document.getElementById("bloco-dividir-pagamento")?.classList.toggle(
      "oculto",
      !this.dividirPagamento
    );
    const restoEl = document.getElementById("dividir-resto-valor");
    if (restoEl && this.dividirPagamento) {
      const dinheiro = Math.min(this.valorParteDinheiro, total);
      const resto = Math.max(0, Math.round((total - dinheiro) * 100) / 100);
      restoEl.textContent = formatarMoeda(resto);
    }
  }
}
