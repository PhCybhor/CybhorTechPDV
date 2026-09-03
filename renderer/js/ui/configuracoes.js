import {
  obterConfigApp,
  salvarConfigApp,
  listarImpressoras,
} from "../services/configService.js";
import { obterLojaId, obterMetaLoja } from "../services/tenantContext.js";
import { notificar } from "./notificacao.js";
import { escapeHtml } from "../utils/escape.js";
import { MODULOS_LOJA, CAMPOS_CADASTRO_PRODUTO, aplicarAparencia } from "../utils/aparencia.js";

/**
 * Painel de configurações da loja e impressora.
 */
export class PainelConfiguracoes {
  /**
   * @param {{
   *   form: HTMLFormElement,
   *   selectImpressora: HTMLSelectElement,
   *   erroEl: HTMLElement,
   *   onSalvo?: (config: object) => void
   *   onAparencia?: (parcial: object) => void
   * }} opcoes
   */
  constructor({ form, selectImpressora, erroEl, onSalvo = null, onAparencia = null }) {
    this.form = form;
    this.selectImpressora = selectImpressora;
    this.erroEl = erroEl;
    this.onSalvo = onSalvo;
    this.onAparencia = onAparencia;
    this._carregando = false;

    this.form.addEventListener("submit", (e) => this._salvar(e));
    this.form
      .querySelector("#btn-atualizar-impressoras")
      ?.addEventListener("click", () => this._carregarImpressoras());

    const idsPreview = [
      "#cfg-tema",
      "#cfg-fonte-ui",
      "#cfg-densidade-ui",
      "#cfg-tamanho-ui",
      "#cfg-reduzir-animacoes",
    ];
    for (const seletor of idsPreview) {
      this.form.querySelector(seletor)?.addEventListener("change", () => {
        const parcial = this._lerAparencia();
        aplicarAparencia(parcial);
        this.onAparencia?.(parcial);
      });
    }
  }

  async carregar() {
    this._setErro("");
    try {
      const config = await obterConfigApp();
      this._preencher(config);
      await this._carregarImpressoras(config.impressoraNome);
      const resumo = this.form.querySelector("#cfg-licenca-resumo");
      if (resumo) {
        const lojaId = obterLojaId() || "—";
        const meta = obterMetaLoja();
        resumo.innerHTML = `Loja isolada <code>${escapeHtml(lojaId)}</code>${
          meta?.nomeLoja ? ` · ${escapeHtml(meta.nomeLoja)}` : ""
        }. Dados em <code>lojas/${escapeHtml(lojaId)}/…</code>`;
      }
    } catch (erro) {
      this._setErro(erro.message);
    }
  }

  /**
   * @returns {object}
   */
  _lerAparencia() {
    return {
      tema: this.form.querySelector("#cfg-tema")?.value || "escuro",
      fonteUi: this.form.querySelector("#cfg-fonte-ui")?.value || "sistema",
      densidadeUi:
        this.form.querySelector("#cfg-densidade-ui")?.value || "confortavel",
      tamanhoUi: this.form.querySelector("#cfg-tamanho-ui")?.value || "medio",
      reduzirAnimacoes: Boolean(
        this.form.querySelector("#cfg-reduzir-animacoes")?.checked
      ),
    };
  }

  /**
   * @param {object} config
   */
  _preencher(config) {
    this.form.querySelector("#cfg-loja-nome").value = config.lojaNome || "";
    this.form.querySelector("#cfg-loja-cnpj").value = config.lojaCnpj || "";
    this.form.querySelector("#cfg-loja-endereco").value =
      config.lojaEndereco || "";
    this.form.querySelector("#cfg-loja-telefone").value =
      config.lojaTelefone || "";
    this.form.querySelector("#cfg-estoque-minimo").value = String(
      config.estoqueMinimo ?? 5
    );
    const avisoIa = this.form.querySelector("#cfg-aviso-fornecedores-ia");
    if (avisoIa) avisoIa.checked = config.avisoFornecedoresIa !== false;
    this.form.querySelector("#cfg-impressora-modo").value =
      config.impressoraModo || "";
    this.form.querySelector("#cfg-impressora-porta").value =
      config.impressoraPorta || "";
    const descMax = this.form.querySelector("#cfg-desconto-max");
    if (descMax) descMax.value = String(config.descontoMaxPct ?? 15);
    const cash = this.form.querySelector("#cfg-cashback");
    if (cash) cash.value = String(config.cashbackPct ?? 0);
    const beep = this.form.querySelector("#cfg-beep-modo");
    if (beep) beep.value = config.beepModo || "curto";
    const abr = this.form.querySelector("#cfg-abrir-caixa-obrigatorio");
    if (abr) abr.checked = config.abrirCaixaObrigatorio !== false;
    const barras = this.form.querySelector("#cfg-modo-barras-continuo");
    if (barras) barras.checked = config.modoBarrasContinuo !== false;
    const gav = this.form.querySelector("#cfg-abrir-gaveta");
    if (gav) gav.checked = Boolean(config.abrirGavetaAoVender);

    const tema = this.form.querySelector("#cfg-tema");
    if (tema) tema.value = config.tema === "claro" ? "claro" : "escuro";
    const fonte = this.form.querySelector("#cfg-fonte-ui");
    if (fonte) fonte.value = config.fonteUi || "sistema";
    const dens = this.form.querySelector("#cfg-densidade-ui");
    if (dens) {
      dens.value =
        config.densidadeUi === "compacta" ? "compacta" : "confortavel";
    }
    const tam = this.form.querySelector("#cfg-tamanho-ui");
    if (tam) tam.value = config.tamanhoUi || "medio";
    const anim = this.form.querySelector("#cfg-reduzir-animacoes");
    if (anim) anim.checked = Boolean(config.reduzirAnimacoes);

    const ocFiado = this.form.querySelector("#cfg-ocultar-fiado");
    if (ocFiado) ocFiado.checked = Boolean(config.ocultarFiado);
    const ocDesc = this.form.querySelector("#cfg-ocultar-desconto");
    if (ocDesc) ocDesc.checked = Boolean(config.ocultarDesconto);
    const ocCli = this.form.querySelector("#cfg-ocultar-cliente");
    if (ocCli) ocCli.checked = Boolean(config.ocultarCliente);

    for (const campo of CAMPOS_CADASTRO_PRODUTO) {
      const el = this.form.querySelector(`#cfg-${kebabModulo(campo.chave)}`);
      if (el) el.checked = config[campo.chave] !== false;
    }

    for (const mod of MODULOS_LOJA) {
      const el = this.form.querySelector(`#cfg-${kebabModulo(mod.chave)}`);
      if (el) el.checked = config[mod.chave] !== false;
    }
  }

