import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * Formata um valor como moeda para o PDF, evitando caracteres especiais
 * (espaco nao separavel) que podem nao renderizar bem nas fontes do jsPDF.
 * @param {number} valor
 * @returns {string}
 */
function moedaPdf(valor) {
  const numero = (Number(valor) || 0).toFixed(2).replace(".", ",");
  return `R$ ${numero}`;
}

/**
 * Formata uma data ISO (AAAA-MM-DD) para o formato brasileiro.
 * @param {string} dataISO
 * @returns {string}
 */
function formatarDataExtenso(dataISO) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  const data = new Date(ano, mes - 1, dia);
  return data.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/**
 * Carrega o logo como data URL para inclusao no PDF.
 * @returns {Promise<string | null>}
 */
function carregarLogo() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d").drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = "assets/logo.png";
  });
}

/**
 * Gera e baixa um PDF com o relatorio de vendas de um dia.
 * @param {string} dataISO data no formato "AAAA-MM-DD"
 * @param {object} resumo resultado de vendasDoDia()
 * @returns {Promise<void>}
 */
export async function gerarPdfVendasDia(dataISO, resumo) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const largura = doc.internal.pageSize.getWidth();

  const logo = await carregarLogo();
  if (logo) doc.addImage(logo, "PNG", 14, 10, 18, 18);

  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42);
  doc.text("CybhorPDV", logo ? 36 : 14, 18);

  doc.setFontSize(12);
  doc.setTextColor(80, 80, 80);
  doc.text("Relatorio de vendas do dia", logo ? 36 : 14, 25);

  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);
  doc.text(formatarDataExtenso(dataISO), 14, 38);

  autoTable(doc, {
    startY: 44,
    theme: "plain",
    styles: { fontSize: 10 },
    body: [
      ["Vendas realizadas", String(resumo.quantidadeVendas)],
      ["Itens vendidos", String(resumo.itensVendidos)],
      ["Total bruto", moedaPdf(resumo.totalBruto)],
      ["Descontos concedidos", moedaPdf(resumo.totalDescontos)],
      ["Total liquido recebido", moedaPdf(resumo.totalLiquido)],
    ],
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 60 },
      1: { halign: "right", cellWidth: 50 },
    },
    tableWidth: 110,
  });

  const linhas = resumo.vendas.map((venda) => {
    const hora = new Date(venda.criadoEm).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const qtdItens = (venda.itens || []).reduce(
      (s, i) => s + (Number(i.quantidade) || 0),
      0
    );
    const subtotal =
      Number(venda.subtotal) || Number(venda.total) + (Number(venda.desconto) || 0);
    return [
      hora,
      venda.funcionarioNome || "-",
      String(qtdItens),
      moedaPdf(subtotal),
      moedaPdf(venda.desconto || 0),
      moedaPdf(venda.total),
      venda.formaPagamento || "-",
    ];
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 8,
    head: [
      ["Hora", "Funcionario", "Itens", "Subtotal", "Desconto", "Total", "Pagamento"],
    ],
    body: linhas.length > 0 ? linhas : [["-", "Sem vendas neste dia", "-", "-", "-", "-", "-"]],
    headStyles: { fillColor: [37, 99, 235], textColor: 255 },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
    },
  });

  const geradoEm = new Date().toLocaleString("pt-BR");
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`Gerado em ${geradoEm}`, 14, doc.internal.pageSize.getHeight() - 10);

  doc.save(`CybhorPDV-Vendas-${dataISO}.pdf`);
}
