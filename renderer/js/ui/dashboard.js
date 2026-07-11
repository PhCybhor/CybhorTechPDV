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
  /** @param {{raiz: HTMLElement}} opcoes */
  constructor({ raiz }) {
    this.raiz = raiz;
    this.graficoMaisVendidos = null;
    this.graficoReceitaDiaria = null;
    this.vendasAtuais = [];
    this._configurarPainelDia();
  }

  /**
   * Atualiza todo o painel com a lista de vendas mais recente.
   * @param {Array<object>} vendas
   */
  atualizar(vendas) {
    this.vendasAtuais = Array.isArray(vendas) ? vendas : [];
    const resumo = gerarResumo(this.vendasAtuais);
    this._atualizarCartoes(resumo);
    this._atualizarGraficoMaisVendidos(resumo.maisVendidosMes);
    this._atualizarGraficoReceitaDiaria(resumo.serieReceitaDiaria);
    this._atualizarEmAlta(resumo.emAltaRecente);
    this._atualizarVendasComDesconto(resumo.vendasComDesconto);
    this._renderizarDiaSelecionado();
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
        <span class="resumo-dia-rotulo">Vendas</span>
        <span class="resumo-dia-valor">${resumo.quantidadeVendas}</span>
      </div>
      <div class="resumo-dia-item">
        <span class="resumo-dia-rotulo">Itens vendidos</span>
        <span class="resumo-dia-valor">${resumo.itensVendidos}</span>
      </div>
      <div class="resumo-dia-item">
        <span class="resumo-dia-rotulo">Total recebido</span>
        <span class="resumo-dia-valor resumo-dia-valor--sucesso">${formatarMoeda(
          resumo.totalLiquido
        )}</span>
      </div>
      <div class="resumo-dia-item">
        <span class="resumo-dia-rotulo">Descontos</span>
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
        <span>Funcionario</span>
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
      notificar("Nao foi possivel gerar o PDF.", "erro");
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
        '<p class="ranking-vazio">Sem vendas nos ultimos dias.</p>';
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
        <span>Funcionario</span>
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
