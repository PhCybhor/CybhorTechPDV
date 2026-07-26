import { formatarMoeda } from "../utils/formato.js";
import { escapeHtml } from "../utils/escape.js";
import { notificar } from "./notificacao.js";
import {
  abrirCaixaDia,
  registrarSuprimento,
  lerEstadoCaixa,
  somarSuprimentosDoDia,
  somarVendasDinheiroDoDia,
  calcularDinheiroEsperado,
} from "../services/caixaCicloService.js";
import { somarSangriasDoDia } from "../services/sangriaService.js";
import { listarFechamentosRecentes } from "../services/fechamentoService.js";

/**
 * Aba Caixa físico: fundo, suprimento, esperado e histórico.
 */
export class PainelCaixaFisico {
  /**
   * @param {{
   *   raiz: HTMLElement,
   *   obterFuncionario: () => object | null,
   *   obterVendas: () => Array<object>,
   *   obterSangrias: () => Array<object>,
   * }} opcoes
   */
  constructor({ raiz, obterFuncionario, obterVendas, obterSangrias }) {
    this.raiz = raiz;
    this.obterFuncionario = obterFuncionario;
    this.obterVendas = obterVendas;
    this.obterSangrias = obterSangrias;
    this.suprimentos = [];
    this.estadoCaixa = { fundoInicial: 0, abertoEm: null, abertoPorNome: null };

    this.formFundo = raiz.querySelector("#form-fundo-caixa");
    this.formSuprimento = raiz.querySelector("#form-suprimento");
    this.listaSuprimentos = raiz.querySelector("#lista-suprimentos");
    this.listaFechamentos = raiz.querySelector("#lista-fechamentos");

    this.formFundo?.addEventListener("submit", (e) => this._salvarFundo(e));
    this.formSuprimento?.addEventListener("submit", (e) => this._salvarSuprimento(e));
    this.raiz
      .querySelector("#form-conferencia-gaveta")
      ?.addEventListener("submit", (e) => this._conferirGaveta(e));
  }

  /**
   * @param {Array<object>} lista
   */
  atualizarSuprimentos(lista) {
    this.suprimentos = Array.isArray(lista) ? lista : [];
    this.renderizar();
  }

  async atualizarEstado() {
    try {
      this.estadoCaixa = await lerEstadoCaixa();
    } catch {
      this.estadoCaixa = { fundoInicial: 0, abertoEm: null, abertoPorNome: null };
    }
    this.renderizar();
    this._renderFechamentos();
  }

  renderizar() {
    const fundo = Number(this.estadoCaixa.fundoInicial) || 0;
    const supHoje = somarSuprimentosDoDia(this.suprimentos);
    const vendasDin = somarVendasDinheiroDoDia(this.obterVendas());
    const sangrias = somarSangriasDoDia(this.obterSangrias());
    const esperado = calcularDinheiroEsperado({
      fundoInicial: fundo,
      suprimentosDia: supHoje,
      vendasDinheiro: vendasDin,
      sangriasDia: sangrias,
    });

    const set = (id, texto) => {
      const el = this.raiz.querySelector(id);
      if (el) el.textContent = texto;
    };
    set("#card-fundo-caixa", formatarMoeda(fundo));
    set("#card-suprimentos-hoje", formatarMoeda(supHoje));
    set("#card-dinheiro-esperado", formatarMoeda(esperado));

    const inputFundo = this.raiz.querySelector("#fundo-caixa-valor");
    if (inputFundo && document.activeElement !== inputFundo) {
      inputFundo.value = fundo ? String(fundo) : "";
    }

    if (this.listaSuprimentos) {
      const doDia = this.suprimentos.filter((s) => {
        const t0 = new Date();
        t0.setHours(0, 0, 0, 0);
        return (Number(s.criadoEm) || 0) >= t0.getTime();
      });
      this.listaSuprimentos.innerHTML = doDia.length
        ? doDia
            .map(
              (s) => `
          <div class="despesa-linha">
            <div>
              <strong>${formatarMoeda(s.valor)}</strong>
              <span class="fornecedor-meta">${escapeHtml(s.motivo || "Suprimento")} · ${escapeHtml(
                s.funcionarioNome || "—"
              )}</span>
            </div>
          </div>`
            )
            .join("")
        : `<p class="ranking-vazio">Nenhum suprimento hoje</p>`;
    }
  }

