import { escapeHtml } from "../utils/escape.js";
import { notificar } from "./notificacao.js";
import {
  criarFornecedor,
  atualizarFornecedor,
  excluirFornecedor,
  rotuloTiposMercadoria,
} from "../services/fornecedorService.js";
import {
  urlWhatsApp,
  abrirWhatsApp,
  montarMensagemReposicao,
} from "../services/whatsappUtil.js";
import { obterMetaLoja } from "../services/tenantContext.js";

/**
 * Cadastro e busca de fornecedores por tipos de mercadoria.
 */
export class PainelFornecedores {
  /**
   * @param {{
   *   listaEl: HTMLElement,
   *   formEl: HTMLFormElement,
   *   inputFiltro?: HTMLInputElement | null,
   *   onMudou?: () => void
   * }} opcoes
   */
  constructor({ listaEl, formEl, inputFiltro = null, onMudou = () => {} }) {
    this.listaEl = listaEl;
    this.formEl = formEl;
    this.inputFiltro = inputFiltro;
    this.onMudou = onMudou;
    this.fornecedores = [];
    this.editandoId = null;

    this._aoSubmit = (e) => this._salvar(e);
    this._aoClique = (e) => this._tratarClique(e);
    this._aoFiltro = () => this.renderizar();

    this.formEl.addEventListener("submit", this._aoSubmit);
    this.listaEl.addEventListener("click", this._aoClique);
    this.inputFiltro?.addEventListener("input", this._aoFiltro);
    this.formEl
      .querySelector("#btn-limpar-fornecedor")
      ?.addEventListener("click", () => this.limparFormulario());
  }

  destruir() {
    this.formEl.removeEventListener("submit", this._aoSubmit);
    this.listaEl.removeEventListener("click", this._aoClique);
    this.inputFiltro?.removeEventListener("input", this._aoFiltro);
  }

  /**
   * @param {Array<object>} lista
   */
  atualizar(lista) {
    this.fornecedores = Array.isArray(lista) ? lista : [];
    this.renderizar();
  }

  limparFormulario() {
    this.editandoId = null;
    this.formEl.reset();
    const ativo = this.formEl.querySelector("#forn-ativo");
    if (ativo) ativo.checked = true;
    const btn = this.formEl.querySelector("#btn-salvar-fornecedor");
    if (btn) btn.textContent = "Adicionar fornecedor";
  }

