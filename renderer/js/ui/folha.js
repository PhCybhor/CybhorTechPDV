import { formatarMoeda } from "../utils/formato.js";
import { escapeHtml } from "../utils/escape.js";
import { notificar } from "./notificacao.js";
import {
  TIPOS_VINCULO,
  VIGENCIAS,
  simularClt,
  simularPj,
  sugerirValorNotaParaLiquidoClt,
  resumoPagamentoTexto,
  CHECKLIST_CLT,
  CHECKLIST_PJ,
} from "../services/folhaService.js";
import { atualizarDadosRemuneracao } from "../services/authService.js";
import { criarDespesa, competenciaDe } from "../services/despesaService.js";

/**
 * Auxiliar de pagamento CLT / PJ na tela Equipe.
 */
export class PainelFolha {
  /**
   * @param {{
   *   raiz: HTMLElement,
   *   obterFuncionarios: () => Array<object>
   * }} opcoes
   */
  constructor({ raiz, obterFuncionarios }) {
    this.raiz = raiz;
    this.obterFuncionarios = obterFuncionarios;
    this.ultimaSimulacao = null;

    this.form = raiz.querySelector("#form-folha");
    this.resultado = raiz.querySelector("#folha-resultado");
    this.selectFunc = raiz.querySelector("#folha-funcionario");
    this.selectTipo = raiz.querySelector("#folha-tipo");
    this.blocoClt = raiz.querySelector("#folha-campos-clt");
    this.blocoPj = raiz.querySelector("#folha-campos-pj");
    this.checklistEl = raiz.querySelector("#folha-checklist");

    this.form?.addEventListener("submit", (e) => {
      e.preventDefault();
      this.calcular();
    });
    this.selectTipo?.addEventListener("change", () => this._alternarTipo());
    this.selectFunc?.addEventListener("change", () => this._carregarFuncionario());
    raiz
      .querySelector("#btn-folha-salvar-vinculo")
      ?.addEventListener("click", () => this.salvarVinculo());
    raiz
      .querySelector("#btn-folha-registrar-despesa")
      ?.addEventListener("click", () => this.registrarDespesa());
    raiz
      .querySelector("#btn-folha-sugerir-pj")
      ?.addEventListener("click", () => this.sugerirPj());

    this._alternarTipo();
  }

  /**
   * @param {Array<object>} [funcionarios]
   */
  atualizar(funcionarios) {
    const lista = funcionarios || this.obterFuncionarios() || [];
    if (!this.selectFunc) return;
    const atual = this.selectFunc.value;
    this.selectFunc.innerHTML =
      `<option value="">— Simulação avulsa —</option>` +
      lista
        .map(
          (f) =>
            `<option value="${escapeHtml(f.id)}">${escapeHtml(
              f.nome
            )} (@${escapeHtml(f.usuario)})</option>`
        )
        .join("");
    if (atual && lista.some((f) => f.id === atual)) {
      this.selectFunc.value = atual;
    }
  }

  _alternarTipo() {
    const tipo = this.selectTipo?.value || TIPOS_VINCULO.CLT;
    const ehClt = tipo === TIPOS_VINCULO.CLT;
    this.blocoClt?.classList.toggle("oculto", !ehClt);
    this.blocoPj?.classList.toggle("oculto", ehClt);
    this._renderChecklist(ehClt ? CHECKLIST_CLT : CHECKLIST_PJ);
  }

  _carregarFuncionario() {
    const id = this.selectFunc?.value;
    const func = (this.obterFuncionarios() || []).find((f) => f.id === id);
    if (!func) return;

    if (func.tipoVinculo) {
      this.selectTipo.value =
        func.tipoVinculo === TIPOS_VINCULO.MEI
          ? TIPOS_VINCULO.MEI
          : func.tipoVinculo === TIPOS_VINCULO.PJ
            ? TIPOS_VINCULO.PJ
            : TIPOS_VINCULO.CLT;
      this._alternarTipo();
    }

    if (this.selectTipo.value === TIPOS_VINCULO.CLT) {
      if (func.salarioBruto != null) {
        this.raiz.querySelector("#folha-salario").value = String(func.salarioBruto);
      }
      if (func.dependentes != null) {
        this.raiz.querySelector("#folha-dependentes").value = String(
          func.dependentes
        );
      }
    } else if (func.valorContrato != null) {
      this.raiz.querySelector("#folha-valor-nota").value = String(
        func.valorContrato
      );
    }
  }