  /**
   * @param {string} [selecionada]
   */
  async _carregarImpressoras(selecionada) {
    const atual =
      selecionada ||
      this.selectImpressora.value ||
      this.form.querySelector("#cfg-impressora-nome-manual")?.value ||
      "";

    try {
      const lista = await listarImpressoras();
      const nomes = lista.map((p) => p.nome);
      if (atual && !nomes.includes(atual)) nomes.unshift(atual);

      this.selectImpressora.innerHTML =
        `<option value="">Detectar automaticamente (Jetway)</option>` +
        nomes
          .map((nome) => {
            const padrao = lista.find((p) => p.nome === nome)?.padrao
              ? " (padrão)"
              : "";
            return `<option value="${escapeAttr(nome)}" ${
              nome === atual ? "selected" : ""
            }>${escapeHtml(nome)}${padrao}</option>`;
          })
          .join("");
    } catch {
      this.selectImpressora.innerHTML = `<option value="">Detectar automaticamente (Jetway)</option>`;
    }
  }

  /**
   * @param {Event} evento
   */
  async _salvar(evento) {
    evento.preventDefault();
    if (this._carregando) return;
    this._carregando = true;
    this._setErro("");

    const botao = this.form.querySelector("#btn-salvar-config");
    if (botao) botao.disabled = true;

    try {
      /** @type {Record<string, boolean>} */
      const modulos = {};
      for (const mod of MODULOS_LOJA) {
        const el = this.form.querySelector(`#cfg-${kebabModulo(mod.chave)}`);
        modulos[mod.chave] = Boolean(el?.checked);
      }

      const camposProduto = {};
      for (const campo of CAMPOS_CADASTRO_PRODUTO) {
        const el = this.form.querySelector(`#cfg-${kebabModulo(campo.chave)}`);
        camposProduto[campo.chave] = Boolean(el?.checked);
      }

      const config = await salvarConfigApp({
        lojaNome: this.form.querySelector("#cfg-loja-nome").value,
        lojaCnpj: this.form.querySelector("#cfg-loja-cnpj").value,
        lojaEndereco: this.form.querySelector("#cfg-loja-endereco").value,
        lojaTelefone: this.form.querySelector("#cfg-loja-telefone").value,
        estoqueMinimo: this.form.querySelector("#cfg-estoque-minimo").value,
        avisoFornecedoresIa: Boolean(
          this.form.querySelector("#cfg-aviso-fornecedores-ia")?.checked
        ),
        impressoraNome: this.selectImpressora.value,
        impressoraModo: this.form.querySelector("#cfg-impressora-modo").value,
        impressoraPorta: this.form.querySelector("#cfg-impressora-porta").value,
        descontoMaxPct: this.form.querySelector("#cfg-desconto-max")?.value,
        cashbackPct: this.form.querySelector("#cfg-cashback")?.value,
        beepModo: this.form.querySelector("#cfg-beep-modo")?.value,
        abrirCaixaObrigatorio: Boolean(
          this.form.querySelector("#cfg-abrir-caixa-obrigatorio")?.checked
        ),
        modoBarrasContinuo: Boolean(
          this.form.querySelector("#cfg-modo-barras-continuo")?.checked
        ),
        abrirGavetaAoVender: Boolean(
          this.form.querySelector("#cfg-abrir-gaveta")?.checked
        ),
        ...this._lerAparencia(),
        ocultarFiado: Boolean(
          this.form.querySelector("#cfg-ocultar-fiado")?.checked
        ),
        ocultarDesconto: Boolean(
          this.form.querySelector("#cfg-ocultar-desconto")?.checked
        ),
        ocultarCliente: Boolean(
          this.form.querySelector("#cfg-ocultar-cliente")?.checked
        ),
        ...camposProduto,
        ...modulos,
      });
      notificar("Configurações salvas.", "sucesso");
      this.onSalvo?.(config);
    } catch (erro) {
      this._setErro(erro.message);
      notificar(erro.message, "erro");
    } finally {
      this._carregando = false;
      if (botao) botao.disabled = false;
    }
  }

  /** @param {string} texto */
  _setErro(texto) {
    this.erroEl.textContent = texto || "";
    this.erroEl.classList.toggle("oculto", !texto);
  }
}

/** @param {string} texto */
function escapeAttr(texto) {
  return escapeHtml(texto).replace(/'/g, "&#39;");
}

/** @param {string} chave camelCase → kebab (moduloHistorico → modulo-historico) */
function kebabModulo(chave) {
  return chave.replace(/([A-Z])/g, "-$1").toLowerCase();
}
