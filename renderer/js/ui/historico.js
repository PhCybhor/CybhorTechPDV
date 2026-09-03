import { cancelarVenda } from "../services/vendaService.js";
import { formatarMoeda } from "../utils/formato.js";
import { escapeHtml } from "../utils/escape.js";
import { notificar } from "./notificacao.js";

const ROTULO_PAGAMENTO = {
  misto: "Dividido",
  fiado: "Fiado",
  dinheiro: "Dinheiro",
  pix: "PIX",
  debito: "Débito",
  credito: "Crédito",
};

/**
 * Histórico de vendas com reimpressão e cancelamento.
 */
export class PainelHistorico {
  /**
   * @param {{
   *   listaEl: HTMLElement,
   *   inputFiltro: HTMLInputElement,
   *   selectPeriodo: HTMLSelectElement,
   *   ehAdmin: boolean,
   *   podeCancelar?: boolean,
   *   funcionarioNome: string,
   *   onReimprimir: (venda: object) => void,
   *   formCancelar: HTMLFormElement,
   *   modalCancelar: HTMLElement,
   *   erroCancelar: HTMLElement,
   *   resumoCancelar: HTMLElement
   * }} opcoes
   */
  constructor({
    listaEl,
    inputFiltro,
    selectPeriodo,
    ehAdmin,
    podeCancelar = ehAdmin,
    funcionarioNome,
    onReimprimir,
    formCancelar,
    modalCancelar,
    erroCancelar,
    resumoCancelar,
  }) {
    this.listaEl = listaEl;
    this.inputFiltro = inputFiltro;
    this.selectPeriodo = selectPeriodo;
    this.ehAdmin = ehAdmin;
    this.podeCancelar = podeCancelar;
    this.funcionarioNome = funcionarioNome;
    this.onReimprimir = onReimprimir;
    this.formCancelar = formCancelar;
    this.modalCancelar = modalCancelar;
    this.erroCancelar = erroCancelar;
    this.resumoCancelar = resumoCancelar;
    this.vendas = [];
    this.vendaCancelarId = null;

    this.inputFiltro.addEventListener("input", () => this.renderizar());
    this.selectPeriodo.addEventListener("change", () => this.renderizar());
    this.listaEl.addEventListener("click", (e) => this._tratarClique(e));
    this.formCancelar.addEventListener("submit", (e) => this._confirmarCancelamento(e));
  }

  /**
   * @param {Array<object>} vendas
   */
  atualizar(vendas) {
    this.vendas = Array.isArray(vendas) ? vendas : [];
    this.renderizar();
  }

  renderizar() {
    const filtro = (this.inputFiltro.value || "").trim().toLowerCase();
    const dias = Number(this.selectPeriodo.value) || 7;
    const limite = Date.now() - dias * 24 * 60 * 60 * 1000;

    const lista = [...this.vendas]
      .filter((v) => Number(v.criadoEm) >= limite)
      .filter((v) => {
        if (!filtro) return true;
        const texto = [
          v.id,
          v.funcionarioNome,
          v.formaPagamento,
          ...(v.itens || []).map((i) => i.nome),
        ]
          .join(" ")
          .toLowerCase();
        return texto.includes(filtro);
      })
      .sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));

    if (lista.length === 0) {
      this.listaEl.innerHTML = `
        <div class="estado-vazio">
          <p>Nenhuma venda neste período</p>
          <span>Ajuste o filtro ou o período</span>
        </div>`;
      return;
    }

    this.listaEl.innerHTML = lista
      .map((venda) => {
        const data = new Date(venda.criadoEm).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        const qtdItens = (venda.itens || []).reduce(
          (s, i) => s + (Number(i.quantidade) || 0),
          0
        );
        const pagamento =
          ROTULO_PAGAMENTO[venda.formaPagamento] || venda.formaPagamento || "-";
        const cancelada = Boolean(venda.cancelada);

        return `
        <div class="historico-linha${cancelada ? " historico-linha--cancelada" : ""}" data-id="${escapeHtml(venda.id)}">
          <div class="historico-info">
            <div class="historico-topo">
              <strong>${escapeHtml(data)}</strong>
              ${cancelada ? '<span class="badge-cancelada">Cancelada</span>' : ""}
            </div>
            <div class="historico-meta">
              ${escapeHtml(venda.funcionarioNome || "-")} · ${escapeHtml(pagamento)} · ${qtdItens} un
            </div>
          </div>
          <strong class="historico-total">${formatarMoeda(venda.total || 0)}</strong>
          <div class="historico-acoes">
            <button type="button" class="btn btn-secundario btn-sm" data-acao="reimprimir" data-id="${escapeHtml(venda.id)}" ${cancelada ? "disabled" : ""}>
              Cupom
            </button>
            ${
              this.podeCancelar && !cancelada
                ? `<button type="button" class="btn btn-texto btn-sm" data-acao="cancelar" data-id="${escapeHtml(venda.id)}">Cancelar</button>`
                : ""
            }
          </div>
        </div>`;
      })
      .join("");
  }

  /** @param {MouseEvent} evento */
  _tratarClique(evento) {
    const botao = evento.target.closest("[data-acao][data-id]");
    if (!botao || botao.disabled) return;
    const venda = this.vendas.find((v) => v.id === botao.dataset.id);
    if (!venda) return;

    if (botao.dataset.acao === "reimprimir") {
      this.onReimprimir(venda);
      return;
    }

    if (botao.dataset.acao === "cancelar") {
      if (!this.podeCancelar) return;
      this.vendaCancelarId = venda.id;
      this.formCancelar.reset();
      this.erroCancelar.textContent = "";
      this.erroCancelar.classList.add("oculto");
      this.resumoCancelar.textContent = `Cancelar venda de ${formatarMoeda(venda.total)} (${venda.funcionarioNome || "-"}). O estoque será devolvido.`;
      this.modalCancelar.classList.remove("oculto");
    }
  }

  /** @param {Event} evento */
  async _confirmarCancelamento(evento) {
    evento.preventDefault();
    if (!this.vendaCancelarId || !this.podeCancelar) return;

    this.erroCancelar.textContent = "";
    this.erroCancelar.classList.add("oculto");

    try {
      await cancelarVenda({
        vendaId: this.vendaCancelarId,
        adminUsuario: this.formCancelar.querySelector("#cancelar-admin-usuario").value,
        adminSenha: this.formCancelar.querySelector("#cancelar-admin-senha").value,
        motivo: this.formCancelar.querySelector("#cancelar-motivo").value,
        canceladoPorNome: this.funcionarioNome,
      });
      this.fecharModalCancelar();
      notificar("Venda cancelada e estoque devolvido.", "sucesso");
    } catch (erro) {
      this.erroCancelar.textContent = erro.message;
      this.erroCancelar.classList.remove("oculto");
    }
  }

  fecharModalCancelar() {
    this.vendaCancelarId = null;
    this.modalCancelar.classList.add("oculto");
    this.formCancelar.reset();
    this.erroCancelar.textContent = "";
    this.erroCancelar.classList.add("oculto");
  }
}
