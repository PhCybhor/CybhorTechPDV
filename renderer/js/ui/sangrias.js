import { formatarMoeda } from "../utils/formato.js";
import { escapeHtml } from "../utils/escape.js";
import { notificar } from "./notificacao.js";
import {
  criarSangria,
  excluirSangria,
  filtrarSangriasDoDia,
  filtrarSangriasDaCompetencia,
  competenciaDe,
  somarSangriasDoDia,
  somarSangriasCompetencia,
} from "../services/sangriaService.js";

/**
 * Registro de sangrias (retirada de dinheiro do caixa).
 */
export class PainelSangrias {
  /**
   * @param {{
   *   listaEl: HTMLElement,
   *   formEl: HTMLFormElement,
   *   selectPeriodo?: HTMLSelectElement | null,
   *   resumoEl?: HTMLElement | null,
   *   obterFuncionario?: () => object | null,
   *   onMudou?: () => void
   * }} opcoes
   */
  constructor({
    listaEl,
    formEl,
    selectPeriodo = null,
    resumoEl = null,
    obterFuncionario = () => null,
    onMudou = () => {},
  }) {
    this.listaEl = listaEl;
    this.formEl = formEl;
    this.selectPeriodo = selectPeriodo;
    this.resumoEl = resumoEl;
    this.obterFuncionario = obterFuncionario;
    this.onMudou = onMudou;
    this.sangrias = [];

    this._aoSubmit = (e) => this._salvar(e);
    this._aoClique = (e) => this._tratarClique(e);
    this._aoPeriodo = () => this.renderizar();

    this.formEl.addEventListener("submit", this._aoSubmit);
    this.listaEl.addEventListener("click", this._aoClique);
    this.selectPeriodo?.addEventListener("change", this._aoPeriodo);
    this.formEl
      .querySelector("#btn-limpar-sangria")
      ?.addEventListener("click", () => this.limparFormulario());

    this._popularPeriodos();
  }

  destruir() {
    this.formEl.removeEventListener("submit", this._aoSubmit);
    this.listaEl.removeEventListener("click", this._aoClique);
    this.selectPeriodo?.removeEventListener("change", this._aoPeriodo);
  }

  _popularPeriodos() {
    if (!this.selectPeriodo) return;
    const agora = new Date();
    const opcoes = [
      `<option value="hoje">Hoje</option>`,
      `<option value="mes">Mês atual</option>`,
    ];
    for (let i = 1; i < 6; i++) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      const valor = `comp:${competenciaDe(d)}`;
      const rotulo = d.toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric",
      });
      opcoes.push(`<option value="${valor}">${escapeHtml(rotulo)}</option>`);
    }
    this.selectPeriodo.innerHTML = opcoes.join("");
    this.selectPeriodo.value = "hoje";
  }

  /**
   * @param {Array<object>} lista
   */
  atualizar(lista) {
    this.sangrias = Array.isArray(lista) ? lista : [];
    this.renderizar();
  }

  limparFormulario() {
    this.formEl.reset();
  }

  _listaFiltrada() {
    const periodo = this.selectPeriodo?.value || "hoje";
    if (periodo === "hoje") {
      return filtrarSangriasDoDia(this.sangrias);
    }
    if (periodo === "mes") {
      return filtrarSangriasDaCompetencia(this.sangrias);
    }
    if (periodo.startsWith("comp:")) {
      return filtrarSangriasDaCompetencia(
        this.sangrias,
        periodo.slice(5)
      );
    }
    return filtrarSangriasDoDia(this.sangrias);
  }

  renderizar() {
    const lista = this._listaFiltrada().sort(
      (a, b) => (Number(b.criadoEm) || 0) - (Number(a.criadoEm) || 0)
    );
    const periodo = this.selectPeriodo?.value || "hoje";
    const total =
      periodo === "hoje"
        ? somarSangriasDoDia(this.sangrias)
        : periodo === "mes"
          ? somarSangriasCompetencia(this.sangrias)
          : periodo.startsWith("comp:")
            ? somarSangriasCompetencia(this.sangrias, periodo.slice(5))
            : somarSangriasDoDia(this.sangrias);

    if (this.resumoEl) {
      this.resumoEl.innerHTML = `
        <div class="resumo-dia-item">
          <span class="resumo-dia-rotulo">Total que saiu da gaveta</span>
          <span class="resumo-dia-valor resumo-dia-valor--alerta">${formatarMoeda(total)}</span>
        </div>
        <div class="resumo-dia-item">
          <span class="resumo-dia-rotulo">Quantas vezes</span>
          <span class="resumo-dia-valor">${lista.length}</span>
        </div>`;
    }

    if (lista.length === 0) {
      this.listaEl.innerHTML = `
        <div class="estado-vazio">
          <p>Nenhuma retirada neste período</p>
          <span>Anote quando tirar dinheiro da gaveta (pagar alguém, reforçar troco em outro lugar…)</span>
        </div>`;
      return;
    }

    this.listaEl.innerHTML =
      `<div class="despesa-total-linha">Total: <strong>${formatarMoeda(total)}</strong></div>` +
      lista
        .map((s) => {
          const quando = s.criadoEm
            ? new Date(s.criadoEm).toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })
            : "—";
          return `
        <div class="despesa-linha sangria-linha" data-id="${escapeHtml(s.id)}">
          <div class="despesa-info">
            <strong>${escapeHtml(s.motivo || "Retirada")}</strong>
            <span>${escapeHtml(quando)} · ${escapeHtml(
              s.funcionarioNome || "—"
            )}</span>
          </div>
          <span class="despesa-valor">${formatarMoeda(s.valor)}</span>
          <div class="despesa-acoes">
            <button type="button" class="btn btn-texto btn-sm" data-acao="excluir" data-id="${escapeHtml(
              s.id
            )}">Excluir</button>
          </div>
        </div>`;
        })
        .join("");
  }

  _tratarClique(evento) {
    const botao = evento.target.closest("[data-acao][data-id]");
    if (!botao || botao.dataset.acao !== "excluir") return;
    const item = this.sangrias.find((s) => s.id === botao.dataset.id);
    if (!item) return;
    this._excluir(item);
  }

  async _excluir(item) {
    const ok = window.confirm(
      `Excluir a retirada de ${formatarMoeda(item.valor)}?`
    );
    if (!ok) return;
    try {
      await excluirSangria(item.id);
      notificar("Retirada removida.", "sucesso");
      this.onMudou();
    } catch (erro) {
      notificar(erro.message || "Falha ao excluir.", "erro");
    }
  }

  async _salvar(evento) {
    evento.preventDefault();
    const funcionario = this.obterFuncionario();
    if (!funcionario) {
      notificar("Faça login novamente.", "alerta");
      return;
    }

    const payload = {
      valor: this.formEl.querySelector("#sangria-valor")?.value,
      motivo: this.formEl.querySelector("#sangria-motivo")?.value,
      funcionarioId: funcionario.id,
      funcionarioNome: funcionario.nome,
    };

    try {
      await criarSangria(payload);
      notificar("Retirada anotada.", "sucesso");
      this.limparFormulario();
      this.onMudou();
    } catch (erro) {
      notificar(erro.message || "Falha ao anotar a retirada.", "erro");
    }
  }
}
