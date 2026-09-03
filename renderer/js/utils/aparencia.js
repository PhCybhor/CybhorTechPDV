/**
 * Aplica tema, tipografia, tamanho e opções do caixa a partir da config da loja.
 */

export const FONTES_UI = Object.freeze({
  sistema: {
    rotulo: "Sistema (Segoe UI)",
    css: '"Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif',
  },
  moderna: {
    rotulo: "Moderna (DM Sans)",
    css: '"DM Sans", "Segoe UI", system-ui, sans-serif',
  },
  legivel: {
    rotulo: "Alta legibilidade (Source Sans 3)",
    css: '"Source Sans 3", "Segoe UI", system-ui, sans-serif',
  },
  tecnica: {
    rotulo: "Técnica (IBM Plex Sans)",
    css: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
  },
});

export const TAMANHOS_UI = Object.freeze({
  pequeno: { rotulo: "Pequeno", px: "13px" },
  medio: { rotulo: "Médio", px: "15px" },
  grande: { rotulo: "Grande", px: "17px" },
  enorme: { rotulo: "Enorme", px: "20px" },
});

export const TEMAS = Object.freeze({
  escuro: "Escuro",
  claro: "Claro (branco)",
});

/** Módulos que o admin pode desligar na loja (exceto PDV e Configurações). */
export const MODULOS_LOJA = Object.freeze([
  { chave: "moduloProdutos", rota: "produtos", rotulo: "Produtos" },
  { chave: "moduloHistorico", rota: "historico", rotulo: "Histórico de vendas" },
  { chave: "moduloClientes", rota: "clientes", rotulo: "Clientes" },
  { chave: "moduloRelatorios", rota: "relatorios", rotulo: "Relatórios" },
  { chave: "moduloFornecedores", rota: "fornecedores", rotulo: "Fornecedores" },
  { chave: "moduloGestao", rota: "gestao", rotulo: "Estoque e finanças" },
  { chave: "moduloAssistente", rota: "assistente", rotulo: "Assistente CybhorIA" },
  { chave: "moduloFuncionarios", rota: "funcionarios", rotulo: "Equipe / Folha" },
]);

/**
 * @param {object | null | undefined} config
 */
export function aplicarAparencia(config) {
  const cfg = config && typeof config === "object" ? config : {};
  const html = document.documentElement;
  const tema = cfg.tema === "claro" ? "claro" : "escuro";
  const fonte = FONTES_UI[cfg.fonteUi] ? cfg.fonteUi : "sistema";
  const densidade = cfg.densidadeUi === "compacta" ? "compacta" : "confortavel";
  const tamanho = TAMANHOS_UI[cfg.tamanhoUi] ? cfg.tamanhoUi : "medio";

  html.dataset.tema = tema;
  html.dataset.fonte = fonte;
  html.dataset.densidade = densidade;
  html.dataset.tamanho = tamanho;
  html.dataset.animacoes = cfg.reduzirAnimacoes ? "reduzidas" : "normais";
  html.style.setProperty("--fonte-ui", FONTES_UI[fonte].css);
  html.style.setProperty("--fonte-tamanho", TAMANHOS_UI[tamanho].px);
  document.body?.classList.toggle("tema-claro", tema === "claro");
}

export const CAMPOS_CADASTRO_PRODUTO = Object.freeze([
  { chave: "campoProdutoCusto", wrapId: "wrap-produto-custo", rotulo: "Valor pago / custo e margem" },
  { chave: "campoProdutoCodigos", wrapId: "wrap-produto-codigos", rotulo: "Código de barras e código interno" },
  { chave: "campoProdutoCategoria", wrapId: "wrap-produto-categoria", rotulo: "Categoria" },
  { chave: "campoProdutoUnidade", wrapId: "wrap-produto-unidade", rotulo: "Unidade (un / kg)" },
  { chave: "campoProdutoCaixa", wrapId: "wrap-produto-caixa", rotulo: "Unidades por caixa" },
  { chave: "campoProdutoValidade", wrapId: "wrap-produto-validade", rotulo: "Validade" },
  { chave: "campoProdutoPromocao", wrapId: "wrap-produto-promo", rotulo: "Promoção" },
]);

/**
 * Mostra ou esconde campos opcionais do cadastro de produto.
 * @param {object | null | undefined} config
 */
export function aplicarCamposCadastroProduto(config) {
  const cfg = config && typeof config === "object" ? config : {};
  for (const campo of CAMPOS_CADASTRO_PRODUTO) {
    alternarOculto(campo.wrapId, cfg[campo.chave] === false);
  }
}

/**
 * Mostra ou esconde cliente, fiado e desconto no caixa.
 * @param {object | null | undefined} config
 */
export function aplicarOpcoesCaixa(config) {
  const cfg = config && typeof config === "object" ? config : {};
  const ocultarCliente = Boolean(cfg.ocultarCliente);
  const ocultarFiado = Boolean(cfg.ocultarFiado) || ocultarCliente;
  const ocultarDesconto = Boolean(cfg.ocultarDesconto);

  alternarOculto("bloco-pdv-cliente", ocultarCliente);
  alternarOculto("bloco-pdv-fiado", ocultarFiado);
  alternarOculto("bloco-pdv-desconto", ocultarDesconto);

  if (ocultarCliente) {
    const sel = document.getElementById("pdv-cliente");
    if (sel) sel.value = "";
    document.getElementById("pdv-cliente-chip")?.classList.add("oculto");
  }
  if (ocultarFiado) {
    const fiado = document.getElementById("check-venda-fiado");
    if (fiado) fiado.checked = false;
  }
  if (ocultarDesconto) {
    const desc = document.getElementById("carrinho-desconto");
    if (desc) desc.value = "";
  }
}

/**
 * @param {string} rota
 * @param {object | null | undefined} config
 * @returns {boolean}
 */
export function moduloRotaAtivo(rota, config) {
  const cfg = config && typeof config === "object" ? config : {};
  if (rota === "clientes" && cfg.ocultarCliente) return false;
  const item = MODULOS_LOJA.find((m) => m.rota === rota);
  if (!item) return true;
  return cfg[item.chave] !== false;
}

/**
 * @param {string} id
 * @param {boolean} ocultar
 */
function alternarOculto(id, ocultar) {
  document.getElementById(id)?.classList.toggle("oculto", ocultar);
}
