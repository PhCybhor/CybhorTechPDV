import {
  Chart,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";
import { gerarResumo, vendasDoDia } from "../services/relatorioService.js";
import { gerarPdfVendasDia } from "../services/pdfService.js";
import {
  resumirFechamento,
  registrarFechamento,
} from "../services/fechamentoService.js";
import { somarSangriasDoDia } from "../services/sangriaService.js";
import {
  lerEstadoCaixa,
  somarSuprimentosDoDia,
  somarVendasDinheiroDoDia,
  calcularDinheiroEsperado,
} from "../services/caixaCicloService.js";
import { formatarMoeda } from "../utils/formato.js";
import { escapeHtml } from "../utils/escape.js";
import { notificar } from "./notificacao.js";

/**
 * Converte uma data em string ISO local (AAAA-MM-DD), sem efeito de fuso.
 * @param {Date} data
 * @returns {string}
 */
function paraIsoLocal(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
  Legend
);

const CORES = {
  primaria: "#3b82f6",
  primariaSuave: "rgba(59, 130, 246, 0.85)",
  sucesso: "#22c55e",
  texto: "#8fa3bc",
  grade: "rgba(143, 163, 188, 0.1)",
};

Chart.defaults.color = CORES.texto;
Chart.defaults.font.family = "Segoe UI, system-ui, sans-serif";
Chart.defaults.animation = false;

/**
 * Painel de relatorios do administrador: cartoes de resumo, graficos de
 * mais vendidos no mes, receita diaria e ranking de produtos em alta.
 */
export class Dashboard {
  /**
   * @param {{
   *   raiz: HTMLElement,
   *   obterFuncionario?: () => object | null,
   *   obterProdutos?: () => Array<object>,
   *   obterDespesas?: () => Array<object>,
   *   obterSangrias?: () => Array<object>,
   *   obterSuprimentos?: () => Array<object>,
   * }} opcoes
   */
  constructor({
    raiz,
    obterFuncionario = () => null,
    obterProdutos = () => [],
    obterDespesas = () => [],
    obterSangrias = () => [],
    obterSuprimentos = () => [],
  }) {
    this.raiz = raiz;
    this.obterFuncionario = obterFuncionario;
    this.obterProdutos = obterProdutos;
    this.obterDespesas = obterDespesas;
    this.obterSangrias = obterSangrias;
    this.obterSuprimentos = obterSuprimentos;
    this.graficoMaisVendidos = null;
    this.graficoReceitaDiaria = null;
    this.vendasAtuais = [];
    this._configurarPainelDia();
    this._configurarFechamento();
    this._configurarAbas();
  }

  _configurarAbas() {
    const abas = this.raiz.querySelectorAll("[data-aba-relatorio]");
    if (!abas.length) return;
    abas.forEach((botao) => {
      botao.addEventListener("click", () => {
        const id = botao.getAttribute("data-aba-relatorio");
        abas.forEach((b) => {
          const ativo = b === botao;
          b.classList.toggle("ativo", ativo);
          b.setAttribute("aria-selected", ativo ? "true" : "false");
        });
        this.raiz.querySelectorAll("[data-painel-relatorio]").forEach((painel) => {
          const mostrar =
            painel.getAttribute("data-painel-relatorio") === id;
          painel.classList.toggle("oculto", !mostrar);
          painel.classList.toggle("ativo", mostrar);
        });
      });
    });
  }

  /**
   * Atualiza todo o painel com a lista de vendas mais recente.
   * @param {Array<object>} vendas
   */
  atualizar(vendas) {
    this.vendasAtuais = Array.isArray(vendas) ? vendas : [];
    const resumo = gerarResumo(this.vendasAtuais, {
      produtos: this.obterProdutos(),
      despesas: this.obterDespesas(),
    });
    this._atualizarCartoes(resumo);
    this._atualizarGraficoMaisVendidos(resumo.maisVendidosMes);
    this._atualizarGraficoReceitaDiaria(resumo.serieReceitaDiaria);
    this._atualizarEmAlta(resumo.emAltaRecente);
    this._atualizarVendasComDesconto(resumo.vendasComDesconto);
    this._renderizarDiaSelecionado();
    this._renderizarFechamento();
  }

  _configurarFechamento() {
    this.raiz
      .querySelector("#btn-fechar-caixa")
      ?.addEventListener("click", () => this._salvarFechamento());
  }

  _renderizarFechamento() {
    const resumo = resumirFechamento(this.vendasAtuais);
    const totalSangrias = somarSangriasDoDia(this.obterSangrias());
    const el = this.raiz.querySelector("#fechamento-resumo");
    const detalhe = this.raiz.querySelector("#fechamento-detalhe");
    if (!el) return;

    el.innerHTML = `
      <div class="resumo-dia-item">
        <span class="resumo-dia-rotulo">Vendas feitas</span>
        <span class="resumo-dia-valor">${resumo.quantidadeVendas}</span>
      </div>
      <div class="resumo-dia-item">
        <span class="resumo-dia-rotulo">Itens vendidos</span>
        <span class="resumo-dia-valor">${resumo.itensVendidos}</span>
      </div>
      <div class="resumo-dia-item">
        <span class="resumo-dia-rotulo">Total que entrou</span>
        <span class="resumo-dia-valor resumo-dia-valor--sucesso">${formatarMoeda(resumo.totalLiquido)}</span>
      </div>
      <div class="resumo-dia-item">
        <span class="resumo-dia-rotulo">Tirei do caixa</span>
        <span class="resumo-dia-valor resumo-dia-valor--alerta">${formatarMoeda(totalSangrias)}</span>
      </div>
      <div class="resumo-dia-item">
        <span class="resumo-dia-rotulo">Vendas canceladas</span>
        <span class="resumo-dia-valor">${resumo.quantidadeCanceladas}</span>
      </div>
      <div class="resumo-dia-item">
        <span class="resumo-dia-rotulo">Deveria ter na gaveta</span>
        <span class="resumo-dia-valor" id="fechamento-dinheiro-esperado">…</span>
      </div>`;

    lerEstadoCaixa()
      .then((estadoCaixa) => {
        const esperado = calcularDinheiroEsperado({
          fundoInicial: estadoCaixa.fundoInicial,
          suprimentosDia: somarSuprimentosDoDia(this.obterSuprimentos()),
          vendasDinheiro: somarVendasDinheiroDoDia(this.vendasAtuais),
          sangriasDia: totalSangrias,
        });
        const elEsp = this.raiz.querySelector("#fechamento-dinheiro-esperado");
        if (elEsp) elEsp.textContent = formatarMoeda(esperado);
      })
      .catch(() => {
        const elEsp = this.raiz.querySelector("#fechamento-dinheiro-esperado");
        if (elEsp) elEsp.textContent = "—";
      });

    if (detalhe) {
      const formas = Object.entries(resumo.porForma)
        .map(
          ([forma, total]) =>
            `<div class="desconto-linha"><span>${escapeHtml(forma)}</span><span class="desconto-total">${formatarMoeda(total)}</span></div>`
        )
        .join("");
      detalhe.innerHTML =
        `<div class="desconto-cabecalho" style="grid-template-columns:1fr 1fr"><span>Como pagaram</span><span>Total</span></div>` +
        (formas || '<p class="ranking-vazio">Nenhuma venda hoje ainda.</p>');
    }
  }

  async _salvarFechamento() {
    const funcionario = this.obterFuncionario();
    if (!funcionario) {
      notificar("Faça login novamente.", "alerta");
      return;
    }
    try {
      const resumo = resumirFechamento(this.vendasAtuais);
      const totalSangrias = somarSangriasDoDia(this.obterSangrias());
      const estadoCaixa = await lerEstadoCaixa();
      const suprimentosDia = somarSuprimentosDoDia(this.obterSuprimentos());
      const vendasDinheiro = somarVendasDinheiroDoDia(this.vendasAtuais);
      const dinheiroEsperado = calcularDinheiroEsperado({
        fundoInicial: estadoCaixa.fundoInicial,
        suprimentosDia,
        vendasDinheiro,
        sangriasDia: totalSangrias,
      });
      await registrarFechamento(
        {
          ...resumo,
          totalSangrias,
          fundoInicial: estadoCaixa.fundoInicial,
          suprimentosDia,
          vendasDinheiro,
          dinheiroEsperado,
        },
        funcionario
      );
      notificar(
        `Fechamento salvo: entrou ${formatarMoeda(resumo.totalLiquido)} · na gaveta deveria ter ${formatarMoeda(dinheiroEsperado)}`,
        "sucesso"
      );
    } catch (erro) {
      notificar(erro.message || "Falha ao registrar fechamento.", "erro");
    }
  }

  /** Configura o seletor de data (ultimos 12 meses) e o botao de PDF. */
  _configurarPainelDia() {
    const inputData = this.raiz.querySelector("#relatorio-data");
    const hoje = new Date();
    const minimo = new Date(
      hoje.getFullYear(),
      hoje.getMonth() - 12,
      hoje.getDate()
    );

    inputData.max = paraIsoLocal(hoje);
    inputData.min = paraIsoLocal(minimo);
    inputData.value = paraIsoLocal(hoje);

    inputData.addEventListener("change", () => this._renderizarDiaSelecionado());

    this.raiz
      .querySelector("#btn-gerar-pdf")
      .addEventListener("click", () => this._gerarPdf());
  }

  /** Renderiza o resumo e a tabela do dia selecionado no seletor de data. */
  _renderizarDiaSelecionado() {
    const dataISO = this.raiz.querySelector("#relatorio-data").value;
    if (!dataISO) return;

    const resumo = vendasDoDia(this.vendasAtuais, dataISO);
    const containerResumo = this.raiz.querySelector("#resumo-dia");
    const containerTabela = this.raiz.querySelector("#tabela-dia");

    containerResumo.innerHTML = `
      <div class="resumo-dia-item">
        <span class="resumo-dia-rotulo">Vendas feitas</span>
        <span class="resumo-dia-valor">${resumo.quantidadeVendas}</span>
      </div>
      <div class="resumo-dia-item">
        <span class="resumo-dia-rotulo">Itens vendidos</span>
        <span class="resumo-dia-valor">${resumo.itensVendidos}</span>
      </div>
      <div class="resumo-dia-item">
        <span class="resumo-dia-rotulo">Dinheiro que entrou</span>
        <span class="resumo-dia-valor resumo-dia-valor--sucesso">${formatarMoeda(
          resumo.totalLiquido
        )}</span>
      </div>
      <div class="resumo-dia-item">
        <span class="resumo-dia-rotulo">Descontos dados</span>
        <span class="resumo-dia-valor resumo-dia-valor--alerta">${formatarMoeda(
          resumo.totalDescontos
        )}</span>
      </div>`;

    if (resumo.vendas.length === 0) {
      containerTabela.innerHTML =
        '<p class="ranking-vazio">Nenhuma venda registrada neste dia.</p>';
      return;
    }

    const cabecalho = `
      <div class="desconto-cabecalho">
        <span>Hora</span>
        <span>Funcionário</span>
        <span>Subtotal</span>
        <span>Desconto</span>
        <span>Total</span>
      </div>`;

    const linhas = resumo.vendas
      .map((venda) => {
        const hora = new Date(venda.criadoEm).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        });
        const subtotal =
          Number(venda.subtotal) ||
          Number(venda.total) + (Number(venda.desconto) || 0);
        return `
        <div class="desconto-linha">
          <span title="${hora}">${hora}</span>
          <span title="${escapeHtml(venda.funcionarioNome || "-")}">${escapeHtml(venda.funcionarioNome || "-")}</span>
          <span>${formatarMoeda(subtotal)}</span>
          <span class="desconto-valor">- ${formatarMoeda(venda.desconto || 0)}</span>
          <span class="desconto-total">${formatarMoeda(venda.total)}</span>
        </div>`;
      })
      .join("");

    containerTabela.innerHTML = cabecalho + linhas;
  }

  /** Gera o PDF do dia selecionado. */
  async _gerarPdf() {
    const dataISO = this.raiz.querySelector("#relatorio-data").value;
    if (!dataISO) {
      notificar("Selecione uma data para gerar o PDF.", "alerta");
      return;
    }

    try {
      const resumo = vendasDoDia(this.vendasAtuais, dataISO);
      await gerarPdfVendasDia(dataISO, resumo);
      notificar("PDF gerado com sucesso.", "sucesso");
    } catch (erro) {
      notificar("Não foi possível gerar o PDF.", "erro");
    }
  }

  _atualizarCartoes(resumo) {
    this.raiz.querySelector("#card-total-hoje").textContent = formatarMoeda(
      resumo.totalHoje
    );
    this.raiz.querySelector("#card-qtd-hoje").textContent =
      `${resumo.quantidadeVendasHoje} venda(s)`;
    this.raiz.querySelector("#card-total-mes").textContent = formatarMoeda(
      resumo.totalMes
    );
    this.raiz.querySelector("#card-total-descontos").textContent = formatarMoeda(
      resumo.totalDescontosMes
    );

    const lucroBruto = this.raiz.querySelector("#card-lucro-bruto");
    const cmv = this.raiz.querySelector("#card-cmv-mes");
    const despesas = this.raiz.querySelector("#card-despesas-mes");
    const lucroLiq = this.raiz.querySelector("#card-lucro-liquido");
    const ponto = this.raiz.querySelector("#card-ponto-equilibrio");
    const alerta = this.raiz.querySelector("#alerta-lucro-custo");

    if (lucroBruto) lucroBruto.textContent = formatarMoeda(resumo.lucroBrutoMes || 0);
    if (cmv) {
      cmv.textContent = `Você pagou ${formatarMoeda(resumo.cmvMes || 0)} nos produtos vendidos`;
    }
    if (despesas) despesas.textContent = formatarMoeda(resumo.despesasMes || 0);

    const cardSangrias = this.raiz.querySelector("#card-sangrias-hoje");
    if (cardSangrias) {
      cardSangrias.textContent = formatarMoeda(
        somarSangriasDoDia(this.obterSangrias())
      );
    }

    const despesasNoLucro = this.raiz.querySelector("#card-despesas-no-lucro");
    if (despesasNoLucro) {
      const contas = resumo.despesasMes || 0;
      despesasNoLucro.textContent =
        contas > 0
          ? `Já tirou ${formatarMoeda(contas)} de contas (aluguel, luz…)`
          : "Cadastre as contas na aba Contas para ver o lucro de verdade";
    }

    if (lucroLiq) {
      lucroLiq.textContent = formatarMoeda(resumo.lucroLiquidoMes || 0);
      lucroLiq.classList.toggle(
        "alerta",
        (resumo.lucroLiquidoMes || 0) < 0
      );
      lucroLiq.classList.toggle(
        "sucesso",
        (resumo.lucroLiquidoMes || 0) >= 0
      );
    }
    if (ponto) {
      ponto.textContent =
        resumo.pontoEquilibrio != null
          ? `Para empatar as contas, venda pelo menos ${formatarMoeda(resumo.pontoEquilibrio)}`
          : "Meta mínima: cadastre o custo dos produtos";
    }
    if (alerta) {
      const semCusto = Number(resumo.produtosSemCusto) || 0;
      if (semCusto > 0) {
        alerta.textContent = `${semCusto} produto(s) sem “quanto você pagou” — o lucro só conta os que têm custo preenchido.`;
        alerta.classList.remove("oculto");
      } else {
        alerta.classList.add("oculto");
        alerta.textContent = "";
      }
    }
  }

  _atualizarGraficoMaisVendidos(itens) {
    const canvas = this.raiz.querySelector("#grafico-mais-vendidos");
    const vazio = this.raiz.querySelector("#mais-vendidos-vazio");
    vazio.classList.toggle("oculto", itens.length > 0);

    const dados = {
      labels: itens.map((i) => i.nome),
      datasets: [
        {
          label: "Quantidade vendida",
          data: itens.map((i) => i.quantidade),
          backgroundColor: CORES.primariaSuave,
          borderRadius: 8,
          borderSkipped: false,
        },
      ],
    };

    if (this.graficoMaisVendidos) {
      this.graficoMaisVendidos.data = dados;
      this.graficoMaisVendidos.update();
      return;
    }

    this.graficoMaisVendidos = new Chart(canvas, {
      type: "bar",
      data: dados,
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: CORES.grade }, ticks: { precision: 0 } },
          y: { grid: { display: false } },
        },
      },
    });
  }

  _atualizarGraficoReceitaDiaria(serie) {
    const canvas = this.raiz.querySelector("#grafico-receita-diaria");

    const dados = {
      labels: serie.rotulos,
      datasets: [
        {
          label: "Receita",
          data: serie.valores,
          borderColor: CORES.sucesso,
          backgroundColor: "rgba(34, 197, 94, 0.12)",
          fill: true,
          tension: 0.35,
          pointRadius: 5,
          pointBackgroundColor: CORES.sucesso,
          pointBorderColor: "#0c1a2e",
          pointBorderWidth: 2,
        },
      ],
    };

    if (this.graficoReceitaDiaria) {
      this.graficoReceitaDiaria.data = dados;
      this.graficoReceitaDiaria.update();
      return;
    }

    this.graficoReceitaDiaria = new Chart(canvas, {
      type: "line",
      data: dados,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => formatarMoeda(ctx.parsed.y),
            },
          },
        },
        scales: {
          x: { grid: { color: CORES.grade } },
          y: {
            grid: { color: CORES.grade },
            ticks: { callback: (valor) => formatarMoeda(valor) },
          },
        },
      },
    });
  }

  _atualizarEmAlta(itens) {
    const lista = this.raiz.querySelector("#lista-em-alta");

    if (itens.length === 0) {
      lista.innerHTML =
        '<p class="ranking-vazio">Sem vendas nos últimos dias.</p>';
      return;
    }

    lista.innerHTML = itens
      .map(
        (item, indice) => `
      <div class="ranking-item">
        <span class="ranking-posicao">${indice + 1}</span>
        <div class="ranking-info">
          <span class="ranking-nome">${escapeHtml(item.nome)}</span>
          <span class="ranking-meta">${item.quantidade} un · ${formatarMoeda(
            item.receita
          )}</span>
        </div>
      </div>`
      )
      .join("");
  }

  _atualizarVendasComDesconto(vendas) {
    const container = this.raiz.querySelector("#tabela-descontos");

    if (!vendas || vendas.length === 0) {
      container.innerHTML =
        '<p class="ranking-vazio">Nenhuma venda com desconto registrada.</p>';
      return;
    }

    const cabecalho = `
      <div class="desconto-cabecalho">
        <span>Data</span>
        <span>Funcionário</span>
        <span>Subtotal</span>
        <span>Desconto</span>
        <span>Total pago</span>
      </div>`;

    const linhas = vendas
      .map((venda) => {
        const data = new Date(venda.criadoEm).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        });
        const subtotal = Number(venda.subtotal) || venda.total + (venda.desconto || 0);
        return `
        <div class="desconto-linha">
          <span>${data}</span>
          <span>${escapeHtml(venda.funcionarioNome || "-")}</span>
          <span>${formatarMoeda(subtotal)}</span>
          <span class="desconto-valor">- ${formatarMoeda(venda.desconto)}</span>
          <span class="desconto-total">${formatarMoeda(venda.total)}</span>
        </div>`;
      })
      .join("");

    container.innerHTML = cabecalho + linhas;
  }
}
