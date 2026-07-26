import { escapeHtml } from "../utils/escape.js";
import { formatarMoeda } from "../utils/formato.js";
import { notificar } from "./notificacao.js";
import {
  criarCliente,
  atualizarCliente,
  excluirCliente,
  quitarFiado,
  historicoPreferenciasCliente,
  clientesAniversariantesHoje,
} from "../services/clienteService.js";
import {
  urlWhatsApp,
  abrirWhatsApp,
} from "../services/whatsappUtil.js";

/**
 * CRM leve: clientes, fiado, aniversário, preferências.
 */
export class PainelClientes {
  constructor({
    listaEl,
    formEl,
    obterVendas = () => [],
    onSelecionarPdv = () => {},
  }) {
    this.listaEl = listaEl;
    this.formEl = formEl;
    this.obterVendas = obterVendas;
    this.onSelecionarPdv = onSelecionarPdv;
    this.clientes = [];
    this.editandoId = null;
    this.filtro = "";

    formEl?.addEventListener("submit", (e) => this._salvar(e));
    listaEl?.addEventListener("click", (e) => this._clique(e));
    formEl
      ?.querySelector("#btn-limpar-cliente")
      ?.addEventListener("click", () => this.limpar());
  }

  atualizar(lista) {
    this.clientes = Array.isArray(lista) ? lista : [];
    this.renderizar();
  }

  limpar() {
    this.editandoId = null;
    this.formEl?.reset();
    const btn = this.formEl?.querySelector("#btn-salvar-cliente");
    if (btn) btn.textContent = "Salvar cliente";
  }

