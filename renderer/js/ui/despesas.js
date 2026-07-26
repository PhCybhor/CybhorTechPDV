import { formatarMoeda } from "../utils/formato.js";
import { escapeHtml } from "../utils/escape.js";
import { notificar } from "./notificacao.js";
import {
  TIPOS_DESPESA,
  criarDespesa,
  atualizarDespesa,
  excluirDespesa,
  competenciaDe,
  rotuloTipoDespesa,
} from "../services/despesaService.js";

/**
 * Painel de despesas fixas/variáveis (aluguel, luz, etc.) por competência.
 */
export class PainelDespesas {
  /**
   * @param {{
   *   listaEl: HTMLElement,
   *   formEl: HTMLFormElement,
   *   selectCompetencia: HTMLSelectElement,
   *   onMudou?: () => void
   * }} opcoes
   */
  constructor({ listaEl, formEl, selectCompetencia, onMudou = () => {} }) {
    this.listaEl = listaEl;
    this.formEl = formEl;
    this.selectCompetencia = selectCompetencia;
    this.onMudou = onMudou;
    this.despesas = [];
    this.editandoId = null;

    this._aoSubmit = (e) => this._salvar(e);
    this._aoClique = (e) => this._tratarClique(e);
    this._aoCompetencia = () => this.renderizar();

    this.formEl.addEventListener("submit", this._aoSubmit);
    this.listaEl.addEventListener("click", this._aoClique);
    this.selectCompetencia.addEventListener("change", this._aoCompetencia);

    this._popularTipos();
    this._popularCompetencias();
  }

  destruir() {
    this.formEl.removeEventListener("submit", this._aoSubmit);
    this.listaEl.removeEventListener("click", this._aoClique);
    this.selectCompetencia.removeEventListener("change", this._aoCompetencia);
  }

  _popularTipos() {
    const select = this.formEl.querySelector("#despesa-tipo");
    if (!select) return;
    select.innerHTML = TIPOS_DESPESA.map(
      (t) => `<option value="${t.id}">${escapeHtml(t.rotulo)}</option>`
    ).join("");
  }

  _popularCompetencias() {
    const agora = new Date();
    const opcoes = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      const valor = competenciaDe(d);
      const rotulo = d.toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric",
      });
      opcoes.push(`<option value="${valor}">${escapeHtml(rotulo)}</option>`);
    }
    this.selectCompetencia.innerHTML = opcoes.join("");
    const inputComp = this.formEl.querySelector("#despesa-competencia");
    if (inputComp) {
      inputComp.innerHTML = opcoes.join("");
      inputComp.value = competenciaDe(agora);
    }
  }

  /**
   * @param {Array<object>} despesas
   */
  atualizar(despesas) {
    this.despesas = Array.isArray(despesas) ? despesas : [];
    this.renderizar();
  }

  competenciaAtual() {
    return this.selectCompetencia.value || competenciaDe(new Date());
  }

  renderizar() {
    const comp = this.competenciaAtual();
    const lista = this.despesas
      .filter((d) => d.competencia === comp)
      .sort((a, b) => (Number(b.valor) || 0) - (Number(a.valor) || 0));

    if (lista.length === 0) {
      this.listaEl.innerHTML = `
        <div class="estado-vazio">
          <p>Nenhuma despesa neste mês</p>
          <span>Cadastre aluguel, luz, água e outros custos fixos para ver o lucro líquido</span>
        </div>`;
      return;
    }

    const total = lista.reduce((s, d) => s + (Number(d.valor) || 0), 0);
    this.listaEl.innerHTML =
      `<div class="despesa-total-linha">Total do mês: <strong>${formatarMoeda(total)}</strong></div>` +
      lista
        .map(
          (d) => `
        <div class="despesa-linha" data-id="${escapeHtml(d.id)}">
          <div class="despesa-info">
            <strong>${escapeHtml(rotuloTipoDespesa(d.tipo))}</strong>
            <span>${escapeHtml(d.descricao || "—")}${d.recorrente ? " · recorrente" : ""}</span>
          </div>
          <span class="despesa-valor">${formatarMoeda(d.valor)}</span>
          <div class="despesa-acoes">
            <button type="button" class="btn btn-secundario btn-sm" data-acao="editar" data-id="${escapeHtml(d.id)}">Editar</button>
            <button type="button" class="btn btn-texto btn-sm" data-acao="excluir" data-id="${escapeHtml(d.id)}">Excluir</button>
          </div>
        </div>`
        )
        .join("");
  }

  _tratarClique(evento) {
    const botao = evento.target.closest("[data-acao][data-id]");
    if (!botao) return;
    const despesa = this.despesas.find((d) => d.id === botao.dataset.id);
    if (!despesa) return;

    if (botao.dataset.acao === "editar") {
      this.editandoId = despesa.id;
      this.formEl.querySelector("#despesa-tipo").value = despesa.tipo || "outro";
      this.formEl.querySelector("#despesa-descricao").value = despesa.descricao || "";
      this.formEl.querySelector("#despesa-valor").value = String(despesa.valor ?? "");
      this.formEl.querySelector("#despesa-competencia").value =
        despesa.competencia || this.competenciaAtual();
      this.formEl.querySelector("#despesa-recorrente").checked = Boolean(
        despesa.recorrente
      );
      this.formEl.querySelector("#btn-salvar-despesa").textContent = "Atualizar despesa";
      return;
    }

    if (botao.dataset.acao === "excluir") {
      this._excluir(despesa);
    }
  }

  async _excluir(despesa) {
    try {
      await excluirDespesa(despesa.id);
      notificar("Despesa removida.", "sucesso");
      this.onMudou();
    } catch (erro) {
      notificar(erro.message || "Falha ao excluir.", "erro");
    }
  }

  limparFormulario() {
    this.editandoId = null;
    this.formEl.reset();
    this.formEl.querySelector("#despesa-competencia").value =
      this.competenciaAtual();
    this.formEl.querySelector("#despesa-tipo").value = "aluguel";
    this.formEl.querySelector("#btn-salvar-despesa").textContent =
      "Adicionar despesa";
  }

  async _salvar(evento) {
    evento.preventDefault();
    const payload = {
      tipo: this.formEl.querySelector("#despesa-tipo").value,
      descricao: this.formEl.querySelector("#despesa-descricao").value,
      valor: this.formEl.querySelector("#despesa-valor").value,
      competencia: this.formEl.querySelector("#despesa-competencia").value,
      recorrente: this.formEl.querySelector("#despesa-recorrente").checked,
    };

    try {
      if (this.editandoId) {
        await atualizarDespesa(this.editandoId, payload);
        notificar("Despesa atualizada.", "sucesso");
      } else {
        await criarDespesa(payload);
        notificar("Despesa cadastrada.", "sucesso");
      }
      this.limparFormulario();
      this.onMudou();
    } catch (erro) {
      notificar(erro.message || "Falha ao salvar despesa.", "erro");
    }
  }
}
