import {
  CARGOS,
  atualizarCargoFuncionario,
  alterarSenhaFuncionario,
  atualizarAreasFuncionario,
} from "../services/authService.js";
import {
  AREAS_EQUIPE,
  GUIAS_POR_AREA,
  formatarAreas,
  htmlCheckboxesAreas,
  lerAreasDoForm,
  normalizarAreas,
  rotuloArea,
} from "../services/areasEquipe.js";
import { escapeHtml } from "../utils/escape.js";
import { notificar } from "./notificacao.js";

const ROTULO_CARGO = {
  [CARGOS.ADMIN]: "Administrador",
  [CARGOS.OPERADOR]: "Operador de caixa",
};

/**
 * Painel de gerenciamento de funcionários + áreas multi + guias RH/Marketing/Caixa.
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
   *   formSenha?: HTMLFormElement,
   *   modalSenha?: HTMLElement,
   *   erroSenha?: HTMLElement,
   *   resumoSenha?: HTMLElement,
   *   guiasEl?: HTMLElement | null,
   * }} opcoes
   */
  constructor({
    listaEl,
    formAuth,
    modalAuth,
    erroEl,
    resumoEl,
    inputUsuario,
    formSenha = null,
    modalSenha = null,
    erroSenha = null,
    resumoSenha = null,
    guiasEl = null,
  }) {
    this.listaEl = listaEl;
    this.formAuth = formAuth;
    this.modalAuth = modalAuth;
    this.erroEl = erroEl;
    this.resumoEl = resumoEl;
    this.inputUsuario = inputUsuario;
    this.formSenha = formSenha;
    this.modalSenha = modalSenha;
    this.erroSenha = erroSenha;
    this.resumoSenha = resumoSenha;
    this.guiasEl = guiasEl;
    this.funcionarios = [];
    this.alteracaoPendente = null;
    this.senhaPendenteId = null;
    this.filtroArea = "";

    this._registrarEventos();
    this._renderGuias();
  }

  _registrarEventos() {
    this.listaEl.addEventListener("click", (evento) => {
      const botaoCargo = evento.target.closest("[data-salvar-cargo]");
      if (botaoCargo) {
        this._iniciarAlteracao(botaoCargo.dataset.salvarCargo);
        return;
      }
      const botaoSenha = evento.target.closest("[data-alterar-senha]");
      if (botaoSenha) {
        this._iniciarSenha(botaoSenha.dataset.alterarSenha);
        return;
      }
      const botaoAreas = evento.target.closest("[data-salvar-areas]");
      if (botaoAreas) {
        this._salvarAreas(botaoAreas.dataset.salvarAreas);
        return;
      }
      const filtro = evento.target.closest("[data-filtro-area]");
      if (filtro) {
        this.filtroArea = filtro.dataset.filtroArea || "";
        this.atualizar(this.funcionarios);
      }
    });

    this.listaEl.addEventListener("change", (evento) => {
      const check = evento.target.closest(
        'input[type="checkbox"][name^="areas-func-"]'
      );
      if (!check) return;
      const wrap = check.closest(".areas-edit");
      wrap?.querySelectorAll(".area-chip").forEach((chip) => {
        const input = chip.querySelector("input");
        chip.classList.toggle("ativo", Boolean(input?.checked));
      });
    });

    this.formAuth.addEventListener("submit", (e) => this._confirmarAlteracao(e));
    this.formSenha?.addEventListener("submit", (e) => this._confirmarSenha(e));

    this.guiasEl?.addEventListener("click", (evento) => {
      const botao = evento.target.closest("[data-prompt-area]");
      if (!botao) return;
      const area = botao.dataset.promptArea;
      const prompt = botao.dataset.promptTexto || "";
      window.dispatchEvent(
        new CustomEvent("cybhor-abrir-assistente-area", {
          detail: { area, prompt },
        })
      );
    });
  }

  _renderGuias() {
    if (!this.guiasEl) return;
    this.guiasEl.innerHTML = AREAS_EQUIPE.map((area) => {
      const guia = GUIAS_POR_AREA[area.id];
      if (!guia) return "";
      return `
        <article class="guia-area" data-area="${area.id}">
          <header class="guia-area-cabecalho">
            <h4>${escapeHtml(guia.titulo)}</h4>
            <p>${escapeHtml(guia.resumo)}</p>
          </header>
          <div class="guia-area-colunas">
            <div>
              <strong>Checklist</strong>
              <ul>${guia.checklist
                .map((i) => `<li>${escapeHtml(i)}</li>`)
                .join("")}</ul>
            </div>
            <div>
              <strong>Dicas rápidas</strong>
              <ul>${guia.dicas.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
            </div>
          </div>
          <div class="guia-area-acoes">
            ${(guia.promptsIa || [])
              .map(
                (p) =>
                  `<button type="button" class="btn btn-secundario btn-sm" data-prompt-area="${escapeHtml(
                    area.id
                  )}" data-prompt-texto="${escapeHtml(p)}">Perguntar à IA</button>`
              )
              .join("")}
          </div>
        </article>`;
    }).join("");
  }

  /**
   * @param {Array<object>} funcionarios
   */
  atualizar(funcionarios) {
    this.funcionarios = funcionarios || [];

    const filtroBar = `
      <div class="filtro-areas-equipe">
        <span>Filtrar por área:</span>
        <button type="button" class="filtro-chip ${
          !this.filtroArea ? "ativo" : ""
        }" data-filtro-area="">Todas</button>
        ${AREAS_EQUIPE.map(
          (a) =>
            `<button type="button" class="filtro-chip ${
              this.filtroArea === a.id ? "ativo" : ""
            }" data-filtro-area="${a.id}">${escapeHtml(a.rotulo)}</button>`
        ).join("")}
      </div>`;

    const lista = this.funcionarios.filter((f) => {
      if (!this.filtroArea) return true;
      return normalizarAreas(f.areas).includes(this.filtroArea);
    });

    if (this.funcionarios.length === 0) {
      this.listaEl.innerHTML = `
        <div class="estado-vazio">
          <p>Nenhum funcionário cadastrado</p>
          <span>Use o botão Novo funcionário para começar</span>
        </div>`;
      return;
    }

    if (lista.length === 0) {
      this.listaEl.innerHTML =
        filtroBar +
        `<div class="estado-vazio"><p>Ninguém nesta área</p><span>Ajuste o filtro ou cadastre alguém com essa atuação</span></div>`;
      return;
    }

    this.listaEl.innerHTML =
      filtroBar +
      lista
        .map((func) => {
          const cargoAtual = func.cargo || CARGOS.OPERADOR;
          const areas = normalizarAreas(func.areas);
          const iniciais = String(func.nome || "?")
            .trim()
            .split(/\s+/)
            .filter(Boolean);
          const avatar =
            iniciais.length >= 2
              ? (iniciais[0][0] + iniciais[iniciais.length - 1][0]).toUpperCase()
              : (iniciais[0] || "?").slice(0, 2).toUpperCase();
          const badgesAreas =
            areas.length > 0
              ? areas
                  .map(
                    (a) =>
                      `<span class="badge-area badge-area--${escapeHtml(
                        a
                      )}">${escapeHtml(rotuloArea(a))}</span>`
                  )
                  .join("")
              : `<span class="badge-area badge-area--vazio">Sem área</span>`;

          return `
        <div class="funcionario-linha funcionario-linha--areas" data-id="${escapeHtml(
          func.id
        )}">
          <span class="funcionario-avatar" aria-hidden="true">${escapeHtml(
            avatar
          )}</span>
          <div class="funcionario-info">
            <span class="funcionario-nome">${escapeHtml(func.nome)}</span>
            <span class="funcionario-usuario">@${escapeHtml(func.usuario)}${
              func.tipoVinculo
                ? ` · <span class="badge-vinculo">${escapeHtml(
                    String(func.tipoVinculo).toUpperCase()
                  )}</span>`
                : ""
            }</span>
            <div class="funcionario-areas-badges">${badgesAreas}</div>
          </div>
          <select class="funcionario-cargo-select" data-cargo-id="${escapeHtml(
            func.id
          )}">
            <option value="${CARGOS.OPERADOR}" ${
              cargoAtual === CARGOS.OPERADOR ? "selected" : ""
            }>
              Operador de caixa
            </option>
            <option value="${CARGOS.ADMIN}" ${
              cargoAtual === CARGOS.ADMIN ? "selected" : ""
            }>
              Administrador
            </option>
          </select>
          <div class="areas-edit" data-areas-wrap="${escapeHtml(func.id)}">
            <span class="areas-edit-titulo">Áreas (multi)</span>
            ${htmlCheckboxesAreas(`areas-func-${func.id}`, areas)}
          </div>
          <div class="funcionario-acoes">
            <button type="button" class="btn btn-secundario btn-sm" data-salvar-areas="${escapeHtml(
              func.id
            )}">
              Salvar áreas
            </button>
            <button type="button" class="btn btn-secundario btn-sm" data-salvar-cargo="${escapeHtml(
              func.id
            )}">
              Salvar cargo
            </button>
            <button type="button" class="btn btn-texto btn-sm" data-alterar-senha="${escapeHtml(
              func.id
            )}">
              Senha
            </button>
          </div>
        </div>`;
        })
        .join("");
  }

  async _salvarAreas(funcionarioId) {
    const wrap = this.listaEl.querySelector(
      `[data-areas-wrap="${funcionarioId}"]`
    );
    if (!wrap) return;
    const areas = lerAreasDoForm(wrap, `areas-func-${funcionarioId}`);
    try {
      await atualizarAreasFuncionario(funcionarioId, areas);
      notificar(`Áreas atualizadas: ${formatarAreas(areas)}`, "sucesso");
    } catch (erro) {
      notificar(erro.message || "Falha ao salvar áreas.", "erro");
    }
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

  /** @param {string} funcionarioId */
  _iniciarSenha(funcionarioId) {
    if (!this.modalSenha || !this.formSenha) return;
    const funcionario = this.funcionarios.find((f) => f.id === funcionarioId);
    if (!funcionario) return;
    this.senhaPendenteId = funcionarioId;
    this.formSenha.reset();
    if (this.erroSenha) {
      this.erroSenha.textContent = "";
      this.erroSenha.classList.add("oculto");
    }
    if (this.resumoSenha) {
      this.resumoSenha.textContent = `Nova senha para "${funcionario.nome}" (@${funcionario.usuario}).`;
    }
    this.modalSenha.classList.remove("oculto");
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

  async _confirmarSenha(evento) {
    evento.preventDefault();
    if (!this.senhaPendenteId || !this.formSenha) return;
    if (this.erroSenha) {
      this.erroSenha.textContent = "";
      this.erroSenha.classList.add("oculto");
    }

    try {
      await alterarSenhaFuncionario({
        funcionarioId: this.senhaPendenteId,
        novaSenha: this.formSenha.querySelector("#senha-nova")?.value || "",
        adminUsuario:
          this.formSenha.querySelector("#senha-admin-usuario")?.value || "",
        adminSenha:
          this.formSenha.querySelector("#senha-admin-senha")?.value || "",
      });
      this.fecharModalSenha();
      notificar("Senha atualizada.", "sucesso");
    } catch (erro) {
      if (this.erroSenha) {
        this.erroSenha.textContent = erro.message;
        this.erroSenha.classList.remove("oculto");
      }
    }
  }

  fecharModalAuth() {
    this.alteracaoPendente = null;
    this.modalAuth.classList.add("oculto");
    this.formAuth.reset();
    this.erroEl.textContent = "";
    this.erroEl.classList.add("oculto");
  }

  fecharModalSenha() {
    this.senhaPendenteId = null;
    this.modalSenha?.classList.add("oculto");
    this.formSenha?.reset();
    if (this.erroSenha) {
      this.erroSenha.textContent = "";
      this.erroSenha.classList.add("oculto");
    }
  }
}