  async _renderFechamentos() {
    if (!this.listaFechamentos) return;
    try {
      const lista = await listarFechamentosRecentes();
      if (!lista.length) {
        this.listaFechamentos.innerHTML =
          `<p class="ranking-vazio">Nenhum fechamento nos últimos 30 dias</p>`;
        return;
      }
      this.listaFechamentos.innerHTML = lista
        .map((f) => {
          const quando = f.criadoEm
            ? new Date(f.criadoEm).toLocaleString("pt-BR")
            : "—";
          const sang = f.totalSangrias != null ? formatarMoeda(f.totalSangrias) : "—";
          const esp =
            f.dinheiroEsperado != null ? formatarMoeda(f.dinheiroEsperado) : "—";
          return `
          <div class="despesa-linha">
            <div>
              <strong>${formatarMoeda(f.totalLiquido || 0)}</strong>
              <span class="fornecedor-meta">${escapeHtml(quando)} · ${escapeHtml(
                f.funcionarioNome || "—"
              )} · ${f.quantidadeVendas || 0} venda(s)</span>
              <span class="fornecedor-meta">Tirei ${sang} · Na gaveta deveria ter ${esp}</span>
            </div>
          </div>`;
        })
        .join("");
    } catch {
      this.listaFechamentos.innerHTML =
        `<p class="ranking-vazio">Não foi possível carregar fechamentos</p>`;
    }
  }

  async _salvarFundo(evento) {
    evento.preventDefault();
    const funcionario = this.obterFuncionario();
    if (!funcionario) {
      notificar("Faça login novamente.", "alerta");
      return;
    }
    const valor = this.raiz.querySelector("#fundo-caixa-valor")?.value;
    try {
      await abrirCaixaDia({ fundoInicial: valor, funcionario });
      notificar("Fundo do caixa salvo.", "sucesso");
      window.dispatchEvent(new CustomEvent("cybhor-caixa-aberto"));
      await this.atualizarEstado();
    } catch (erro) {
      notificar(erro.message || "Falha ao salvar fundo.", "erro");
    }
  }

  async _salvarSuprimento(evento) {
    evento.preventDefault();
    const funcionario = this.obterFuncionario();
    if (!funcionario) {
      notificar("Faça login novamente.", "alerta");
      return;
    }
    try {
      await registrarSuprimento({
        valor: this.raiz.querySelector("#suprimento-valor")?.value,
        motivo: this.raiz.querySelector("#suprimento-motivo")?.value,
        funcionario,
      });
      this.formSuprimento?.reset();
      notificar("Suprimento registrado.", "sucesso");
    } catch (erro) {
      notificar(erro.message || "Falha no suprimento.", "erro");
    }
  }

  async _conferirGaveta(evento) {
    evento.preventDefault();
    const contado = Number(
      this.raiz.querySelector("#gaveta-contado")?.value
    );
    if (!Number.isFinite(contado) || contado < 0) {
      notificar("Informe o valor contado.", "alerta");
      return;
    }
    await this.atualizarEstado();
    const fundo = Number(this.estadoCaixa.fundoInicial) || 0;
    const supHoje = somarSuprimentosDoDia(this.suprimentos);
    const vendasDin = somarVendasDinheiroDoDia(this.obterVendas());
    const sangrias = somarSangriasDoDia(this.obterSangrias());
    const esperado = calcularDinheiroEsperado({
      fundoInicial: fundo,
      suprimentosDia: supHoje,
      vendasDinheiro: vendasDin,
      sangriasDia: sangrias,
    });
    const diff = Math.round((contado - esperado) * 100) / 100;
    const el = this.raiz.querySelector("#gaveta-diferenca");
    if (el) {
      el.textContent =
        diff === 0
          ? `Bateu certinho: ${formatarMoeda(esperado)}`
          : diff > 0
            ? `Sobra de ${formatarMoeda(diff)} (contado ${formatarMoeda(
                contado
              )} × esperado ${formatarMoeda(esperado)})`
            : `Falta ${formatarMoeda(Math.abs(diff))} (contado ${formatarMoeda(
                contado
              )} × esperado ${formatarMoeda(esperado)})`;
      el.classList.toggle("alerta", diff !== 0);
    }
    notificar(
      diff === 0 ? "Gaveta ok." : `Diferença: ${formatarMoeda(diff)}`,
      diff === 0 ? "sucesso" : "alerta"
    );
  }
}