  renderizar() {
    const filtro = (this.inputFiltro?.value || "").trim().toLowerCase();
    const lista = this.fornecedores
      .filter((f) => {
        if (!filtro) return true;
        const tipos = rotuloTiposMercadoria(f);
        const blob = `${f.nome} ${tipos} ${f.telefone || ""} ${
          f.whatsapp || ""
        } ${f.cidade || ""} ${f.email || ""} ${f.observacao || ""}`.toLowerCase();
        return blob.includes(filtro);
      })
      .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));

    if (lista.length === 0) {
      this.listaEl.innerHTML = `
        <div class="estado-vazio">
          <p>${filtro ? "Nenhum fornecedor neste filtro" : "Nenhum fornecedor cadastrado"}</p>
          <span>Cadastre o que cada um vende (Bebidas, Padaria…) para achar fácil na reposição</span>
        </div>`;
      return;
    }

    this.listaEl.innerHTML = lista
      .map((f) => {
        const inativo = f.ativo === false;
        const tipos = rotuloTiposMercadoria(f) || "—";
        const chips = tipos
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .map(
            (t) =>
              `<span class="badge-tipos-mercadoria">${escapeHtml(t)}</span>`
          )
          .join("");
        const contatos = [
          f.whatsapp ? `WhatsApp: ${f.whatsapp}` : null,
          f.telefone ? `Tel: ${f.telefone}` : null,
          f.email || null,
          f.cidade || null,
        ]
          .filter(Boolean)
          .join(" · ");

        return `
        <div class="fornecedor-linha ${inativo ? "inativo" : ""}" data-id="${escapeHtml(
          f.id
        )}">
          <div class="fornecedor-info">
            <div class="fornecedor-topo">
              <strong>${escapeHtml(f.nome)}</strong>
              ${chips || `<span class="badge-tipos-mercadoria">${escapeHtml(tipos)}</span>`}
              ${inativo ? '<span class="badge-vinculo">Inativo</span>' : ""}
            </div>
            <span class="fornecedor-meta">${escapeHtml(contatos || "Sem contato cadastrado")}</span>
            ${
              f.observacao
                ? `<span class="fornecedor-obs">${escapeHtml(f.observacao)}</span>`
                : ""
            }
          </div>
          <div class="fornecedor-acoes">
            ${
              f.whatsapp || f.telefone
                ? `<button type="button" class="btn btn-primario btn-sm" data-acao="whatsapp" data-id="${escapeHtml(
                    f.id
                  )}">WhatsApp</button>`
                : ""
            }
            <button type="button" class="btn btn-secundario btn-sm" data-acao="editar" data-id="${escapeHtml(
              f.id
            )}">Editar</button>
            <button type="button" class="btn btn-texto btn-sm" data-acao="excluir" data-id="${escapeHtml(
              f.id
            )}">Excluir</button>
          </div>
        </div>`;
      })
      .join("");
  }

  _tratarClique(evento) {
    const botao = evento.target.closest("[data-acao][data-id]");
    if (!botao) return;
    const forn = this.fornecedores.find((f) => f.id === botao.dataset.id);
    if (!forn) return;

    if (botao.dataset.acao === "whatsapp") {
      const fone = forn.whatsapp || forn.telefone;
      const msg = montarMensagemReposicao({
        lojaNome: obterMetaLoja()?.nomeLoja || obterMetaLoja()?.lojaNome,
        fornecedorNome: forn.nome,
        itens: [{ nome: `(itens de ${rotuloTiposMercadoria(forn)})` }],
      });
      const url = urlWhatsApp(fone, msg);
      if (!url) {
        notificar("Telefone/WhatsApp inválido.", "alerta");
        return;
      }
      abrirWhatsApp(url);
      return;
    }

    if (botao.dataset.acao === "editar") {
      this.editandoId = forn.id;
      this.formEl.querySelector("#forn-nome").value = forn.nome || "";
      const inputTipos =
        this.formEl.querySelector("#forn-tipos-mercadoria") ||
        this.formEl.querySelector("#forn-nicho");
      if (inputTipos) inputTipos.value = rotuloTiposMercadoria(forn);
      this.formEl.querySelector("#forn-telefone").value = forn.telefone || "";
      this.formEl.querySelector("#forn-whatsapp").value = forn.whatsapp || "";
      this.formEl.querySelector("#forn-email").value = forn.email || "";
      this.formEl.querySelector("#forn-cidade").value = forn.cidade || "";
      this.formEl.querySelector("#forn-observacao").value = forn.observacao || "";
      this.formEl.querySelector("#forn-ativo").checked = forn.ativo !== false;
      this.formEl.querySelector("#btn-salvar-fornecedor").textContent =
        "Atualizar fornecedor";
      this.formEl.querySelector("#forn-nome")?.focus();
      return;
    }

    if (botao.dataset.acao === "excluir") {
      this._excluir(forn);
    }
  }

  async _excluir(forn) {
    const ok = window.confirm(`Excluir o fornecedor "${forn.nome}"?`);
    if (!ok) return;
    try {
      await excluirFornecedor(forn.id);
      if (this.editandoId === forn.id) this.limparFormulario();
      notificar("Fornecedor removido.", "sucesso");
      this.onMudou();
    } catch (erro) {
      notificar(erro.message || "Falha ao excluir.", "erro");
    }
  }

  async _salvar(evento) {
    evento.preventDefault();
    const inputTipos =
      this.formEl.querySelector("#forn-tipos-mercadoria") ||
      this.formEl.querySelector("#forn-nicho");
    const payload = {
      nome: this.formEl.querySelector("#forn-nome").value,
      tiposMercadoria: inputTipos?.value || "",
      telefone: this.formEl.querySelector("#forn-telefone").value,
      whatsapp: this.formEl.querySelector("#forn-whatsapp").value,
      email: this.formEl.querySelector("#forn-email").value,
      cidade: this.formEl.querySelector("#forn-cidade").value,
      observacao: this.formEl.querySelector("#forn-observacao").value,
      ativo: this.formEl.querySelector("#forn-ativo").checked,
    };

    try {
      if (this.editandoId) {
        await atualizarFornecedor(this.editandoId, payload);
        notificar("Fornecedor atualizado.", "sucesso");
      } else {
        await criarFornecedor(payload);
        notificar("Fornecedor cadastrado.", "sucesso");
      }
      this.limparFormulario();
      this.onMudou();
    } catch (erro) {
      notificar(erro.message || "Falha ao salvar fornecedor.", "erro");
    }
  }
}
