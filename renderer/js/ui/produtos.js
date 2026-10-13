import { formatarMoeda } from "../utils/formato.js";
import { escapeHtml } from "../utils/escape.js";
import { pareceCodigoBarras } from "../utils/codigoBarras.js";

/**
 * @param {object} produto
 * @param {string} codigo
 * @returns {boolean}
 */
function temCodigoExato(produto, codigo) {
  return (
    (produto.codigoBarras || "").trim() === codigo ||
    (produto.codigoInterno || "").trim() === codigo
  );
}

/**
 * Lista de gestão de produtos (editar / estoque rápido / excluir).
 */
export class PainelProdutos {
  /**
   * @param {{
   *   container: HTMLElement,
   *   inputFiltro: HTMLInputElement,
   *   onEditar: (produto: object) => void,
   *   onExcluir: (produto: object) => void,
   *   onAjustarEstoque: (produto: object, delta: number) => void,
   *   onCadastrarComCodigo?: ((codigo: string) => void) | null
   * }} opcoes
   */
  constructor({
    container,
    inputFiltro,
    onEditar,
    onExcluir,
    onAjustarEstoque,
    onCadastrarComCodigo = null,
    estoqueMinimo = 5,
    permitirExcluir = true,
    permitirEditar = true,
    permitirAjustarEstoque = true,
  }) {
    this.container = container;
    this.inputFiltro = inputFiltro;
    this.onEditar = onEditar;
    this.onExcluir = onExcluir;
    this.onAjustarEstoque = onAjustarEstoque;
    this.onCadastrarComCodigo = onCadastrarComCodigo;
    this.estoqueMinimo = estoqueMinimo;
    this.permitirExcluir = permitirExcluir;
    this.permitirEditar = permitirEditar;
    this.permitirAjustarEstoque = permitirAjustarEstoque;
    this.produtos = [];
    this._assinatura = "";
    this._idDestacado = "";

    this._aoClique = (evento) => this._tratarClique(evento);
    this._aoFiltro = () => {
      this._idDestacado = "";
      this.renderizar(true);
    };

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
    const filtroOriginal = (this.inputFiltro.value || "").trim();
    const filtro = filtroOriginal.toLowerCase();
    // Código lido pelo leitor deve achar só aquele produto, não todos que contêm os dígitos.
    const exatos = filtroOriginal
      ? this.produtos.filter((p) => temCodigoExato(p, filtroOriginal))
      : [];
    const lista = (exatos.length > 0 ? exatos : [...this.produtos])
      .filter((p) => {
        if (!filtro || exatos.length > 0) return true;
        const texto = `${p.nome} ${p.categoria || ""} ${p.codigoBarras || ""} ${p.codigoInterno || ""}`.toLowerCase();
        return texto.includes(filtro);
      })
      .sort((a, b) => a.nome.localeCompare(b.nome));

    const assinatura =
      filtro +
      "|" +
      this._idDestacado +
      "|" +
      lista.map((p) => `${p.id}:${p.estoque}:${p.preco}:${p.custo ?? ""}:${p.nome}`).join("|");

    if (!forcar && assinatura === this._assinatura) return;
    this._assinatura = assinatura;

    if (lista.length === 0) {
      const oferecerCadastro =
        this.onCadastrarComCodigo && pareceCodigoBarras(filtroOriginal);
      this.container.innerHTML = oferecerCadastro
        ? `
        <div class="estado-vazio">
          <p>Nenhum produto com o código ${escapeHtml(filtroOriginal)}</p>
          <button type="button" class="btn btn-primario" data-acao="cadastrar-codigo" data-codigo="${escapeHtml(filtroOriginal)}">
            Cadastrar produto com este código
          </button>
        </div>`
        : `
        <div class="estado-vazio">
          <p>Nenhum produto encontrado</p>
          <span>Ajuste o filtro ou cadastre um novo item</span>
        </div>`;
      return;
    }

    this.container.innerHTML = lista
      .map((produto) => {
        const estoque = Number(produto.estoque) || 0;
        const baixo = estoque <= this.estoqueMinimo;
        return `
        <div class="gestao-linha${produto.id === this._idDestacado ? " gestao-linha--destaque" : ""}" data-id="${escapeHtml(produto.id)}">
          <div class="gestao-info">
            <div class="gestao-nome" title="${escapeHtml(produto.nome)}">${escapeHtml(produto.nome)}</div>
            <div class="gestao-meta">
              ${escapeHtml(produto.categoria || "Sem categoria")}
              ${produto.codigoBarras ? ` · ${escapeHtml(produto.codigoBarras)}` : ""}
            </div>
          </div>
          <span class="gestao-preco">${formatarMoeda(produto.preco)}${
            (() => {
              const custo = produto.custo;
              if (custo === null || custo === undefined || custo === "") return "";
              const c = Number(custo);
              const p = Number(produto.preco);
              if (!Number.isFinite(c) || !Number.isFinite(p) || p <= 0) return "";
              const m = (((p - c) / p) * 100).toFixed(0);
              return `<small class="gestao-margem"> · ${m}%</small>`;
            })()
          }</span>
          <span class="gestao-estoque ${baixo ? "baixo" : ""}">Est. ${estoque}</span>
          <div class="gestao-acoes">
            ${
              this.permitirAjustarEstoque
                ? `<button type="button" class="btn btn-secundario btn-sm" data-acao="estoque-menos" data-id="${escapeHtml(produto.id)}" title="Remover 1 do estoque">−1</button>
            <button type="button" class="btn btn-secundario btn-sm" data-acao="estoque-mais" data-id="${escapeHtml(produto.id)}" title="Adicionar 1 ao estoque">+1</button>`
                : ""
            }
            ${
              this.permitirEditar
                ? `<button type="button" class="btn btn-secundario btn-sm" data-acao="editar" data-id="${escapeHtml(produto.id)}">Editar</button>`
                : ""
            }
            ${
              this.permitirExcluir
                ? `<button type="button" class="btn btn-texto btn-sm" data-acao="excluir" data-id="${escapeHtml(produto.id)}">Excluir</button>`
                : ""
            }
          </div>
        </div>`;
      })
      .join("");
  }

  /**
   * Filtra a lista pelo código lido e destaca o produto encontrado.
   * @param {string} codigo
   * @returns {object | null} produto encontrado
   */
  localizarPorCodigo(codigo) {
    this.inputFiltro.value = codigo;
    const produto = this.produtos.find((p) => temCodigoExato(p, codigo)) || null;
    this._idDestacado = produto?.id || "";
    this.renderizar(true);
    if (produto) {
      this.container
        .querySelector(".gestao-linha--destaque")
        ?.scrollIntoView({ block: "nearest" });
    }
    return produto;
  }

  _tratarClique(evento) {
    const cadastrar = evento.target.closest("[data-acao='cadastrar-codigo']");
    if (cadastrar) {
      this.onCadastrarComCodigo?.(cadastrar.dataset.codigo || "");
      return;
    }

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