  _renderChecklist(itens) {
    if (!this.checklistEl) return;
    this.checklistEl.innerHTML = itens
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
  }

  calcular() {
    const tipo = this.selectTipo?.value || TIPOS_VINCULO.CLT;
    let sim;

    if (tipo === TIPOS_VINCULO.CLT) {
      const encargosPct = Number(this.raiz.querySelector("#folha-encargos").value);
      sim = simularClt({
        salarioBruto: this.raiz.querySelector("#folha-salario").value,
        dependentes: this.raiz.querySelector("#folha-dependentes").value,
        valeTransporte: this.raiz.querySelector("#folha-vt").value,
        outrosDescontos: this.raiz.querySelector("#folha-outros").value,
        encargosPatronais: Number.isFinite(encargosPct)
          ? encargosPct / 100
          : undefined,
      });
      this._renderClt(sim);
    } else {
      const aliqPct = Number(this.raiz.querySelector("#folha-aliq-pj").value);
      sim = simularPj({
        valorNota: this.raiz.querySelector("#folha-valor-nota").value,
        regime: tipo,
        aliquotaImpostosPj: Number.isFinite(aliqPct) ? aliqPct / 100 : undefined,
      });
      this._renderPj(sim);
    }

    this.ultimaSimulacao = sim;
    notificar("Simulação atualizada.", "sucesso");
  }

  _renderClt(sim) {
    if (!this.resultado) return;
    this.resultado.innerHTML = `
      <div class="folha-cards">
        <div class="folha-card">
          <span>Líquido do funcionário</span>
          <strong class="sucesso">${formatarMoeda(sim.liquido)}</strong>
        </div>
        <div class="folha-card">
          <span>Custo estimado da loja</span>
          <strong>${formatarMoeda(sim.custoMensalEmpresa)}</strong>
        </div>
        <div class="folha-card">
          <span>INSS empregado</span>
          <strong>${formatarMoeda(sim.inss)}</strong>
        </div>
        <div class="folha-card">
          <span>IRRF</span>
          <strong>${formatarMoeda(sim.irrf)}</strong>
        </div>
      </div>
      <div class="folha-detalhe">
        <div><span>FGTS (8%)</span><span>${formatarMoeda(sim.fgts)}</span></div>
        <div><span>Provisão 13º (1/12)</span><span>${formatarMoeda(sim.provisao13)}</span></div>
        <div><span>Provisão férias+1/3 (1/12)</span><span>${formatarMoeda(sim.provisaoFerias)}</span></div>
        <div><span>Encargos patronais (~${(sim.encargosAliquota * 100).toFixed(0)}%)</span><span>${formatarMoeda(sim.encargos)}</span></div>
        <div><span>Desconto VT (máx. 6%)</span><span>${formatarMoeda(sim.descontoVt)}</span></div>
        <div><span>VT pago pela loja</span><span>${formatarMoeda(sim.custoVtEmpresa)}</span></div>
        <div><span>Base IR / dedução</span><span>${formatarMoeda(sim.baseIr)} / ${formatarMoeda(sim.deducaoIr)}${sim.usouSimplificado ? " (simplificado)" : ""}</span></div>
      </div>
      ${this._htmlAlertas(sim.alertas)}
      <p class="folha-fonte">${escapeHtml(VIGENCIAS.fonte)} · Ref. ${VIGENCIAS.ano}</p>
    `;
  }

  _renderPj(sim) {
    if (!this.resultado) return;
    this.resultado.innerHTML = `
      <div class="folha-cards">
        <div class="folha-card">
          <span>Valor da NF (custo loja)</span>
          <strong>${formatarMoeda(sim.custoLoja)}</strong>
        </div>
        <div class="folha-card">
          <span>Líquido estimado do prestador</span>
          <strong class="sucesso">${formatarMoeda(sim.liquidoPrestador)}</strong>
        </div>
        <div class="folha-card">
          <span>Impostos estimados (${(sim.aliquotaImpostos * 100).toFixed(0)}%)</span>
          <strong>${formatarMoeda(sim.impostosEstimados)}</strong>
        </div>
        ${
          sim.meiDasMinimo != null
            ? `<div class="folha-card"><span>DAS MEI ~ (5% do mínimo)</span><strong>${formatarMoeda(sim.meiDasMinimo)}</strong></div>`
            : ""
        }
      </div>
      <p class="folha-aviso-legal">
        Pagamento PJ deve ser por <strong>serviço autônomo com NF</strong>.
        Se a pessoa trabalha como empregado (horário, chefia, exclusividade), o correto é <strong>CLT</strong>.
      </p>
      ${this._htmlAlertas(sim.alertas)}
      <p class="folha-fonte">${escapeHtml(VIGENCIAS.fonte)}</p>
    `;
  }

