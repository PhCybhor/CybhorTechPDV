import { CARGOS, atualizarCargoFuncionario } from "../services/authService.js";
import { escapeHtml } from "../utils/escape.js";
import { notificar } from "./notificacao.js";

const ROTULO_CARGO = {
  [CARGOS.ADMIN]: "Administrador",
  [CARGOS.OPERADOR]: "Operador de caixa",
};

/**
 * Painel de gerenciamento de funcionarios: lista em tempo real e
 * permite alterar o cargo com confirmacao de senha do administrador.
 */
export class PainelFuncionarios {
  /**
   * @param {{
   *   listaEl: HTMLElement,
   *   formAuth: HTMLFormElement,
   *   modalAuth: HTMLElement,
   *   erroEl: HTMLElement,
   *   resumoEl: HTMLElement,
   *   inputUsuario: HTMLInputElement,
   * }} opcoes
   */
  constructor({ listaEl, formAuth, modalAuth, erroEl, resumoEl, inputUsuario }) {
    this.listaEl = listaEl;
    this.formAuth = formAuth;
    this.modalAuth = modalAuth;
    this.erroEl = erroEl;
    this.resumoEl = resumoEl;
    this.inputUsuario = inputUsuario;
    this.funcionarios = [];
    this.alteracaoPendente = null;

    this._registrarEventos();
  }

  _registrarEventos() {
    this.listaEl.addEventListener("click", (evento) => {
      const botao = evento.target.closest("[data-salvar-cargo]");
      if (!botao) return;
      this._iniciarAlteracao(botao.dataset.salvarCargo);
    });

    this.formAuth.addEventListener("submit", (e) => this._confirmarAlteracao(e));
  }

  /**
   * Atualiza a lista exibida.
   * @param {Array<object>} funcionarios
   */
  atualizar(funcionarios) {
    this.funcionarios = funcionarios || [];

    if (this.funcionarios.length === 0) {
      this.listaEl.innerHTML =
        '<p class="ranking-vazio">Nenhum funcionario cadastrado.</p>';
      return;
    }

    this.listaEl.innerHTML = this.funcionarios
      .map((func) => {
        const cargoAtual = func.cargo || CARGOS.OPERADOR;
        return `
        <div class="funcionario-linha" data-id="${escapeHtml(func.id)}">
          <div class="funcionario-info">
            <span class="funcionario-nome">${escapeHtml(func.nome)}</span>
            <span class="funcionario-usuario">@${escapeHtml(func.usuario)}</span>
          </div>
          <select class="funcionario-cargo-select" data-cargo-id="${escapeHtml(func.id)}">
            <option value="${CARGOS.OPERADOR}" ${cargoAtual === CARGOS.OPERADOR ? "selected" : ""}>
              Operador de caixa
            </option>
            <option value="${CARGOS.ADMIN}" ${cargoAtual === CARGOS.ADMIN ? "selected" : ""}>
              Administrador
            </option>
          </select>
          <button
            type="button"
            class="btn btn-secundario btn-sm"
            data-salvar-cargo="${escapeHtml(func.id)}"
          >
            Salvar
          </button>
        </div>`;
      })
      .join("");
  }

  /** @param {string} funcionarioId */
  _iniciarAlteracao(funcionarioId) {
    const funcionario = this.funcionarios.find((f) => f.id === funcionarioId);
    if (!funcionario) return;

    const select = this.listaEl.querySelector(
      `[data-cargo-id="${funcionarioId}"]`
    );
    const novoCargo = select?.value;
    if (!novoCargo || novoCargo === funcionario.cargo) {
      notificar("Selecione um cargo diferente do atual.", "alerta");
      return;
    }

    this.alteracaoPendente = { funcionarioId, novoCargo, funcionario };
    this.formAuth.reset();
    this.erroEl.textContent = "";
    this.erroEl.classList.add("oculto");
    this.resumoEl.textContent = `Alterar "${funcionario.nome}" de ${ROTULO_CARGO[funcionario.cargo]} para ${ROTULO_CARGO[novoCargo]}.`;
    this.modalAuth.classList.remove("oculto");
    this.inputUsuario.focus();
  }

  async _confirmarAlteracao(evento) {
    evento.preventDefault();
    this.erroEl.textContent = "";
    this.erroEl.classList.add("oculto");

    if (!this.alteracaoPendente) return;

    const { funcionarioId, novoCargo } = this.alteracaoPendente;
    const adminUsuario =
      this.formAuth.querySelector("#auth-admin-usuario")?.value || "";
    const adminSenha =
      this.formAuth.querySelector("#auth-admin-senha")?.value || "";

    try {
      await atualizarCargoFuncionario({
        funcionarioId,
        cargo: novoCargo,
        adminUsuario,
        adminSenha,
      });
      this.fecharModalAuth();
      notificar("Cargo atualizado com sucesso.", "sucesso");
    } catch (erro) {
      this.erroEl.textContent = erro.message;
      this.erroEl.classList.remove("oculto");
    }
  }

  fecharModalAuth() {
    this.alteracaoPendente = null;
    this.modalAuth.classList.add("oculto");
    this.formAuth.reset();
    this.erroEl.textContent = "";
    this.erroEl.classList.add("oculto");
  }
}
