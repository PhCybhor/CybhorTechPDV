import { formatarMoeda } from "../utils/formato.js";
import { escapeHtml } from "../utils/escape.js";

/**
 * Lista de gestao de produtos (editar / estoque rapido / excluir).
 */
export class PainelProdutos {
  /**
   * @param {{
   *   container: HTMLElement,
   *   inputFiltro: HTMLInputElement,
   *   onEditar: (produto: object) => void,
   *   onExcluir: (produto: object) => void,
   *   onAjustarEstoque: (produto: object, delta: number) => void
   * }} opcoes
   */
  constructor({ container, inputFiltro, onEditar, onExcluir, onAjustarEstoque }) {
    this.container = container;
    this.inputFiltro = inputFiltro;
    this.onEditar = onEditar;
    this.onExcluir = onExcluir;
    this.onAjustarEstoque = onAjustarEstoque;
    this.produtos = [];
    this._assinatura = "";

    this._aoClique = (evento) => this._tratarClique(evento);
    this._aoFiltro = () => this.renderizar(true);

    this.container.addEventListener("click", this._aoClique);
    this.inputFiltro.addEventListener("input", this._aoFiltro);
  }

  destruir() {
    this.container.removeEventListener("click", this._aoClique);
    this.inputFiltro.removeEventListener("input", this._aoFiltro);
  }

  /**
   * @param {Array<object>} produtos
   */
  atualizar(produtos) {
    this.produtos = Array.isArray(produtos) ? produtos : [];
    this.renderizar();
  }

  /**
   * @param {boolean} [forcar=false]
   */
  renderizar(forcar = false) {
    const filtro = (this.inputFiltro.value || "").trim().toLowerCase();
    const lista = [...this.produtos]
      .filter((p) => {
        if (!filtro) return true;
        const texto = `${p.nome} ${p.categoria || ""} ${p.codigoBarras || ""}`.toLowerCase();
        return texto.includes(filtro);
      })
      .sort((a, b) => a.nome.localeCompare(b.nome));

    const assinatura =
      filtro +
      "|" +
      lista.map((p) => `${p.id}:${p.estoque}:${p.preco}:${p.nome}`).join("|");

    if (!forcar && assinatura === this._assinatura) return;
    this._assinatura = assinatura;

    if (lista.length === 0) {
      this.container.innerHTML =
        '<p class="ranking-vazio">Nenhum produto encontrado.</p>';
      return;
    }

    this.container.innerHTML = lista
      .map((produto) => {
        const estoque = Number(produto.estoque) || 0;
        const baixo = estoque <= 5;
        return `
        <div class="gestao-linha" data-id="${escapeHtml(produto.id)}">
          <div class="gestao-info">
            <div class="gestao-nome" title="${escapeHtml(produto.nome)}">${escapeHtml(produto.nome)}</div>
            <div class="gestao-meta">
              ${escapeHtml(produto.categoria || "Sem categoria")}
              ${produto.codigoBarras ? ` · ${escapeHtml(produto.codigoBarras)}` : ""}
            </div>
          </div>
          <span class="gestao-preco">${formatarMoeda(produto.preco)}</span>
          <span class="gestao-estoque ${baixo ? "baixo" : ""}">Est. ${estoque}</span>
          <div class="gestao-acoes">
            <button type="button" class="btn btn-secundario btn-sm" data-acao="estoque-menos" data-id="${escapeHtml(produto.id)}" title="Remover 1 do estoque">−1</button>
            <button type="button" class="btn btn-secundario btn-sm" data-acao="estoque-mais" data-id="${escapeHtml(produto.id)}" title="Adicionar 1 ao estoque">+1</button>
            <button type="button" class="btn btn-secundario btn-sm" data-acao="editar" data-id="${escapeHtml(produto.id)}">Editar</button>
            <button type="button" class="btn btn-texto btn-sm" data-acao="excluir" data-id="${escapeHtml(produto.id)}">Excluir</button>
          </div>
        </div>`;
      })
      .join("");
  }

  _tratarClique(evento) {
    const botao = evento.target.closest("[data-acao][data-id]");
    if (!botao) return;
    const produto = this.produtos.find((p) => p.id === botao.dataset.id);
    if (!produto) return;

    const acao = botao.dataset.acao;
    if (acao === "editar") this.onEditar(produto);
    if (acao === "excluir") this.onExcluir(produto);
    if (acao === "estoque-mais") this.onAjustarEstoque(produto, 1);
    if (acao === "estoque-menos") this.onAjustarEstoque(produto, -1);
  }
}