  renderizar() {
    const aniv = clientesAniversariantesHoje(this.clientes);
    const q = this.filtro.trim().toLowerCase();
    let lista = this.clientes;
    if (q) {
      lista = lista.filter(
        (c) =>
          String(c.nome).toLowerCase().includes(q) ||
          String(c.whatsapp || "").includes(q)
      );
    }

    const banner =
      aniv.length > 0
        ? `<div class="alerta-inline">🎂 Aniversariantes hoje: ${aniv
            .map((c) => escapeHtml(c.nome))
            .join(", ")}</div>`
        : "";

    if (!lista.length) {
      this.listaEl.innerHTML =
        banner +
        `<div class="estado-vazio"><p>Nenhum cliente</p><span>Cadastre para fiado, fidelidade e WhatsApp</span></div>`;
      return;
    }

    this.listaEl.innerHTML =
      banner +
      lista
        .map((c) => {
          const prefs = historicoPreferenciasCliente(
            this.obterVendas(),
            c.id,
            3
          );
          const prefTxt = prefs.length
            ? prefs.map((p) => p.nome).join(", ")
            : "Sem histórico ainda";
          return `
        <div class="fornecedor-linha" data-id="${escapeHtml(c.id)}">
          <div class="fornecedor-info">
            <div class="fornecedor-topo">
              <strong>${escapeHtml(c.nome)}</strong>
              ${
                Number(c.saldoFiado) > 0
                  ? `<span class="badge-area badge-area--rh">Fiado ${formatarMoeda(
                      c.saldoFiado
                    )}</span>`
                  : ""
              }
              ${
                Number(c.pontosFidelidade) >= 10
                  ? `<span class="badge-area badge-area--marketing">★ ${Math.floor(
                      c.pontosFidelidade
                    )} pts</span>`
                  : ""
              }
            </div>
            <span class="fornecedor-meta">${escapeHtml(
              c.whatsapp || c.telefone || "Sem contato"
            )}${c.aniversario ? ` · aniv. ${escapeHtml(c.aniversario)}` : ""}</span>
            <span class="fornecedor-obs">Costuma levar: ${escapeHtml(prefTxt)}</span>
          </div>
          <div class="fornecedor-acoes">
            <button type="button" class="btn btn-primario btn-sm" data-acao="pdv" data-id="${escapeHtml(
              c.id
            )}">No caixa</button>
            ${
              c.whatsapp || c.telefone
                ? `<button type="button" class="btn btn-secundario btn-sm" data-acao="wa" data-id="${escapeHtml(
                    c.id
                  )}">WhatsApp</button>`
                : ""
            }
            ${
              Number(c.saldoFiado) > 0
                ? `<button type="button" class="btn btn-secundario btn-sm" data-acao="quitar" data-id="${escapeHtml(
                    c.id
                  )}">Quitar fiado</button>`
                : ""
            }
            <button type="button" class="btn btn-texto btn-sm" data-acao="editar" data-id="${escapeHtml(
              c.id
            )}">Editar</button>
            <button type="button" class="btn btn-texto btn-sm" data-acao="excluir" data-id="${escapeHtml(
              c.id
            )}">Excluir</button>
          </div>
        </div>`;
        })
        .join("");
  }

  _clique(e) {
    const btn = e.target.closest("[data-acao][data-id]");
    if (!btn) return;
    const c = this.clientes.find((x) => x.id === btn.dataset.id);
    if (!c) return;
    if (btn.dataset.acao === "editar") {
      this.editandoId = c.id;
      this.formEl.querySelector("#cli-nome").value = c.nome || "";
      this.formEl.querySelector("#cli-whatsapp").value = c.whatsapp || "";
      this.formEl.querySelector("#cli-telefone").value = c.telefone || "";
      this.formEl.querySelector("#cli-aniversario").value = c.aniversario || "";
      this.formEl.querySelector("#cli-limite").value = c.limiteFiado || 0;
      this.formEl.querySelector("#cli-obs").value = c.observacao || "";
      this.formEl.querySelector("#btn-salvar-cliente").textContent =
        "Atualizar cliente";
      return;
    }
    if (btn.dataset.acao === "excluir") {
      if (!confirm(`Excluir ${c.nome}?`)) return;
      excluirCliente(c.id)
        .then(() => notificar("Cliente removido.", "sucesso"))
        .catch((err) => notificar(err.message, "erro"));
      return;
    }
    if (btn.dataset.acao === "pdv") {
      this.onSelecionarPdv(c);
      return;
    }
    if (btn.dataset.acao === "wa") {
      const devendo = Number(c.saldoFiado) > 0;
      const msg = devendo
        ? `Olá ${c.nome}! Passando para lembrar do valor em aberto de ${formatarMoeda(
            c.saldoFiado
          )} na loja. Qualquer dúvida, estamos aqui.`
        : c.aniversario &&
          clientesAniversariantesHoje([c]).length
        ? `Olá ${c.nome}! Feliz aniversário 🎉 Tem um mimo esperando por você na loja hoje.`
        : `Olá ${c.nome}! Tudo bem? Aqui é da loja.`;
      const url = urlWhatsApp(c.whatsapp || c.telefone, msg);
      if (!url) notificar("WhatsApp inválido.", "alerta");
      else abrirWhatsApp(url);
      return;
    }
    if (btn.dataset.acao === "quitar") {
      const bruto = prompt("Valor a quitar (R$):", String(c.saldoFiado));
      if (bruto === null) return;
      quitarFiado(c.id, bruto)
        .then(() => notificar("Fiado atualizado.", "sucesso"))
        .catch((err) => notificar(err.message, "erro"));
    }
  }

  async _salvar(e) {
    e.preventDefault();
    const payload = {
      nome: this.formEl.querySelector("#cli-nome").value,
      whatsapp: this.formEl.querySelector("#cli-whatsapp").value,
      telefone: this.formEl.querySelector("#cli-telefone").value,
      aniversario: this.formEl.querySelector("#cli-aniversario").value,
      limiteFiado: this.formEl.querySelector("#cli-limite").value,
      observacao: this.formEl.querySelector("#cli-obs").value,
    };
    try {
      if (this.editandoId) {
        await atualizarCliente(this.editandoId, payload);
        notificar("Cliente atualizado.", "sucesso");
      } else {
        await criarCliente(payload);
        notificar("Cliente cadastrado.", "sucesso");
      }
      this.limpar();
    } catch (erro) {
      notificar(erro.message || "Falha ao salvar.", "erro");
    }
  }
}
