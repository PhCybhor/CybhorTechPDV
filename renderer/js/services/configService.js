/**
 * Configurações da loja / impressora (persistidas no Electron userData).
 */

/**
 * @returns {Promise<object>}
 */
export async function obterConfigApp() {
  if (!window.pdvAPI?.obterConfigApp) {
    return {
      lojaNome: "CybhorPDV",
      lojaCnpj: "",
      lojaEndereco: "",
      lojaTelefone: "",
      impressoraNome: "",
      impressoraModo: "",
      impressoraPorta: "",
      estoqueMinimo: 5,
      tema: "escuro",
      fonteUi: "sistema",
      densidadeUi: "confortavel",
      tamanhoUi: "medio",
      reduzirAnimacoes: false,
      ocultarFiado: false,
      ocultarDesconto: false,
      ocultarCliente: false,
      campoProdutoCusto: true,
      campoProdutoCodigos: true,
      campoProdutoCategoria: true,
      campoProdutoUnidade: true,
      campoProdutoCaixa: true,
      campoProdutoValidade: true,
      campoProdutoPromocao: true,
      moduloProdutos: true,
      moduloHistorico: true,
      moduloClientes: true,
      moduloRelatorios: true,
      moduloFornecedores: true,
      moduloGestao: true,
      moduloAssistente: true,
      moduloFuncionarios: true,
    };
  }
  const resposta = await window.pdvAPI.obterConfigApp();
  if (!resposta?.ok) {
    throw new Error(resposta?.mensagem || "Falha ao ler configurações.");
  }
  return resposta.config;
}

/**
 * @param {object} config
 * @returns {Promise<object>}
 */
export async function salvarConfigApp(config) {
  if (!window.pdvAPI?.salvarConfigApp) {
    throw new Error("API de configuração indisponível neste ambiente.");
  }
  const resposta = await window.pdvAPI.salvarConfigApp(config);
  if (!resposta?.ok) {
    throw new Error(resposta?.mensagem || "Falha ao salvar configurações.");
  }
  return resposta.config;
}

/**
 * @returns {Promise<Array<{nome: string, padrao: boolean}>>}
 */
export async function listarImpressoras() {
  if (!window.pdvAPI?.listarImpressoras) return [];
  const resposta = await window.pdvAPI.listarImpressoras();
  return resposta?.impressoras || [];
}