  _htmlAlertas(alertas) {
    if (!alertas?.length) return "";
    return `<ul class="folha-alertas">${alertas
      .map((a) => `<li>${escapeHtml(a)}</li>`)
      .join("")}</ul>`;
  }

  sugerirPj() {
    const aliqPct = Number(this.raiz.querySelector("#folha-aliq-pj").value);
    const aliq = Number.isFinite(aliqPct) ? aliqPct / 100 : 0.15;

    const salarioClt = Number(this.raiz.querySelector("#folha-salario")?.value);
    if (Number.isFinite(salarioClt) && salarioClt > 0) {
      const sim = simularClt({
        salarioBruto: salarioClt,
        dependentes: this.raiz.querySelector("#folha-dependentes").value || 0,
      });
      const nota = sugerirValorNotaParaLiquidoClt(sim.liquido, 1.35, aliq);
      this.selectTipo.value = TIPOS_VINCULO.PJ;
      this._alternarTipo();
      this.raiz.querySelector("#folha-valor-nota").value = String(nota);
      this.raiz.querySelector("#folha-liquido-desejado").value = String(sim.liquido);
      this.calcular();
      notificar(
        `NF sugerida ${formatarMoeda(nota)} para aproximar líquido CLT + benefícios.`,
        "sucesso"
      );
      return;
    }

    const desejado = Number(
      this.raiz.querySelector("#folha-liquido-desejado")?.value
    );
    if (!Number.isFinite(desejado) || desejado <= 0) {
      notificar(
        "Informe um salário bruto CLT ou o líquido desejado na aba PJ.",
        "alerta"
      );
      return;
    }

    const nota = sugerirValorNotaParaLiquidoClt(desejado, 1.35, aliq);
    this.selectTipo.value = TIPOS_VINCULO.PJ;
    this._alternarTipo();
    this.raiz.querySelector("#folha-valor-nota").value = String(nota);
    this.calcular();
    notificar(`NF sugerida: ${formatarMoeda(nota)}`, "sucesso");
  }

  async salvarVinculo() {
    const id = this.selectFunc?.value;
    if (!id) {
      notificar("Selecione um funcionário para salvar o vínculo.", "alerta");
      return;
    }
    const tipo = this.selectTipo.value;
    const payload = {
      tipoVinculo: tipo,
      salarioBruto:
        tipo === TIPOS_VINCULO.CLT
          ? Number(this.raiz.querySelector("#folha-salario").value) || null
          : null,
      dependentes:
        tipo === TIPOS_VINCULO.CLT
          ? Number(this.raiz.querySelector("#folha-dependentes").value) || 0
          : 0,
      valorContrato:
        tipo !== TIPOS_VINCULO.CLT
          ? Number(this.raiz.querySelector("#folha-valor-nota").value) || null
          : null,
    };

    try {
      await atualizarDadosRemuneracao(id, payload);
      notificar("Vínculo e valores salvos no cadastro.", "sucesso");
    } catch (erro) {
      notificar(erro.message || "Falha ao salvar.", "erro");
    }
  }

  async registrarDespesa() {
    if (!this.ultimaSimulacao) {
      notificar("Calcule a simulação antes de registrar.", "alerta");
      return;
    }
    const func = (this.obterFuncionarios() || []).find(
      (f) => f.id === this.selectFunc?.value
    );
    const nome = func?.nome || "";
    const valor =
      this.ultimaSimulacao.tipo === TIPOS_VINCULO.CLT
        ? this.ultimaSimulacao.custoMensalEmpresa
        : this.ultimaSimulacao.custoLoja;

    try {
      await criarDespesa({
        tipo: "folha",
        descricao: resumoPagamentoTexto(this.ultimaSimulacao, nome),
        valor,
        competencia: competenciaDe(new Date()),
        recorrente: true,
      });
      notificar(
        `Despesa de folha registrada: ${formatarMoeda(valor)}`,
        "sucesso"
      );
    } catch (erro) {
      notificar(erro.message || "Falha ao registrar despesa.", "erro");
    }
  }
}
