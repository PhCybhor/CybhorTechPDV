import { escapeHtml } from "../utils/escape.js";
import { gerarInsightsLoja } from "../services/insightsService.js";
import {
  listarCampanhas,
  atualizarStatusCampanha,
  excluirCampanha,
} from "../services/campanhaService.js";

/**
 * Painel Pulso da Loja: insights + campanhas Copy thief.
 */
export class PainelPulso {
  /**
   * @param {{
   *   raiz: HTMLElement,
   *   obterLojaId: () => string | null,
   *   onAcao?: (acao: string) => void,
   * }} opcoes
   */
  constructor({ raiz, obterLojaId, onAcao = () => {} }) {
    this.raiz = raiz;
    this.obterLojaId = obterLojaId;
    this.onAcao = onAcao;
    this._aoClique = (e) => this._tratarClique(e);
    this.raiz.addEventListener("click", this._aoClique);
  }

  destruir() {
    this.raiz.removeEventListener("click", this._aoClique);
  }

  /**
   * @param {Parameters<typeof gerarInsightsLoja>[0]} dados
   */
  atualizar(dados) {
    const insights = gerarInsightsLoja(dados);
    const campanhas = listarCampanhas(this.obterLojaId());

    const htmlInsights = insights
      .map(
        (i) => `
      <article class="pulso-card pulso-card--${escapeHtml(i.tipo)}">
        <h4>${escapeHtml(i.titulo)}</h4>
        <p>${escapeHtml(i.texto)}</p>
        ${
          i.acao
            ? `<button type="button" class="btn btn-secundario btn-sm" data-pulso-acao="${escapeHtml(
                i.acao
              )}">Resolver</button>`
            : ""
        }
      </article>`
      )
      .join("");

    const htmlCampanhas =
      campanhas.length === 0
        ? `<p class="ranking-vazio">Nenhuma campanha salva. No CybhorIA (Copy thief), use “Salvar campanha”.</p>`
        : campanhas
            .slice(0, 8)
            .map(
              (c) => `
        <article class="campanha-card campanha-card--${escapeHtml(c.status)}">
          <div class="campanha-topo">
            <strong>${escapeHtml(c.titulo)}</strong>
            <span class="badge-campanha">${escapeHtml(c.status)}</span>
          </div>
          <p class="campanha-texto">${escapeHtml(
            String(c.texto).slice(0, 280)
          )}${String(c.texto).length > 280 ? "…" : ""}</p>
          <div class="campanha-acoes">
            <button type="button" class="btn btn-secundario btn-sm" data-campanha-status="${escapeHtml(
              c.id
            )}" data-status="ativa">Ativar</button>
            <button type="button" class="btn btn-secundario btn-sm" data-campanha-status="${escapeHtml(
              c.id
            )}" data-status="feita">Feita</button>
            <button type="button" class="btn btn-texto btn-sm" data-campanha-copiar="${escapeHtml(
              c.id
            )}">Copiar</button>
            <button type="button" class="btn btn-texto btn-sm" data-campanha-excluir="${escapeHtml(
              c.id
            )}">Excluir</button>
          </div>
        </article>`
            )
            .join("");

    this.raiz.innerHTML = `
      <div class="pulso-grade">
        <section class="pulso-secao">
          <h3 class="painel-titulo">Pulso da loja</h3>
          <p class="subtitulo painel-sub">O que importa agora — sem planilha</p>
          <div class="pulso-lista">${htmlInsights}</div>
        </section>
        <section class="pulso-secao">
          <h3 class="painel-titulo">Campanhas Copy thief</h3>
          <p class="subtitulo painel-sub">Ideias salvas viram plano de ação</p>
          <div class="campanhas-lista">${htmlCampanhas}</div>
        </section>
      </div>`;
  }

  _tratarClique(e) {
    const acaoBtn = e.target.closest("[data-pulso-acao]");
    if (acaoBtn) {
      this.onAcao(acaoBtn.dataset.pulsoAcao);
      return;
    }
    const statusBtn = e.target.closest("[data-campanha-status]");
    if (statusBtn) {
      atualizarStatusCampanha(
        this.obterLojaId(),
        statusBtn.dataset.campanhaStatus,
        statusBtn.dataset.status
      );
      this.onAcao("recarregar-pulso");
      return;
    }
    const excluir = e.target.closest("[data-campanha-excluir]");
    if (excluir) {
      excluirCampanha(this.obterLojaId(), excluir.dataset.campanhaExcluir);
      this.onAcao("recarregar-pulso");
      return;
    }
    const copiar = e.target.closest("[data-campanha-copiar]");
    if (copiar) {
      const c = listarCampanhas(this.obterLojaId()).find(
        (x) => x.id === copiar.dataset.campanhaCopiar
      );
      if (c?.texto) {
        navigator.clipboard?.writeText(c.texto);
        this.onAcao("campanha-copiada");
      }
    }
  }
}
