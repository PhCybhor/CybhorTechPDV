import {
  existeAdministrador,
  autenticar,
  criarFuncionario,
  validarAdministrador,
  observarFuncionarios,
  encerrarSessao,
  CARGOS,
} from "./services/authService.js";
import {
  observarProdutos,
  criarProduto,
  atualizarProduto,
  excluirProduto,
  ajustarEstoque,
  encontrarPorCodigoBarras,
  listarEstoqueBaixo,
  importarProdutosCsv,
  calcularMargemPercentual,
  sugerirPrecoPorCusto,
} from "./services/produtoService.js";
import { registrarVenda, observarVendas } from "./services/vendaService.js";
import { imprimirCupomVenda } from "./services/impressaoService.js";
import { obterConfigApp } from "./services/configService.js";
import { definirTenant, obterMetaLoja } from "./services/tenantContext.js";
import { EVENTO_SESSAO_EXPIRADA, obterApiUrl } from "./config/apiClient.js";
import { atualizarIndice, buscar } from "./services/buscaFuzzy.js";
import { observarDespesas } from "./services/despesaService.js";
import { gerarResumo } from "./services/relatorioService.js";
import { Carrinho } from "./ui/carrinho.js";
import { PainelFuncionarios } from "./ui/funcionarios.js";
import { PainelProdutos } from "./ui/produtos.js";
import { PainelHistorico } from "./ui/historico.js";
import { PainelConfiguracoes } from "./ui/configuracoes.js";
import { PainelDespesas } from "./ui/despesas.js";
import { PainelAssistente } from "./ui/assistente.js";
import {
  lerAreasDoForm,
} from "./services/areasEquipe.js";
import { PainelFolha } from "./ui/folha.js";
import { PainelFornecedores } from "./ui/fornecedores.js";
import { PainelSangrias } from "./ui/sangrias.js";
import {
  observarFornecedores,
  listarFornecedoresParaReposicao,
  montarAlertaReposicaoTexto,
  rotuloTiposMercadoria,
} from "./services/fornecedorService.js";
import {
  observarSangrias,
} from "./services/sangriaService.js";
import { notificar } from "./ui/notificacao.js";
import { formatarMoeda } from "./utils/formato.js";
import { debounce } from "./utils/debounce.js";
import { escapeHtml } from "./utils/escape.js";
import {
  aplicarAparencia,
  aplicarOpcoesCaixa,
  aplicarCamposCadastroProduto,
  moduloRotaAtivo,
  MODULOS_LOJA,
} from "./utils/aparencia.js";
import {
  listarMaisUsados,
  alternarFavorito,
  registrarUsoProduto,
  lerPreferenciasCaixa,
  salvarMetaDia,
  parseBuscaComQuantidade,
  DICAS_OPERADOR,
} from "./services/caixaOperadorStore.js";
import { pode } from "./services/permissoesOperador.js";
import { instalarRevolucao } from "./revolucaoUi.js";
import { instalarMegaPack } from "./megaPack.js";

/** @type {Promise<void> | null} */
let carregandoRelatorios = null;

/**
 * Carrega o módulo de relatórios (chart.js / jspdf) sob demanda.
 * @returns {Promise<typeof import("./ui/dashboard.js").Dashboard>}
 */
async function carregarClasseDashboard() {
  if (globalThis.CybhorDashboard) return globalThis.CybhorDashboard;

  if (!carregandoRelatorios) {
    carregandoRelatorios = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "dist/relatorios.js";
      script.async = true;
      script.dataset.cybhorRelatorios = "1";
      script.onload = () => resolve();
      script.onerror = () => {
        carregandoRelatorios = null;
        reject(new Error("Falha ao carregar o módulo de relatórios."));
      };
      document.head.appendChild(script);
    });
  }

  await carregandoRelatorios;

  if (!globalThis.CybhorDashboard) {
    carregandoRelatorios = null;
    throw new Error("Módulo de relatórios não disponibilizou Dashboard.");
  }
  return globalThis.CybhorDashboard;
}


const ROTAS = [
  "pdv",
  "produtos",
  "fornecedores",
  "clientes",
  "gestao",
  "relatorios",
  "assistente",
  "funcionarios",
  "historico",
  "configuracoes",
];
const ROTAS_SOMENTE_ADMIN = [
  "fornecedores",
  "clientes",
  "gestao",
  "relatorios",
  "assistente",
  "funcionarios",
  "configuracoes",
];

const ROTULO_CARGO = {
  [CARGOS.ADMIN]: "Administrador",
  [CARGOS.OPERADOR]: "Operador",
};

const CHAVE_CARRINHO_PENDENTE = "cybhor:carrinho-pendente";
/** Janela anti-duplo bipe do mesmo código (scanners às vezes reenviam Enter). */
const BIPE_DEDUP_MS = 280;
let ultimoBipeChave = "";
let ultimoBipeEm = 0;

/**
 * @returns {boolean} true se havia itens e o snapshot foi gravado
 */
function capturarCarrinhoPendente() {
  const itens = estado.carrinho?.obterItens?.() || [];
  if (!itens.length) return false;
  try {
    const snapshot = {
      itens,
      desconto: Number(estado.carrinho?.obterDesconto?.()) || 0,
      forma: $("forma-pagamento")?.value || "dinheiro",
      recebido: Number(estado.carrinho?.obterValorRecebido?.()) || 0,
      em: Date.now(),
    };
    sessionStorage.setItem(CHAVE_CARRINHO_PENDENTE, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

function limparCarrinhoPendente() {
  try {
    sessionStorage.removeItem(CHAVE_CARRINHO_PENDENTE);
  } catch {
    /* ignore */
  }
}

/**
 * Após re-login, devolve itens capturados na expiração da sessão.
 * @returns {number} quantidade de itens restaurados
 */
function tentarRestaurarCarrinhoPendente() {
  let bruto;
  try {
    bruto = sessionStorage.getItem(CHAVE_CARRINHO_PENDENTE);
  } catch {
    return 0;
  }
  if (!bruto) return 0;
  limparCarrinhoPendente();
  let snapshot;
  try {
    snapshot = JSON.parse(bruto);
  } catch {
    return 0;
  }
  const itens = Array.isArray(snapshot?.itens) ? snapshot.itens : [];
  if (!itens.length || !estado.carrinho?.restaurarDeSnapshot) return 0;
  // Descarta snapshot velho (>12h) — evita surpresa no dia seguinte.
  if (snapshot.em && Date.now() - Number(snapshot.em) > 12 * 60 * 60 * 1000) {
    return 0;
  }
  estado.carrinho.restaurarDeSnapshot(itens);
  if (snapshot.desconto > 0 && estado.carrinho.inputDesconto) {
    estado.carrinho.desconto = Number(snapshot.desconto) || 0;
    estado.carrinho.inputDesconto.value = String(estado.carrinho.desconto);
  }
  if (snapshot.forma) {
    definirFormaPagamento(snapshot.forma);
  }
  if (snapshot.recebido > 0 && estado.carrinho.inputRecebido) {
    estado.carrinho.valorRecebido = Number(snapshot.recebido) || 0;
    estado.carrinho.inputRecebido.value = String(estado.carrinho.valorRecebido);
  }
  estado.carrinho._atualizarTotais?.();
  return itens.length;
}

/** Estado global mínimo da aplicação. */
const estado = {
  funcionario: null,
  produtos: [],
  vendas: [],
  carrinho: null,
  dashboard: null,
  painelFuncionarios: null,
  painelProdutos: null,
  painelHistorico: null,
  painelConfiguracoes: null,
  painelDespesas: null,
  painelSangrias: null,
  painelAssistente: null,
  painelFolha: null,
  painelFornecedores: null,
  cancelarObservacaoProdutos: null,
  cancelarObservacaoVendas: null,
  cancelarObservacaoFuncionarios: null,
  cancelarObservacaoDespesas: null,
  cancelarObservacaoFornecedores: null,
  cancelarObservacaoSangrias: null,
  despesas: [],
  sangrias: [],
  fornecedores: [],
  assinaturaProdutos: "",
  produtoExcluirId: null,
  /** @type {Array<{id: string, nomeAtual: string, nomeSugerido: string, motivo: string, aceito: boolean}>} */
  sugestoesNomesIa: [],
  rotaAtual: "pdv",
  /** Última venda finalizada, usada pelo botão de imprimir cupom. */
  ultimaVendaCupom: null,
  estoqueMinimo: 5,
  configLoja: null,
  categoriaFiltro: "",
  indiceDicaOperador: 0,
  listaFuncionarios: [],
  avisoFornecedoresIa: true,
  suprimentos: [],
  revolucao: null,
  mega: null,
  /** Evita double-click / F12 duplo na finalização. */
  finalizandoVenda: false,
};

const $ = (id) => document.getElementById(id);

/** Mantém o foco na busca do caixa (bip / digitação contínua). */
function focarBuscaProduto(atrasoMs = 0) {
  const aplicar = () => {
    const input = $("busca-produto");
    if (!input || estado.rotaAtual !== "pdv") return;
    input.focus();
  };
  if (atrasoMs > 0) setTimeout(aplicar, atrasoMs);
  else aplicar();
}


/** Features de mercado (Ctrl+K, pulso, split, etc.) — instalado uma vez. */
function obterRevolucao() {
  if (!estado.revolucao) {
    estado.revolucao = instalarRevolucao({
      estado,
      $,
      navegarPara,
      abrirModal,
      fecharModal,
      iniciarAssistente,
      iniciarRelatorios,
      gerarResumo,
    });
  }
  return estado.revolucao;
}

function obterMega() {
  if (!estado.mega) {
    estado.mega = instalarMegaPack({
      estado,
      $,
      navegarPara,
      abrirModal,
      fecharModal,
    });
  }
  return estado.mega;
}

/**
 * Exibe mensagem de erro no elemento, ou oculta se vazia.
 * @param {HTMLElement} el
 * @param {string} texto
 */
function setErro(el, texto) {
  el.textContent = texto || "";
  el.classList.toggle("oculto", !texto);
}

/**
 * Exibe apenas a tela raiz informada.
 * @param {string} idTela
 */
function mostrarTela(idTela) {
  [
    "tela-carregando",
    "tela-ativacao",
    "tela-setup",
    "tela-login",
    "tela-app",
  ].forEach((id) => {
    $(id)?.classList.toggle("oculto", id !== idTela);
  });
}

function abrirModal(id) {
  $(id).classList.remove("oculto");
}

function fecharModal(id) {
  $(id).classList.add("oculto");
}

/**
 * Navega entre rotas internas do app autenticado.
 * @param {string} rota
 */
function podeAgora(chave) {
  return pode(estado.funcionario, chave);
}

function podeAcessarRota(rota) {
  const func = estado.funcionario;
  if (!func) return false;
  if (func.cargo === CARGOS.ADMIN) return true;
  if (rota === "pdv") return true;
  if (rota === "produtos") {
    return (
      podeAgora("cadastrarProduto") ||
      podeAgora("editarProduto") ||
      podeAgora("excluirProduto") ||
      podeAgora("ajustarEstoque")
    );
  }
  if (rota === "historico") return podeAgora("verHistorico");
  if (rota === "clientes") return podeAgora("gerenciarClientes");
  if (ROTAS_SOMENTE_ADMIN.includes(rota)) return false;
  return true;
}

function navegarPara(rota) {
  if (!ROTAS.includes(rota)) return;
  if (!podeAcessarRota(rota)) {
    notificar("Você não tem permissão para esta área.", "alerta");
    return;
  }
  if (!moduloRotaAtivo(rota, estado.configLoja)) {
    notificar("Este módulo está desativado nas configurações.", "alerta");
    return;
  }

  estado.rotaAtual = rota;

  ROTAS.forEach((nome) => {
    $(`rota-${nome}`)?.classList.toggle("oculto", nome !== rota);
    const nav = $(`nav-${nome}`);
    if (nav) nav.classList.toggle("ativo", nome === rota);
  });

  // Vendas ficam observadas o tempo todo (meta, upsell, relatórios, histórico)
  iniciarObservacaoVendas();
  if (rota === "relatorios") iniciarRelatorios();
  if (rota === "historico") iniciarHistorico();
  if (rota === "assistente") iniciarAssistente();

  if (rota === "funcionarios") iniciarFuncionarios();
  else pararObservacaoFuncionarios();

  if (rota === "configuracoes") iniciarConfiguracoes();
  if (rota === "fornecedores") iniciarFornecedores();
  if (rota === "gestao") {
    obterMega().aoEntrarMega();
    estado.painelGestao?.renderizar();
  }
  if (rota === "clientes") {
    obterMega().aoEntrarMega();
  }

  if (rota === "pdv") {
    focarBuscaProduto(50);
  }
}

/* ---------------------------------------------------------------------------
 * Inicializacao
 * ------------------------------------------------------------------------- */

async function exibirVersaoApp() {
  try {
    const versao = await window.pdvAPI?.obterVersaoApp?.();
    if (!versao) return;
    document.title = `CybhorPDV ${versao}`;
    const rotulo = $("versao-app");
    if (rotulo) rotulo.textContent = `v${versao}`;
  } catch {
    /* rótulo de versão é só informativo */
  }
}

const CHAVE_OPCOES_CARRINHO_ABERTAS = "cybhor.carrinhoOpcoesAbertas";

/**
 * Lojas que usam muito fiado/cliente deixam o bloco aberto; o caixa
 * reabre do jeito que o operador deixou da última vez.
 */
function lembrarEstadoOpcoesCarrinho() {
  const bloco = $("carrinho-opcoes");
  if (!bloco) return;
  try {
    bloco.open = localStorage.getItem(CHAVE_OPCOES_CARRINHO_ABERTAS) === "1";
  } catch {
    bloco.open = false;
  }
  bloco.addEventListener("toggle", () => {
    try {
      localStorage.setItem(CHAVE_OPCOES_CARRINHO_ABERTAS, bloco.open ? "1" : "0");
    } catch {
      /* preferência visual; sem storage o bloco só volta fechado */
    }
  });
}

async function iniciar() {
  registrarEventosGerais();
  mostrarTela("tela-carregando");
  void exibirVersaoApp();
  lembrarEstadoOpcoesCarrinho();

  try {
    const configInicial = await obterConfigApp();
    estado.configLoja = configInicial;
    aplicarPreferenciasInterface(configInicial);
  } catch {
    aplicarPreferenciasInterface(null);
  }

  try {
    const licenca = await window.pdvAPI?.obterLicenca?.();
    if (!licenca?.ativada || !licenca.lojaId) {
      mostrarTela("tela-ativacao");
      void atualizarStatusConexao();
      return;
    }
    definirTenant(licenca.lojaId, {
      email: licenca.email,
      nomeLoja: licenca.nomeLoja,
      chave: licenca.chave,
    });
    const nomeLojaEl = $("login-loja-nome");
    if (nomeLojaEl) {
      nomeLojaEl.textContent = licenca.nomeLoja
        ? `Loja: ${licenca.nomeLoja}`
        : "";
    }
  } catch {
    mostrarTela("tela-ativacao");
    void atualizarStatusConexao();
    return;
  }

  try {
    const temAdmin = await existeAdministrador();
    mostrarTela(temAdmin ? "tela-login" : "tela-setup");
    const meta = obterMetaLoja();
    const nomeLojaEl = $("login-loja-nome");
    if (nomeLojaEl && meta?.nomeLoja) {
      nomeLojaEl.textContent = `Loja: ${meta.nomeLoja}`;
    }
  } catch {
    notificar(
      "Sem conexão com o servidor. Verifique a internet e tente novamente.",
      "erro",
      6000
    );
    atualizarBannerAssinatura(null);
  mostrarTela("tela-login");
  }
}

async function atualizarStatusConexao() {
  const el = $("ativacao-status-api");
  if (!el) return;
  el.classList.remove("ok", "erro");
  el.textContent = "Verificando conexão...";
  try {
    let resultado = await window.pdvAPI?.testarConexaoApi?.();
    // Fallback: testa direto do renderer se o processo principal falhar.
    if (!resultado?.ok) {
      try {
        const apiUrl = await obterApiUrl();
        const resposta = await fetch(`${apiUrl}/api/saude`, {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "omit",
        });
        const dados = await resposta.json().catch(() => ({}));
        if (resposta.ok && dados?.ok) {
          resultado = {
            ok: true,
            mensagem: "Conectado ao servidor CybhorPDV.",
            apiUrl,
          };
        }
      } catch {
        /* mantem resultado anterior */
      }
    }
    if (resultado?.ok) {
      el.classList.add("ok");
      el.textContent = "Servidor online — pode conectar sua loja.";
    } else {
      el.classList.add("erro");
      el.textContent =
        resultado?.mensagem || "Sem conexão com o servidor. Verifique a internet.";
    }
  } catch {
    el.classList.add("erro");
    el.textContent = "Sem conexão com o servidor. Verifique a internet.";
  }
}

async function tratarAtivacao(evento) {
  evento.preventDefault();
  setErro($("ativacao-erro"), "");
  const botao = evento.submitter || $("form-ativacao")?.querySelector("button[type=submit]");
  if (botao) botao.disabled = true;

  try {
    const resposta = await window.pdvAPI.ativarLicenca($("ativacao-chave").value);
    if (!resposta?.ok) {
      throw new Error(resposta?.mensagem || "Não foi possível conectar a loja.");
    }
    definirTenant(resposta.lojaId, {
      email: resposta.email,
      nomeLoja: resposta.nomeLoja,
      chave: resposta.chave,
    });
    notificar(
      resposta.nomeLoja
        ? `Loja conectada: ${resposta.nomeLoja}`
        : "Loja conectada com sucesso.",
      "sucesso"
    );
    $("form-ativacao").reset();

    const temAdmin = await existeAdministrador();
    mostrarTela(temAdmin ? "tela-login" : "tela-setup");
    const nomeLojaEl = $("login-loja-nome");
    if (nomeLojaEl && resposta.nomeLoja) {
      nomeLojaEl.textContent = `Loja: ${resposta.nomeLoja}`;
    }
  } catch (erro) {
    setErro($("ativacao-erro"), erro.message);
  } finally {
    if (botao) botao.disabled = false;
  }
}

/* ---------------------------------------------------------------------------
 * Autenticacao
 * ------------------------------------------------------------------------- */

async function tratarSetup(evento) {
  evento.preventDefault();
  setErro($("setup-erro"), "");

  try {
    await criarFuncionario({
      nome: $("setup-nome").value,
      usuario: $("setup-usuario").value,
      senha: $("setup-senha").value,
      cargo: CARGOS.ADMIN,
      areas: ["caixa", "rh", "marketing"],
    });
    notificar("Administrador criado com sucesso.", "sucesso");
    $("form-setup").reset();
    mostrarTela("tela-login");
  } catch (erro) {
    setErro($("setup-erro"), erro.message);
  }
}

async function tratarLogin(evento) {
  evento.preventDefault();
  setErro($("login-erro"), "");

  try {
    estado.funcionario = await autenticar(
      $("login-usuario").value,
      $("login-senha").value
    );
    $("form-login").reset();
    await entrarNoApp();
  } catch (erro) {
    setErro($("login-erro"), erro.message);
  }
}

function sair({ preservarCarrinho = false } = {}) {
  if (!preservarCarrinho) limparCarrinhoPendente();
  encerrarSessao();
  estado.funcionario = null;
  estado.carrinho?.destruir();
  estado.carrinho = null;
  estado.painelProdutos?.destruir();
  estado.painelProdutos = null;
  estado.dashboard = null;
  estado.painelFuncionarios = null;
  estado.painelHistorico = null;
  estado.painelConfiguracoes = null;
  estado.painelDespesas?.destruir();
  estado.painelDespesas = null;
  estado.painelSangrias?.destruir();
  estado.painelSangrias = null;
  estado.painelAssistente = null;
  estado.painelFolha = null;
  estado.painelFornecedores?.destruir();
  estado.painelFornecedores = null;
  estado.listaFuncionarios = [];
  estado.vendas = [];
  estado.despesas = [];
  estado.sangrias = [];
  estado.fornecedores = [];
  estado.sugestoesNomesIa = [];
  pararObservacaoProdutos();
  pararObservacaoVendas();
  pararObservacaoFuncionarios();
  pararObservacaoDespesas();
  pararObservacaoFornecedores();
  pararObservacaoSangrias();
  estado.assinaturaProdutos = "";
  // Mantém a licença/tenant — só desloga o usuário da loja atual
  mostrarTela("tela-login");
}

/* ---------------------------------------------------------------------------
 * Observadores
 * ------------------------------------------------------------------------- */

function pararObservacaoProdutos() {
  if (typeof estado.cancelarObservacaoProdutos === "function") {
    estado.cancelarObservacaoProdutos();
    estado.cancelarObservacaoProdutos = null;
  }
}

function pararObservacaoVendas() {
  if (typeof estado.cancelarObservacaoVendas === "function") {
    estado.cancelarObservacaoVendas();
    estado.cancelarObservacaoVendas = null;
  }
}

function pararObservacaoFuncionarios() {
  if (typeof estado.cancelarObservacaoFuncionarios === "function") {
    estado.cancelarObservacaoFuncionarios();
    estado.cancelarObservacaoFuncionarios = null;
  }
}

function pararObservacaoDespesas() {
  if (typeof estado.cancelarObservacaoDespesas === "function") {
    estado.cancelarObservacaoDespesas();
    estado.cancelarObservacaoDespesas = null;
  }
}

function pararObservacaoFornecedores() {
  if (typeof estado.cancelarObservacaoFornecedores === "function") {
    estado.cancelarObservacaoFornecedores();
    estado.cancelarObservacaoFornecedores = null;
  }
}

/**
 * Observa fornecedores (reposição / alertas).
 */
async function iniciarObservacaoFornecedores() {
  if (estado.cancelarObservacaoFornecedores) {
    estado.painelFornecedores?.atualizar(estado.fornecedores);
    atualizarAlertaEstoque(estado.produtos);
    return;
  }

  try {
    estado.cancelarObservacaoFornecedores = await observarFornecedores(
      (lista) => {
        estado.fornecedores = lista;
        estado.painelFornecedores?.atualizar(lista);
        atualizarAlertaEstoque(estado.produtos);
      }
    );
  } catch {
    notificar("Não foi possível carregar os fornecedores.", "erro");
  }
}

function iniciarFornecedores() {
  if (estado.funcionario?.cargo !== CARGOS.ADMIN) return;
  iniciarObservacaoFornecedores();
  if (!estado.painelFornecedores) {
    estado.painelFornecedores = new PainelFornecedores({
      listaEl: $("lista-fornecedores"),
      formEl: $("form-fornecedor"),
      inputFiltro: $("filtro-fornecedores"),
    });
  }
  estado.painelFornecedores.atualizar(estado.fornecedores);
}

function pararObservacaoSangrias() {
  if (typeof estado.cancelarObservacaoSangrias === "function") {
    estado.cancelarObservacaoSangrias();
    estado.cancelarObservacaoSangrias = null;
  }
}

/**
 * Observa sangrias do caixa.
 */
async function iniciarObservacaoSangrias() {
  if (estado.cancelarObservacaoSangrias) {
    estado.painelSangrias?.atualizar(estado.sangrias);
    estado.dashboard?.atualizar(estado.vendas);
    return;
  }

  try {
    estado.cancelarObservacaoSangrias = await observarSangrias((lista) => {
      estado.sangrias = lista;
      estado.painelSangrias?.atualizar(lista);
      estado.dashboard?.atualizar(estado.vendas);
    });
  } catch {
    notificar("Não foi possível carregar as sangrias.", "erro");
  }
}

/**
 * Observa despesas da loja (lucro líquido / assistente).
 */
async function iniciarObservacaoDespesas() {
  if (estado.cancelarObservacaoDespesas) {
    estado.painelDespesas?.atualizar(estado.despesas);
    estado.dashboard?.atualizar(estado.vendas);
    return;
  }

  try {
    estado.cancelarObservacaoDespesas = await observarDespesas((despesas) => {
      estado.despesas = despesas;
      estado.painelDespesas?.atualizar(despesas);
      if (estado.rotaAtual === "relatorios") {
        estado.dashboard?.atualizar(estado.vendas);
      }
    });
  } catch {
    notificar("Não foi possível carregar as despesas.", "erro");
  }
}

/**
 * Observa vendas para Relatórios e Histórico (compartilhado).
 */
async function iniciarObservacaoVendas() {
  if (estado.cancelarObservacaoVendas) {
    if (estado.rotaAtual === "relatorios") {
      estado.dashboard?.atualizar(estado.vendas);
    }
    if (estado.rotaAtual === "historico") {
      estado.painelHistorico?.atualizar(estado.vendas);
    }
    return;
  }

  try {
    estado.cancelarObservacaoVendas = await observarVendas((vendas) => {
      estado.vendas = vendas;
      estado.revolucao?.atualizarMetaCaixa?.();
      estado.revolucao?.atualizarUpsell?.();
      if (estado.rotaAtual === "relatorios") {
        estado.dashboard?.atualizar(vendas);
        estado.revolucao?.atualizarPulso?.();
        estado.painelCaixaFisico?.renderizar?.();
      }
      if (estado.rotaAtual === "historico") {
        estado.painelHistorico?.atualizar(vendas);
      }
    });
  } catch {
    notificar("Não foi possível carregar as vendas.", "erro");
  }
}

async function iniciarRelatorios() {
  if (estado.funcionario?.cargo !== CARGOS.ADMIN) return;

  await iniciarObservacaoDespesas();
  await iniciarObservacaoSangrias();

  if (!estado.dashboard) {
    try {
      const Dashboard = await carregarClasseDashboard();
      estado.dashboard = new Dashboard({
        raiz: $("rota-relatorios"),
        obterFuncionario: () => estado.funcionario,
        obterProdutos: () => estado.produtos,
        obterDespesas: () => estado.despesas,
        obterSangrias: () => estado.sangrias,
        obterSuprimentos: () => estado.suprimentos,
      });
    } catch {
      notificar("Não foi possível carregar os relatórios.", "erro");
      return;
    }
  }

  if (!estado.painelDespesas) {
    estado.painelDespesas = new PainelDespesas({
      listaEl: $("lista-despesas"),
      formEl: $("form-despesa"),
      selectCompetencia: $("filtro-despesa-competencia"),
      onMudou: () => {
        estado.dashboard?.atualizar(estado.vendas);
      },
    });
    $("btn-limpar-despesa")?.addEventListener("click", () => {
      estado.painelDespesas?.limparFormulario();
    });
  }

  if (!estado.painelSangrias && $("form-sangria") && $("lista-sangrias")) {
    estado.painelSangrias = new PainelSangrias({
      listaEl: $("lista-sangrias"),
      formEl: $("form-sangria"),
      selectPeriodo: $("filtro-sangria-periodo"),
      resumoEl: $("sangria-resumo"),
      obterFuncionario: () => estado.funcionario,
      onMudou: () => {
        estado.dashboard?.atualizar(estado.vendas);
      },
    });
  }

  estado.painelDespesas.atualizar(estado.despesas);
  estado.painelSangrias?.atualizar(estado.sangrias);
  estado.dashboard.atualizar(estado.vendas);
  const rev = obterRevolucao();
  await rev.iniciarObservacaoSuprimentos();
  rev.atualizarPulso();
  await estado.painelCaixaFisico?.atualizarEstado();
}

function iniciarAssistente() {
  if (estado.funcionario?.cargo !== CARGOS.ADMIN) return;

  iniciarObservacaoDespesas();

  if (!estado.painelAssistente) {
    estado.painelAssistente = new PainelAssistente({
      raiz: $("rota-assistente"),
      obterContexto: () => montarContextoAssistente(),
    });
  }
}

/**
 * Contexto não-secreto enviado à IA (resumo da loja).
 * @returns {object}
 */
function montarContextoAssistente() {
  const meta = obterMetaLoja() || {};
  const resumo = gerarResumo(estado.vendas, {
    produtos: estado.produtos,
    despesas: estado.despesas,
  });
  const categorias = [
    ...new Set(
      (estado.produtos || [])
        .map((p) => (p.categoria || "").trim())
        .filter(Boolean)
    ),
  ];
  const estoqueBaixo = listarEstoqueBaixo(
    estado.produtos,
    estado.estoqueMinimo
  ).slice(0, 10);

  return {
    nomeLoja: meta.nomeLoja || estado.configLoja?.lojaNome || "",
    endereco: estado.configLoja?.lojaEndereco || "",
    receitaMes: resumo.totalMes,
    lucroBrutoMes: resumo.lucroBrutoMes,
    despesasMes: resumo.despesasMes,
    lucroLiquidoMes: resumo.lucroLiquidoMes,
    maisVendidos: (resumo.maisVendidosMes || []).map((p) => ({
      nome: p.nome,
      quantidade: p.quantidade,
    })),
    estoqueBaixo: estoqueBaixo.map((p) => ({
      nome: p.nome,
      estoque: p.estoque,
    })),
    categorias,
    produtosSemCusto: resumo.produtosSemCusto,
    equipePorArea: resumirEquipePorArea(estado.listaFuncionarios || []),
    fornecedores: (estado.fornecedores || [])
      .filter((f) => f.ativo !== false)
      .slice(0, 20)
      .map((f) => ({
        nome: f.nome,
        tiposMercadoria: rotuloTiposMercadoria(f),
        nicho: rotuloTiposMercadoria(f),
        contato: f.whatsapp || f.telefone || f.email || "",
      })),
  };
}

/**
 * @param {Array<object>} funcionarios
 * @returns {Record<string, number>}
 */
function resumirEquipePorArea(funcionarios) {
  const contagem = { caixa: 0, rh: 0, marketing: 0 };
  for (const f of funcionarios || []) {
    const areas = Array.isArray(f.areas) ? f.areas : [];
    for (const a of areas) {
      if (contagem[a] != null) contagem[a] += 1;
    }
  }
  return contagem;
}

function iniciarHistorico() {
  if (!estado.painelHistorico) {
    estado.painelHistorico = new PainelHistorico({
      listaEl: $("lista-historico"),
      inputFiltro: $("filtro-historico"),
      selectPeriodo: $("periodo-historico"),
      ehAdmin: estado.funcionario?.cargo === CARGOS.ADMIN,
      podeCancelar: podeAgora("cancelarVenda"),
      funcionarioNome: estado.funcionario?.nome || "",
      onReimprimir: (venda) => reimprimirVenda(venda),
      formCancelar: $("form-cancelar-venda"),
      modalCancelar: $("modal-cancelar-venda"),
      erroCancelar: $("cancelar-venda-erro"),
      resumoCancelar: $("cancelar-venda-resumo"),
    });
  }
  estado.painelHistorico.ehAdmin = estado.funcionario?.cargo === CARGOS.ADMIN;
  estado.painelHistorico.podeCancelar = podeAgora("cancelarVenda");
  estado.painelHistorico.funcionarioNome = estado.funcionario?.nome || "";
  estado.painelHistorico.atualizar(estado.vendas);
}

async function iniciarConfiguracoes() {
  if (estado.funcionario?.cargo !== CARGOS.ADMIN) return;

  if (!estado.painelConfiguracoes) {
    estado.painelConfiguracoes = new PainelConfiguracoes({
      form: $("form-configuracoes"),
      selectImpressora: $("cfg-impressora-select"),
      erroEl: $("config-erro"),
      onSalvo: (config) => {
        estado.estoqueMinimo = Number(config.estoqueMinimo) || 5;
        estado.configLoja = config;
        estado.avisoFornecedoresIa = config.avisoFornecedoresIa !== false;
        aplicarPreferenciasInterface(config);
        const metaVal = Number($("cfg-meta-dia")?.value) || 0;
        salvarMetaDia(estado.funcionario?.id, metaVal);
        estado.revolucao?.atualizarMetaCaixa?.();
        if (estado.painelProdutos) {
          estado.painelProdutos.estoqueMinimo = estado.estoqueMinimo;
          estado.painelProdutos.renderizar(true);
        }
        atualizarAlertaEstoque(estado.produtos);
        if (
          estado.rotaAtual &&
          !moduloRotaAtivo(estado.rotaAtual, config)
        ) {
          navegarPara("pdv");
        }
      },
    });
  }
  await estado.painelConfiguracoes.carregar();
  const prefs = lerPreferenciasCaixa(estado.funcionario?.id);
  if ($("cfg-meta-dia")) {
    $("cfg-meta-dia").value = prefs.metaDia ? String(prefs.metaDia) : "";
  }
}

async function iniciarFuncionarios() {
  if (estado.funcionario?.cargo !== CARGOS.ADMIN) return;

  if (!estado.painelFuncionarios) {
    estado.painelFuncionarios = new PainelFuncionarios({
      listaEl: $("lista-funcionarios"),
      formAuth: $("form-alterar-cargo"),
      modalAuth: $("modal-alterar-cargo"),
      erroEl: $("alterar-cargo-erro"),
      resumoEl: $("alterar-cargo-resumo"),
      inputUsuario: $("auth-admin-usuario"),
      formSenha: $("form-alterar-senha"),
      modalSenha: $("modal-alterar-senha"),
      erroSenha: $("alterar-senha-erro"),
      resumoSenha: $("alterar-senha-resumo"),
      guiasEl: $("guias-areas-equipe"),
    });
  }

  if (!estado.painelFolha) {
    estado.painelFolha = new PainelFolha({
      raiz: $("painel-folha-root"),
      obterFuncionarios: () => estado.listaFuncionarios || [],
    });
  }

  if (estado.cancelarObservacaoFuncionarios) {
    estado.painelFolha.atualizar(estado.listaFuncionarios || []);
    return;
  }

  try {
    estado.cancelarObservacaoFuncionarios = await observarFuncionarios(
      (funcionarios) => {
        estado.listaFuncionarios = funcionarios;
        estado.painelFuncionarios.atualizar(funcionarios);
        estado.painelFolha?.atualizar(funcionarios);
      }
    );
  } catch {
    notificar("Não foi possível carregar a equipe.", "erro");
  }
}

/* ---------------------------------------------------------------------------
 * App autenticado
 * ------------------------------------------------------------------------- */

/**
 * Mostra/oculta itens do menu conforme cargo e módulos ativos.
 */
function atualizarVisibilidadeModulos() {
  const ehAdmin = estado.funcionario?.cargo === CARGOS.ADMIN;
  const cfg = estado.configLoja;

  $("nav-configuracoes")?.classList.toggle("oculto", !ehAdmin);
  $("btn-novo-produto-pdv")?.classList.toggle("oculto", !podeAgora("cadastrarProduto"));
  $("btn-novo-produto")?.classList.toggle("oculto", !podeAgora("cadastrarProduto"));
  $("btn-cadastrar-venda-rapida")?.classList.toggle(
    "oculto",
    !podeAgora("cadastrarProduto")
  );
  $("btn-sangria-pdv")?.classList.toggle("oculto", !podeAgora("fazerSangria"));
  $("btn-corrigir-nomes-ia")?.classList.toggle("oculto", !ehAdmin);
  document.querySelector(".btn-arquivo")?.classList.toggle("oculto", !ehAdmin);

  for (const mod of MODULOS_LOJA) {
    const nav = $(`nav-${mod.rota}`);
    if (!nav) continue;
    const ativo = moduloRotaAtivo(mod.rota, cfg);
    const ocultar = !ativo || !podeAcessarRota(mod.rota);
    nav.classList.toggle("oculto", ocultar);
  }
}

/**
 * Aplica tema, fonte, tamanho e opções do caixa na interface.
 * @param {object | null | undefined} config
 */
function aplicarPreferenciasInterface(config) {
  aplicarAparencia(config);
  const cfgCaixa = { ...(config && typeof config === "object" ? config : {}) };
  if (!podeAgora("aplicarDesconto")) cfgCaixa.ocultarDesconto = true;
  if (!podeAgora("venderFiado")) cfgCaixa.ocultarFiado = true;
  aplicarOpcoesCaixa(cfgCaixa);
  aplicarCamposCadastroProduto(config);
  atualizarVisibilidadeModulos();
  if (cfgCaixa.ocultarCliente) {
    estado.clienteVendaAtual = null;
  }
  estado.carrinho?.definirDescontoDesligado(
    Boolean(cfgCaixa.ocultarDesconto) || !podeAgora("aplicarDesconto")
  );
}


async function atualizarBannerAssinatura(assinatura) {
  const banner = $("banner-assinatura-atraso");
  if (!banner) return;
  const atrasada = Boolean(assinatura && assinatura.atrasada);
  banner.classList.toggle("oculto", !atrasada);
  if (!atrasada) return;
  const msg = banner.querySelector("span");
  if (msg && assinatura.mensagem) {
    msg.textContent = assinatura.mensagem;
  }
  const link = $("banner-assinatura-link");
  if (link) {
    const base = await obterApiUrl().catch(() => "");
    link.href = base ? `${String(base).replace(/\/+$/, "")}/painel.html` : "#";
  }
}

async function entrarNoApp() {
  atualizarBannerAssinatura(estado.funcionario && estado.funcionario.assinatura);

  const { nome, cargo } = estado.funcionario;
  const ehAdmin = cargo === CARGOS.ADMIN;

  const rotuloCargo = ROTULO_CARGO[cargo] || cargo;
  const classeBadge =
    cargo === CARGOS.ADMIN ? "badge-cargo badge-cargo--admin" : "badge-cargo";
  $("app-funcionario").innerHTML = `<strong>${escapeHtml(nome)}</strong><span class="${classeBadge}">${escapeHtml(rotuloCargo)}</span>`;

  try {
    const config = await obterConfigApp();
    estado.estoqueMinimo = Number(config.estoqueMinimo) || 5;
    estado.configLoja = config;
    estado.avisoFornecedoresIa = config.avisoFornecedoresIa !== false;
    aplicarPreferenciasInterface(config);
  } catch {
    estado.estoqueMinimo = 5;
    estado.configLoja = null;
    estado.avisoFornecedoresIa = true;
    aplicarPreferenciasInterface(null);
  }

  atualizarVisibilidadeModulos();

  estado.assinaturaProdutos = "";
  estado.carrinho?.destruir();
  estado.painelHistorico = null;
  estado.painelConfiguracoes = null;

  estado.carrinho = new Carrinho({
    containerItens: $("carrinho-itens"),
    elementoSubtotal: $("carrinho-subtotal-valor"),
    inputDesconto: $("carrinho-desconto"),
    elementoTotal: $("carrinho-total-valor"),
    botaoFinalizar: $("btn-finalizar"),
    selectPagamento: $("forma-pagamento"),
    blocoTroco: $("bloco-troco"),
    inputRecebido: $("carrinho-recebido"),
    elementoTroco: $("carrinho-troco-valor"),
    elementoQtdItens: $("carrinho-qtd-itens"),
  });
  const restaurados = tentarRestaurarCarrinhoPendente();
  if (restaurados > 0) {
    notificar(
      `Carrinho restaurado (${restaurados} item${restaurados > 1 ? "s" : ""}). Sessão anterior expirou.`,
      "alerta",
      6000
    );
  }
  aplicarPreferenciasInterface(estado.configLoja);

  estado.painelProdutos?.destruir();
  estado.painelProdutos = new PainelProdutos({
    container: $("lista-gestao-produtos"),
    inputFiltro: $("filtro-produtos"),
    estoqueMinimo: estado.estoqueMinimo,
    permitirExcluir: podeAgora("excluirProduto"),
    permitirEditar: podeAgora("editarProduto"),
    permitirAjustarEstoque: podeAgora("ajustarEstoque"),
    onEditar: (produto) => abrirModalProduto({ produto }),
    onExcluir: (produto) => {
      if (!podeAgora("excluirProduto")) {
        notificar("Você não tem permissão para excluir produtos.", "alerta");
        return;
      }
      abrirModalExcluir(produto);
    },
    onAjustarEstoque: async (produto, delta) => {
      if (!podeAgora("ajustarEstoque")) {
        notificar("Você não tem permissão para ajustar estoque.", "alerta");
        return;
      }
      try {
        await ajustarEstoque(produto.id, produto.estoque, delta);
      } catch (erro) {
        notificar(erro.message, "erro");
      }
    },
  });

  pararObservacaoProdutos();
  estado.cancelarObservacaoProdutos = await observarProdutos((produtos) => {
    estado.produtos = produtos;
    atualizarIndice(produtos);
    renderizarFiltrosCategoria(produtos);
    renderizarAtalhosRapidos();
    renderizarGradeProdutos(produtos);
    estado.painelProdutos?.atualizar(produtos);
    atualizarAlertaEstoque(produtos);
    atualizarSugestoes($("busca-produto").value);
  });

  if (ehAdmin) {
    iniciarObservacaoFornecedores();
  }

  sincronizarBotoesPagamento($("forma-pagamento")?.value || "dinheiro");
  mostrarTela("tela-app");
  // Vendas em tempo real também no Caixa (meta do dia + “leva junto”)
  await iniciarObservacaoVendas();
  navegarPara("pdv");
  await obterRevolucao().aoEntrarSessao();
  await obterMega().aoEntrarMega();
}

const CHAVE_CATEGORIAS_RECOLHIDAS = "cybhor_pdv_categorias_recolhidas";

function categoriasRecolhidas() {
  try {
    return localStorage.getItem(CHAVE_CATEGORIAS_RECOLHIDAS) === "1";
  } catch {
    return false;
  }
}

function aplicarEstadoCategorias() {
  const wrap = $("wrap-categorias");
  const btn = $("btn-toggle-categorias");
  const recolhido = categoriasRecolhidas();
  wrap?.classList.toggle("recolhido", recolhido);
  if (btn) {
    btn.setAttribute("aria-expanded", String(!recolhido));
    btn.textContent = recolhido ? "Mostrar categorias" : "Ocultar categorias";
  }
}

function fecharPainelSino() {
  $("painel-sino-estoque")?.classList.add("oculto");
  $("btn-sino-estoque")?.classList.remove("aberto");
  $("btn-sino-estoque")?.setAttribute("aria-expanded", "false");
}

function abrirPainelSino() {
  const painel = $("painel-sino-estoque");
  const btn = $("btn-sino-estoque");
  if (!painel || !btn) return;
  const rect = btn.getBoundingClientRect();
  painel.style.top = `${Math.round(rect.bottom + 8)}px`;
  painel.style.right = `${Math.round(window.innerWidth - rect.right)}px`;
  painel.classList.remove("oculto");
  btn.classList.add("aberto");
  btn.setAttribute("aria-expanded", "true");
}

function sairDaVendaRapida() {
  if (!document.body.classList.contains("venda-rapida")) return false;
  document.body.classList.remove("venda-rapida");
  fecharPainelSino();
  notificar("Saiu da venda rápida. Menu e cadastros estão visíveis.", "sucesso");
  return true;
}

/**
 * Banner de estoque baixo no caixa + badge no menu Produtos.
 * @param {Array<object>} produtos
 */
function atualizarAlertaEstoque(produtos) {
  const baixos = listarEstoqueBaixo(produtos, estado.estoqueMinimo);
  const alerta = $("alerta-estoque");
  const alertaForn = $("alerta-fornecedores");
  const navProdutos = $("nav-produtos");

  if (alerta) {
    if (baixos.length === 0) {
      alerta.classList.add("oculto");
      alerta.innerHTML = "";
    } else {
      const nomes = baixos
        .slice(0, 4)
        .map((p) => `${escapeHtml(p.nome)} (${p.estoque})`)
        .join(" · ");
      const extra =
        baixos.length > 4 ? ` e mais ${baixos.length - 4}` : "";
      alerta.innerHTML = `<strong>Estoque baixo (${baixos.length})</strong><span>${nomes}${extra}</span>`;
      alerta.classList.remove("oculto");
    }
  }

  if (alertaForn) {
    const mostrar = estado.avisoFornecedoresIa !== false && baixos.length > 0;

    if (!mostrar) {
      alertaForn.classList.add("oculto");
      alertaForn.innerHTML = "";
    } else if ((estado.fornecedores || []).length === 0) {
      alertaForn.innerHTML = `
        <strong>Estoque acabando</strong>
        <span>Cadastre fornecedores com os tipos de mercadoria que vendem (ex.: Bebidas, Água) para sugerir quem ligar.</span>
        <div class="alerta-forn-acoes">
          <button type="button" class="btn btn-secundario btn-sm" id="btn-ir-fornecedores">Cadastrar fornecedores</button>
          <button type="button" class="btn btn-primario btn-sm" id="btn-ia-reposicao">Pedir ajuda à IA</button>
        </div>`;
      alertaForn.classList.remove("oculto");
    } else {
      const sugeridos = listarFornecedoresParaReposicao(
        baixos,
        estado.fornecedores
      );
      if (sugeridos.length === 0) {
        alertaForn.innerHTML = `
          <strong>Estoque acabando</strong>
          <span>Há itens baixos, mas nenhum fornecedor com tipos de mercadoria compatíveis. Use os mesmos nomes das categorias dos produtos no campo “O que vende”.</span>
          <div class="alerta-forn-acoes">
            <button type="button" class="btn btn-secundario btn-sm" id="btn-ir-fornecedores">Abrir fornecedores</button>
            <button type="button" class="btn btn-primario btn-sm" id="btn-ia-reposicao">Pedir ajuda à IA</button>
          </div>`;
      } else {
        const linhas = sugeridos
          .slice(0, 4)
          .map((f) => {
            const contato = f.whatsapp || f.telefone || "sem contato";
            const itens = (f.produtosSugeridos || []).slice(0, 3).join(", ");
            const tipos = rotuloTiposMercadoria(f) || "—";
            return `<li><strong>${escapeHtml(f.nome)}</strong> [${escapeHtml(
              tipos
            )}] · ${escapeHtml(contato)} → ${escapeHtml(itens)}</li>`;
          })
          .join("");
        alertaForn.innerHTML = `
          <strong>Estoque acabando — fornecedores que vendem isso</strong>
          <ul class="alerta-forn-lista">${linhas}</ul>
          <div class="alerta-forn-acoes">
            <button type="button" class="btn btn-primario btn-sm" id="btn-wa-reposicao">WhatsApp reposição</button>
            <button type="button" class="btn btn-secundario btn-sm" id="btn-ia-reposicao">Pedir mensagem à IA</button>
            <button type="button" class="btn btn-texto btn-sm" id="btn-ir-fornecedores">Ver todos</button>
          </div>`;
      }
      alertaForn.classList.remove("oculto");
    }
  }

  if (navProdutos) {
    let badge = navProdutos.querySelector(".nav-badge");
    if (baixos.length === 0) {
      badge?.remove();
    } else {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "nav-badge";
        navProdutos.appendChild(badge);
      }
      badge.textContent = String(baixos.length);
    }
  }

  const sino = $("btn-sino-estoque");
  const badgeSino = $("sino-estoque-badge");
  if (sino) {
    sino.classList.toggle("oculto", baixos.length === 0);
    if (baixos.length === 0) fecharPainelSino();
  }
  if (badgeSino) {
    badgeSino.textContent = String(baixos.length);
    badgeSino.classList.toggle("oculto", baixos.length === 0);
  }
}

function pedirSugestaoReposicaoIa() {
  sairDaVendaRapida();
  fecharPainelSino();
  if (estado.funcionario?.cargo !== CARGOS.ADMIN) {
    notificar("Somente administradores usam a CybhorIA.", "alerta");
    return;
  }
  const baixos = listarEstoqueBaixo(estado.produtos, estado.estoqueMinimo);
  if (baixos.length === 0) {
    notificar("Nenhum produto com estoque baixo no momento.", "alerta");
    return;
  }
  const texto = montarAlertaReposicaoTexto(baixos, estado.fornecedores);
  if (!texto) {
    notificar("Nada para sugerir no momento.", "alerta");
    return;
  }
  navegarPara("assistente");
  iniciarAssistente();
  estado.painelAssistente?.prepararPergunta("compras", texto);
  notificar("Prompt de reposição pronto na CybhorIA — revise e envie.", "sucesso");
}

/**
 * Extrai array JSON de sugestões de nome da resposta da IA.
 * @param {string} texto
 * @returns {Array<object>}
 */
function extrairSugestoesNomesJson(texto) {
  const bruto = String(texto || "").trim();
  if (!bruto) return [];

  const tentar = (s) => {
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return null;
    }
  };

  let resultado = tentar(bruto);
  if (resultado) return resultado;

  const fence = bruto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    resultado = tentar(fence[1].trim());
    if (resultado) return resultado;
  }

  const inicio = bruto.indexOf("[");
  const fim = bruto.lastIndexOf("]");
  if (inicio >= 0 && fim > inicio) {
    resultado = tentar(bruto.slice(inicio, fim + 1));
    if (resultado) return resultado;
  }
  return [];
}

/**
 * Abre modal e pede à IA sugestões de nomes melhores.
 */
async function abrirCorrigirNomesComIa() {
  if (estado.funcionario?.cargo !== CARGOS.ADMIN) {
    notificar("Somente administradores podem corrigir nomes.", "alerta");
    return;
  }
  if (!window.pdvAPI?.consultarAssistente) {
    notificar("Assistente indisponível nesta instalação.", "erro");
    return;
  }

  const amostra = [...(estado.produtos || [])]
    .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")))
    .slice(0, 60)
    .map((p) => ({
      id: p.id,
      nomeAtual: p.nome || "",
      categoria: p.categoria || "",
    }));

  if (amostra.length === 0) {
    notificar("Cadastre produtos antes de pedir correções.", "alerta");
    return;
  }

  estado.sugestoesNomesIa = [];
  abrirModal("modal-corrigir-nomes");
  const status = $("corrigir-nomes-status");
  const lista = $("lista-corrigir-nomes");
  const btnAplicar = $("btn-aplicar-nomes-aceitos");
  if (status) status.textContent = "Consultando a IA… isso pode levar alguns segundos.";
  if (lista) lista.innerHTML = "";
  if (btnAplicar) btnAplicar.disabled = true;

  const mensagem = [
    "Analise estes produtos e sugira nomes melhores para o cadastro do PDV.",
    "Responda só com o JSON array pedido no modo nomes_produtos.",
    "Produtos:",
    JSON.stringify(amostra),
  ].join("\n");

  try {
    const resultado = await window.pdvAPI.consultarAssistente({
      modo: "nomes_produtos",
      mensagem,
      contexto: montarContextoAssistente(),
    });
    if (!resultado?.ok) {
      throw new Error(resultado?.mensagem || "Falha no assistente.");
    }

    const idsValidos = new Set(amostra.map((p) => p.id));
    const sugestoes = extrairSugestoesNomesJson(resultado.texto || "")
      .map((s) => ({
        id: String(s.id || "").trim(),
        nomeAtual: String(s.nomeAtual || "").trim(),
        nomeSugerido: String(s.nomeSugerido || "").trim(),
        motivo: String(s.motivo || "").trim(),
        aceito: true,
      }))
      .filter(
        (s) =>
          idsValidos.has(s.id) &&
          s.nomeSugerido.length >= 2 &&
          s.nomeSugerido.toLowerCase() !== s.nomeAtual.toLowerCase()
      );

    estado.sugestoesNomesIa = sugestoes;
    renderizarSugestoesNomes();

    if (status) {
      status.textContent = sugestoes.length
        ? `${sugestoes.length} sugestão(ões). Desmarque o que não quiser aplicar.`
        : "A IA não encontrou nomes para corrigir nesta amostra.";
    }
  } catch (erro) {
    if (status) {
      status.textContent = erro.message || "Não foi possível obter sugestões.";
    }
    notificar(erro.message || "Falha na IA.", "erro");
  }
}

function renderizarSugestoesNomes() {
  const lista = $("lista-corrigir-nomes");
  const btnAplicar = $("btn-aplicar-nomes-aceitos");
  if (!lista) return;

  const sugestoes = estado.sugestoesNomesIa || [];
  if (sugestoes.length === 0) {
    lista.innerHTML = "";
    if (btnAplicar) btnAplicar.disabled = true;
    return;
  }

  lista.innerHTML = sugestoes
    .map(
      (s, idx) => `
    <label class="corrigir-nome-item">
      <input type="checkbox" data-idx-nome="${idx}" ${s.aceito ? "checked" : ""} />
      <div class="corrigir-nome-info">
        <span class="corrigir-nome-atual">${escapeHtml(s.nomeAtual)}</span>
        <span class="corrigir-nome-seta" aria-hidden="true">→</span>
        <strong class="corrigir-nome-novo">${escapeHtml(s.nomeSugerido)}</strong>
        ${
          s.motivo
            ? `<span class="corrigir-nome-motivo">${escapeHtml(s.motivo)}</span>`
            : ""
        }
      </div>
    </label>`
    )
    .join("");

  lista.querySelectorAll("[data-idx-nome]").forEach((check) => {
    check.addEventListener("change", () => {
      const i = Number(check.getAttribute("data-idx-nome"));
      if (estado.sugestoesNomesIa[i]) {
        estado.sugestoesNomesIa[i].aceito = check.checked;
      }
      if (btnAplicar) {
        btnAplicar.disabled = !estado.sugestoesNomesIa.some((x) => x.aceito);
      }
    });
  });

  if (btnAplicar) {
    btnAplicar.disabled = !sugestoes.some((x) => x.aceito);
  }
}

/**
 * Aplica renomeações aceitas, preservando demais campos do produto.
 */
async function aplicarNomesAceitos() {
  const aceitos = (estado.sugestoesNomesIa || []).filter((s) => s.aceito);
  if (aceitos.length === 0) {
    notificar("Nenhuma sugestão marcada.", "alerta");
    return;
  }

  const btn = $("btn-aplicar-nomes-aceitos");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Aplicando…";
  }

  let ok = 0;
  let falhas = 0;
  for (const s of aceitos) {
    const produto = estado.produtos.find((p) => p.id === s.id);
    if (!produto) {
      falhas += 1;
      continue;
    }
    try {
      await atualizarProduto(produto.id, {
        nome: s.nomeSugerido,
        codigoBarras: produto.codigoBarras || "",
        preco: produto.preco,
        estoque: produto.estoque,
        categoria: produto.categoria || "",
        custo: produto.custo ?? null,
      });
      ok += 1;
    } catch {
      falhas += 1;
    }
  }

  if (btn) btn.textContent = "Aplicar aceitos";
  fecharModal("modal-corrigir-nomes");
  estado.sugestoesNomesIa = [];

  if (ok > 0) {
    notificar(
      falhas
        ? `${ok} nome(s) atualizado(s); ${falhas} falha(s).`
        : `${ok} nome(s) atualizado(s).`,
      falhas ? "alerta" : "sucesso"
    );
  } else {
    notificar("Não foi possível aplicar as alterações.", "erro");
  }
}

/**
 * Reimprime cupom de uma venda do histórico.
 * @param {object} venda
 */
async function reimprimirVenda(venda) {
  if (!venda || venda.cancelada) {
    notificar("Venda cancelada — não imprime.", "alerta");
    return;
  }
  estado.ultimaVendaCupom = venda;
  notificar("Enviando cupom…", "info");
  try {
    const impressao = await imprimirCupomVenda(venda);
    if (!impressao.ok) {
      notificar(
        impressao.mensagem || "Falha na impressão — confira a impressora.",
        "alerta"
      );
      return;
    }
    notificar("Cupom reimpresso.", "sucesso");
  } catch (erro) {
    notificar(erro.message || "Falha na impressão — tente de novo.", "erro");
  }
}

/**
 * @param {Array<object>} produtos
 */
function renderizarFiltrosCategoria(produtos) {
  const el = $("filtros-categoria");
  const wrap = $("wrap-categorias");
  if (!el) return;

  const cats = [
    ...new Set(
      (produtos || [])
        .map((p) => (p.categoria || "").trim())
        .filter(Boolean)
    ),
  ].sort((a, b) => a.localeCompare(b));

  if (cats.length === 0) {
    el.innerHTML = "";
    wrap?.classList.add("oculto");
    return;
  }

  wrap?.classList.remove("oculto");
  aplicarEstadoCategorias();
  const ativo = estado.categoriaFiltro;
  el.innerHTML =
    `<button type="button" class="filtro-chip ${
      !ativo ? "ativo" : ""
    }" data-categoria="">Todas</button>` +
    cats
      .map(
        (c) =>
          `<button type="button" class="filtro-chip ${
            ativo === c ? "ativo" : ""
          }" data-categoria="${escapeHtml(c)}">${escapeHtml(c)}</button>`
      )
      .join("");
}

function renderizarAtalhosRapidos() {
  const el = $("atalhos-rapidos");
  if (!el) return;
  const funcionarioId = estado.funcionario?.id;
  const lista = listarMaisUsados(funcionarioId, estado.produtos, 8);

  if (lista.length === 0) {
    el.innerHTML = `
      <div class="atalhos-rapidos-vazio">
        Produtos favoritos e mais usados aparecem aqui. Clique na ⭐ de um produto para fixar.
      </div>`;
    return;
  }

  el.innerHTML =
    `<span class="atalhos-rapidos-rotulo">Rápidos</span>` +
    lista
      .map((p) => {
        const fav = p._favorito ? " favorito" : "";
        return `
        <button type="button" class="atalho-produto${fav}" data-produto-id="${escapeHtml(
          p.id
        )}" title="${escapeHtml(p.nome)} — ${formatarMoeda(p.preco)}">
          ${p._favorito ? "★ " : ""}${escapeHtml(p.nome)}
        </button>`;
      })
      .join("");
}

/**
 * @param {Array<object>} produtos
 */
function renderizarGradeProdutos(produtos) {
  const container = $("lista-produtos");
  const filtroCat = estado.categoriaFiltro;
  const prefs = lerPreferenciasCaixa(estado.funcionario?.id);
  const favoritos = new Set(prefs.favoritos || []);

  let ordenados = [...produtos].filter((p) => {
    if (!filtroCat) return true;
    return (p.categoria || "").trim() === filtroCat;
  });

  ordenados.sort((a, b) => {
    const fa = favoritos.has(a.id) ? 0 : 1;
    const fb = favoritos.has(b.id) ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return a.nome.localeCompare(b.nome);
  });

  const assinatura =
    (filtroCat || "") +
    "|" +
    Array.from(favoritos).join(",") +
    "|" +
    (podeAgora("editarProduto") ? "e1" : "e0") +
    "|" +
    ordenados
      .map((p) => `${p.id}:${p.estoque}:${p.preco}:${p.nome}:${p.categoria || ""}`)
      .join("|");

  if (assinatura === estado.assinaturaProdutos) return;
  estado.assinaturaProdutos = assinatura;

  if (ordenados.length === 0) {
    container.innerHTML = `
      <div class="estado-vazio grade-vazia">
        <p>Nenhum produto nesta categoria</p>
        <span>Troque o filtro ou use a busca</span>
      </div>`;
    return;
  }

  container.innerHTML = ordenados
    .map((produto) => {
      const estoque = Number(produto.estoque) || 0;
      const semEstoque = estoque < 1;
      const estoqueBaixo = !semEstoque && estoque <= estado.estoqueMinimo;
      const classeEstoque = semEstoque ? "sem" : estoqueBaixo ? "baixo" : "";
      const textoEstoque = semEstoque
        ? "Sem estoque"
        : estoqueBaixo
          ? `Baixo: ${estoque}`
          : `Estoque: ${estoque}`;
      const categoria = (produto.categoria || "").trim();
      const ehFav = favoritos.has(produto.id);
      return `
      <div class="produto-card${semEstoque ? " sem-estoque" : ""}${
        ehFav ? " produto-card--favorito" : ""
      }" data-produto-id="${escapeHtml(produto.id)}" ${
        semEstoque ? 'aria-disabled="true"' : ""
      }>
        <div class="produto-card-topo">
          <span class="produto-categoria" title="${escapeHtml(categoria)}">${escapeHtml(
            categoria
          )}</span>
          <button type="button" class="btn-favorito ${ehFav ? "ativo" : ""}" data-favorito-id="${escapeHtml(
            produto.id
          )}" title="${ehFav ? "Remover dos favoritos" : "Fixar nos favoritos"}" aria-label="Favorito">★</button>
          ${
            podeAgora("editarProduto")
              ? `<button type="button" class="btn-editar-card" data-editar-produto="${escapeHtml(
                  produto.id
                )}" title="Editar produto" aria-label="Editar produto">✎</button>`
              : ""
          }
        </div>
        <span class="produto-nome">${escapeHtml(produto.nome)}</span>
        <div class="produto-card-rodape">
          <span class="produto-preco">${formatarMoeda(produto.preco)}</span>
          <span class="produto-estoque ${classeEstoque}">${textoEstoque}</span>
        </div>
      </div>`;
    })
    .join("");
}

/**
 * @param {string} produtoId
 * @param {number} [quantidade=1]
 */
function adicionarAoCarrinho(produtoId, quantidade = 1) {
  const produto = estado.produtos.find((p) => p.id === produtoId);
  if (!produto) return;

  let qtd = quantidade;
  if (String(produto.unidade || "un").toLowerCase() === "kg" && qtd === 1) {
    const informado = window.prompt(`Peso em kg — ${produto.nome}`, "");
    if (informado === null) {
      focarBuscaProduto(30);
      return;
    }
    qtd = Number(String(informado).replace(",", "."));
    if (!Number.isFinite(qtd) || qtd <= 0) {
      notificar("Peso inválido — digite de novo.", "alerta");
      focarBuscaProduto(30);
      return;
    }
  }

  const paraCarrinho = obterMega().produtoParaCarrinho(produto, qtd);
  const adicionado = estado.carrinho.adicionar(paraCarrinho, qtd);
  if (!adicionado) {
    const est = Number(produto.estoque) || 0;
    notificar(
      est < 1
        ? `Sem estoque: ${produto.nome}`
        : `Estoque baixo: ${produto.nome} (restam ${est})`,
      "alerta"
    );
    focarBuscaProduto();
    return;
  }

  registrarUsoProduto(estado.funcionario?.id, produtoId, qtd);
  renderizarAtalhosRapidos();
  tocarFeedbackCaixa();
  obterMega().atualizarAtalhosTrocoInteligente?.(estado.carrinho);
}

/** Feedback ao adicionar item (configurável: curto / longo / off). */
function tocarFeedbackCaixa() {
  const modo = estado.configLoja?.beepModo || "curto";
  if (modo === "off") return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!estado._audioCtx) estado._audioCtx = new Ctx();
    const ctx = estado._audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = modo === "longo" ? 660 : 880;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (modo === "longo" ? 0.14 : 0.05));
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} forma
 */
function definirFormaPagamento(forma) {
  const select = $("forma-pagamento");
  if (!select) return;
  const valor = ["dinheiro", "pix", "debito", "credito"].includes(forma)
    ? forma
    : "dinheiro";
  select.value = valor;
  select.dispatchEvent(new Event("change"));
  sincronizarBotoesPagamento(valor);
  if (valor === "dinheiro") {
    $("carrinho-recebido")?.focus();
    $("carrinho-recebido")?.select();
  }
}

/**
 * @param {string} forma
 */
function sincronizarBotoesPagamento(forma) {
  $("atalhos-pagamento")
    ?.querySelectorAll("[data-pagamento]")
    .forEach((btn) => {
      btn.classList.toggle("ativo", btn.dataset.pagamento === forma);
    });
}

function repetirUltimoProduto() {
  const prefs = lerPreferenciasCaixa(estado.funcionario?.id);
  const ultimoCarrinho = estado.carrinho?.obterUltimoItem()?.produtoId;
  const id = ultimoCarrinho || prefs.ultimoProdutoId;
  if (!id) {
    notificar("Nenhum produto recente para repetir.", "alerta");
    return;
  }
  adicionarAoCarrinho(id, 1);
}

function limparCarrinhoComConfirmacao() {
  if (!estado.carrinho || estado.carrinho.obterItens().length === 0) {
    estado.carrinho?.limpar();
    return;
  }
  const ok = window.confirm("Limpar todos os itens do carrinho?");
  if (ok) estado.carrinho.limpar();
}

function abrirAjudaCaixa() {
  abrirModal("modal-ajuda-caixa");
}

/* ---------------------------------------------------------------------------
 * Busca + codigo de barras
 * ------------------------------------------------------------------------- */

/**
 * @param {string} termo
 */
function atualizarSugestoes(termo) {
  const painel = $("busca-sugestoes");
  const consulta = (termo || "").trim();

  if (consulta.length === 0) {
    painel.classList.add("oculto");
    painel.innerHTML = "";
    return;
  }

  const resultados = buscar(consulta);
  painel.classList.remove("oculto");

  if (resultados.length === 0) {
    const podeCadastrar = podeAgora("cadastrarProduto");
    painel.innerHTML = `
      <div class="sugestao-vazia">
        <p>Nenhum produto para "<strong>${escapeHtml(consulta)}</strong>".</p>
        ${
          podeCadastrar
            ? `<button type="button" class="btn btn-primario" id="btn-criar-da-busca">
          + Cadastrar "${escapeHtml(consulta)}"
        </button>`
            : ""
        }
      </div>`;
    $("btn-criar-da-busca")?.addEventListener("click", () =>
      abrirModalProduto({ nomeInicial: consulta })
    );
    return;
  }

  painel.innerHTML = resultados
    .map((produto) => {
      const semEstoque = (Number(produto.estoque) || 0) < 1;
      return `
      <div class="sugestao" data-produto-id="${escapeHtml(produto.id)}" role="option">
        <div class="sugestao-info">
          <span class="sugestao-nome">${escapeHtml(produto.nome)}</span>
          <span class="sugestao-meta">
            ${formatarMoeda(produto.preco)} ·
            ${semEstoque ? "sem estoque" : `estoque: ${produto.estoque}`}
          </span>
        </div>
        <span class="sugestao-acao">Adicionar</span>
      </div>`;
    })
    .join("");
}

/**
 * Enter na busca: codigo de barras exato ou primeiro resultado fuzzy.
 * Aceita quantidade: agua*3 ou 789*2. Só *3 repete o último com qtd.
 * @param {string} termo
 */
function confirmarBusca(termo) {
  const { consulta, quantidade } = parseBuscaComQuantidade(termo);
  const limparEFocar = () => {
    const input = $("busca-produto");
    if (input) input.value = "";
    atualizarSugestoes("");
    // Sempre devolve o foco (bip contínuo / digitação rápida).
    focarBuscaProduto(estado.configLoja?.modoBarrasContinuo === false ? 0 : 20);
  };

  // Dedup só do mesmo código+qtd em janela curta (Enter duplicado do scanner).
  // Códigos diferentes passam imediatamente — não atrasa bipagem rápida.
  if (consulta) {
    const chave = `${consulta}\0${quantidade}`;
    const agora = Date.now();
    if (chave === ultimoBipeChave && agora - ultimoBipeEm < BIPE_DEDUP_MS) {
      limparEFocar();
      return;
    }
    ultimoBipeChave = chave;
    ultimoBipeEm = agora;
  }

  if (!consulta && quantidade > 1) {
    const ultimo = estado.carrinho?.obterUltimoItem();
    if (ultimo?.produtoId) {
      adicionarAoCarrinho(ultimo.produtoId, quantidade);
      limparEFocar();
      return;
    }
    notificar("Adicione um item antes de usar *quantidade.", "alerta");
    focarBuscaProduto();
    return;
  }

  if (!consulta) return;

  const porCodigo = encontrarPorCodigoBarras(estado.produtos, consulta);
  if (porCodigo) {
    adicionarAoCarrinho(porCodigo.id, quantidade);
    limparEFocar();
    return;
  }

  const resultados = buscar(consulta);
  if (resultados.length > 0) {
    adicionarAoCarrinho(resultados[0].id, quantidade);
    limparEFocar();
  } else {
    notificar(`Não encontrado: ${consulta}`, "alerta");
    focarBuscaProduto();
  }
}

/* ---------------------------------------------------------------------------
 * Produtos
 * ------------------------------------------------------------------------- */

/**
 * @param {{nomeInicial?: string, produto?: object}} [opcoes]
 */
function abrirModalProduto({ nomeInicial = "", produto = null } = {}) {
  const editando = Boolean(produto);
  if (editando && !podeAgora("editarProduto")) {
    notificar("Você não tem permissão para editar produtos.", "alerta");
    return;
  }
  if (!editando && !podeAgora("cadastrarProduto")) {
    notificar("Você não tem permissão para cadastrar produtos.", "alerta");
    return;
  }

  $("form-produto").reset();
  setErro($("produto-erro"), "");
  if ($("produto-explicacao")) $("produto-explicacao").value = "";

  const ehOperador = estado.funcionario?.cargo !== CARGOS.ADMIN;

  $("modal-produto-titulo").textContent = editando
    ? "Editar produto"
    : "Cadastrar produto";
  $("produto-id").value = produto?.id || "";
  $("produto-nome").value = produto?.nome || nomeInicial;
  $("produto-preco").value = produto ? String(produto.preco) : "";
  $("produto-estoque").value =
    produto && produto.estoque !== null && produto.estoque !== undefined
      ? String(produto.estoque)
      : "";
  $("produto-codigo").value = produto?.codigoBarras || "";
  if ($("produto-codigo-interno")) {
    $("produto-codigo-interno").value = produto?.codigoInterno || "";
  }
  $("produto-categoria").value = produto?.categoria || "";
  if ($("produto-unidade")) {
    $("produto-unidade").value = produto?.unidade === "kg" ? "kg" : "un";
  }
  if ($("produto-unidades-caixa")) {
    $("produto-unidades-caixa").value = produto?.unidadesPorCaixa
      ? String(produto.unidadesPorCaixa)
      : "";
  }
  if ($("produto-validade")) {
    $("produto-validade").value = produto?.validade || "";
  }
  if ($("produto-preco-promo")) {
    $("produto-preco-promo").value =
      produto?.precoPromocao != null && produto?.precoPromocao !== ""
        ? String(produto.precoPromocao)
        : "";
  }
  if ($("produto-promo-fim")) {
    $("produto-promo-fim").value = produto?.promoFim || "";
  }
  $("produto-custo").value =
    produto?.custo !== null &&
    produto?.custo !== undefined &&
    produto?.custo !== ""
      ? String(produto.custo)
      : "";
  atualizarPreviewMargem();
  $("produto-adicionar-venda").checked = !editando;
  $("wrap-adicionar-venda").classList.toggle("oculto", editando);
  $("wrap-produto-explicacao")?.classList.toggle("oculto", !editando || !ehOperador);
  aplicarCamposCadastroProduto(estado.configLoja);

  abrirModal("modal-produto");
  (editando ? $("produto-nome") : $("produto-preco")).focus();
}

function atualizarPreviewMargem() {
  const preco = Number($("produto-preco")?.value);
  const custoRaw = $("produto-custo")?.value;
  const custo =
    custoRaw === "" || custoRaw === undefined ? null : Number(custoRaw);
  const margem = calcularMargemPercentual(preco, custo);
  const el = $("produto-margem");
  if (!el) return;
  if (margem === null) {
    el.value = "";
    el.placeholder = "—";
    return;
  }
  el.value = `${margem}%`;
}

function abrirModalExcluir(produto) {
  estado.produtoExcluirId = produto.id;
  $("excluir-produto-resumo").textContent =
    `Remover "${produto.nome}" do catálogo? Esta ação não pode ser desfeita.`;
  abrirModal("modal-excluir-produto");
}

async function tratarCadastroProduto(evento) {
  evento.preventDefault();
  setErro($("produto-erro"), "");

  const idExistente = $("produto-id").value.trim();
  const ehOperador = estado.funcionario?.cargo !== CARGOS.ADMIN;

  if (idExistente && !podeAgora("editarProduto")) {
    setErro($("produto-erro"), "Você não tem permissão para editar produtos.");
    return;
  }
  if (!idExistente && !podeAgora("cadastrarProduto")) {
    setErro($("produto-erro"), "Você não tem permissão para cadastrar produtos.");
    return;
  }

  const atual = idExistente
    ? estado.produtos.find((p) => p.id === idExistente)
    : null;
  const cfg = estado.configLoja || {};
  const visivel = (chave) => cfg[chave] !== false;

  const explicacao = ($("produto-explicacao")?.value || "").trim();
  if (idExistente && ehOperador && explicacao.length < 8) {
    setErro(
      $("produto-erro"),
      "Informe a explicação da alteração (mínimo 8 caracteres)."
    );
    return;
  }

  const payload = {
    nome: $("produto-nome").value,
    preco: $("produto-preco").value,
    estoque: $("produto-estoque").value === "" ? "0" : $("produto-estoque").value,
    codigoBarras: visivel("campoProdutoCodigos")
      ? $("produto-codigo").value
      : atual?.codigoBarras || "",
    codigoInterno: visivel("campoProdutoCodigos")
      ? $("produto-codigo-interno")?.value || ""
      : atual?.codigoInterno || "",
    categoria: visivel("campoProdutoCategoria")
      ? $("produto-categoria").value
      : atual?.categoria || "",
    custo: visivel("campoProdutoCusto")
      ? $("produto-custo").value
      : atual?.custo ?? "",
    unidade: visivel("campoProdutoUnidade")
      ? $("produto-unidade")?.value || "un"
      : atual?.unidade || "un",
    unidadesPorCaixa: visivel("campoProdutoCaixa")
      ? $("produto-unidades-caixa")?.value || ""
      : atual?.unidadesPorCaixa || "",
    validade: visivel("campoProdutoValidade")
      ? $("produto-validade")?.value || ""
      : atual?.validade || "",
    precoPromocao: visivel("campoProdutoPromocao")
      ? $("produto-preco-promo")?.value || ""
      : atual?.precoPromocao ?? "",
    promoFim: visivel("campoProdutoPromocao")
      ? $("produto-promo-fim")?.value || ""
      : atual?.promoFim || "",
  };

  try {
    if (idExistente) {
      await atualizarProduto(idExistente, payload);
      if (ehOperador || explicacao) {
        await obterMega().registrarAuditoria({
          tipo: "produto_editado",
          mensagem: `${estado.funcionario?.nome || "Usuário"} alterou "${
            payload.nome
          }"${explicacao ? `: ${explicacao}` : ""}`,
          funcionario: estado.funcionario,
          meta: { produtoId: idExistente, explicacao },
        });
      }
      fecharModal("modal-produto");
      notificar("Produto atualizado.", "sucesso");
      obterMega().marcarPassoOnboarding("produto");
      return;
    }

    const adicionarNaVenda = $("produto-adicionar-venda").checked;
    const id = await criarProduto(payload);
    fecharModal("modal-produto");
    notificar("Produto cadastrado.", "sucesso");
    obterMega().marcarPassoOnboarding("produto");

    if (adicionarNaVenda) {
      const tentar = () => {
        if (estado.produtos.some((p) => p.id === id)) {
          adicionarAoCarrinho(id);
          return true;
        }
        return false;
      };
      if (!tentar()) {
        let tentativas = 0;
        const timer = setInterval(() => {
          tentativas += 1;
          if (tentar() || tentativas >= 10) clearInterval(timer);
        }, 200);
      }
    }

    $("busca-produto").value = "";
    atualizarSugestoes("");
  } catch (erro) {
    setErro($("produto-erro"), erro.message);
  }
}

async function confirmarExcluirProduto() {
  if (!estado.produtoExcluirId) return;
  if (!podeAgora("excluirProduto")) {
    notificar("Você não tem permissão para excluir produtos.", "alerta");
    return;
  }
  try {
    await excluirProduto(estado.produtoExcluirId);
    estado.produtoExcluirId = null;
    fecharModal("modal-excluir-produto");
    notificar("Produto excluído.", "sucesso");
  } catch (erro) {
    notificar(erro.message, "erro");
  }
}

/* ---------------------------------------------------------------------------
 * Funcionários
 * ------------------------------------------------------------------------- */

function abrirModalNovoFuncionario() {
  $("form-funcionario").reset();
  setErro($("func-erro"), "");
  // Padrão: Caixa marcado (área mais comum no PDV)
  $("func-areas")
    ?.querySelectorAll('input[name="func-areas"]')
    .forEach((el) => {
      el.checked = el.value === "caixa";
      el.closest(".area-chip")?.classList.toggle("ativo", el.checked);
    });
  abrirModal("modal-funcionario");
}

async function tratarCadastroFuncionario(evento) {
  evento.preventDefault();
  setErro($("func-erro"), "");

  try {
    const adminOk = await validarAdministrador(
      $("func-admin-usuario").value,
      $("func-admin-senha").value
    );
    if (!adminOk) {
      setErro($("func-erro"), "Credenciais de administrador inválidas.");
      return;
    }

    const areas = lerAreasDoForm($("func-areas"), "func-areas");
    if (areas.length === 0) {
      setErro($("func-erro"), "Marque ao menos uma área: Caixa, RH ou Marketing.");
      return;
    }

    await criarFuncionario({
      nome: $("func-nome").value,
      usuario: $("func-usuario").value,
      senha: $("func-senha").value,
      cargo: $("func-cargo").value,
      areas,
    });

    fecharModal("modal-funcionario");
    $("form-funcionario").reset();
    notificar("Funcionário cadastrado.", "sucesso");
  } catch (erro) {
    setErro($("func-erro"), erro.message);
  }
}

/* ---------------------------------------------------------------------------
 * Venda
 * ------------------------------------------------------------------------- */

/**
 * Abre o modal pós-venda e tenta imprimir o cupom automaticamente.
 * @param {object} venda
 * @param {string} msgExtra
 */
function abrirModalVendaSucesso(venda, msgExtra = "") {
  estado.ultimaVendaCupom = venda;
  const resumo = `Total: ${formatarMoeda(venda.total)}${msgExtra}`;
  $("venda-sucesso-resumo").textContent = resumo;

  const dicaEl = $("venda-sucesso-dica");
  if (dicaEl && DICAS_OPERADOR.length) {
    const dica = DICAS_OPERADOR[estado.indiceDicaOperador % DICAS_OPERADOR.length];
    estado.indiceDicaOperador += 1;
    dicaEl.textContent = dica;
  }

  const status = $("venda-sucesso-impressao-status");
  status.textContent = "Enviando cupom para a impressora...";
  status.className = "venda-impressao-status";
  status.classList.remove("oculto");
  const botaoImprimir = $("btn-imprimir-cupom");
  botaoImprimir.disabled = true;
  botaoImprimir.textContent = "Imprimindo...";
  abrirModal("modal-venda-sucesso");
  imprimirUltimaVenda();
}

/**
 * Envia a última venda para a impressora Jetway JP-800.
 */
async function imprimirUltimaVenda() {
  const venda = estado.ultimaVendaCupom;
  if (!venda) {
    notificar("Nada para imprimir.", "alerta");
    return;
  }

  const botao = $("btn-imprimir-cupom");
  const status = $("venda-sucesso-impressao-status");
  if (!botao || !status) return;
  if (botao.dataset.imprimindo === "1") return;
  botao.dataset.imprimindo = "1";
  botao.disabled = true;
  botao.textContent = "Imprimindo…";
  status.className = "venda-impressao-status";
  status.textContent = "Enviando cupom…";
  status.classList.remove("oculto");

  const liberarImpressao = (textoBotao) => {
    botao.disabled = false;
    botao.textContent = textoBotao;
    delete botao.dataset.imprimindo;
  };

  try {
    const impressao = await imprimirCupomVenda(venda);
    if (!impressao?.ok) {
      status.textContent =
        impressao?.mensagem || "Impressora sem resposta — confira o cabo/energia.";
      status.classList.add("erro");
      notificar("Falha na impressão — tente de novo.", "alerta");
      liberarImpressao("Tentar imprimir de novo");
      return;
    }

    status.textContent = impressao.impressora
      ? `Cupom enviado: ${impressao.impressora}`
      : "Cupom enviado à impressora.";
    status.classList.add("ok");
    notificar("Cupom enviado.", "sucesso");
    liberarImpressao("Imprimir novamente");
  } catch (erro) {
    status.textContent = erro.message || "Falha ao imprimir o cupom.";
    status.classList.add("erro");
    notificar("Falha na impressão — tente de novo.", "erro");
    liberarImpressao("Tentar imprimir de novo");
  } finally {
    // Cinto e suspenders: nunca deixar o guard travado.
    if (botao.dataset.imprimindo === "1") {
      liberarImpressao("Tentar imprimir de novo");
    }
  }
}

async function finalizarVenda() {
  if (estado.finalizandoVenda) return;
  const itens = estado.carrinho?.obterItens() || [];
  if (itens.length === 0) return;

  const botao = $("btn-finalizar");
  const textoBotao = botao?.textContent || "Finalizar venda (F12)";
  estado.finalizandoVenda = true;
  if (botao) {
    botao.disabled = true;
    botao.classList.add("is-carregando");
    botao.textContent = "Finalizando…";
  }
  if (estado.carrinho) estado.carrinho.bloqueadoFinalizar = true;

  const liberarBotao = () => {
    estado.finalizandoVenda = false;
    if (estado.carrinho) estado.carrinho.bloqueadoFinalizar = false;
    if (!botao) return;
    botao.classList.remove("is-carregando");
    botao.textContent = textoBotao;
    const temItens = (estado.carrinho?.obterItens() || []).length > 0;
    botao.disabled = !temItens || !estado.carrinho?.pagamentoDinheiroOk();
  };

  try {
    const mega = obterMega();
    const validacao = await mega.validarAntesDeFinalizar(estado.carrinho);
    if (!validacao.ok) {
      liberarBotao();
      return;
    }

    if (!validacao.foiFiado && !estado.carrinho.pagamentoDinheiroOk()) {
      notificar("Valor recebido insuficiente.", "alerta");
      liberarBotao();
      $("carrinho-recebido")?.focus();
      return;
    }

    const troco = validacao.foiFiado ? 0 : estado.carrinho.obterTroco();
    const valorRecebido = validacao.foiFiado
      ? 0
      : estado.carrinho.obterValorRecebido();
    const forma = validacao.foiFiado ? "fiado" : $("forma-pagamento").value;
    const formas = validacao.foiFiado
      ? null
      : estado.carrinho.obterFormasPagamento();
    if (!validacao.foiFiado && estado.carrinho.dividirPagamento && !formas) {
      notificar("Pagamento dividido: informe a parte em dinheiro.", "alerta");
      liberarBotao();
      return;
    }

    const descontoBase = estado.carrinho.obterDesconto();
    const descontoTotal =
      descontoBase + (Number(validacao.descontoExtra) || 0);
    const cli = estado.clientes?.find((c) => c.id === validacao.clienteId);

    const venda = await registrarVenda({
      itens,
      desconto: descontoTotal,
      formaPagamento: forma,
      formasPagamento: formas,
      funcionario: estado.funcionario,
      clienteId: validacao.clienteId,
      clienteNome: cli?.nome || null,
      fiado: validacao.foiFiado,
    });
    estado.carrinho.limpar();
    const checkDiv = $("check-dividir-pagamento");
    if (checkDiv) checkDiv.checked = false;
    await mega.aposVendaMega(venda, validacao);
    mega.marcarPassoOnboarding("venda");

    const msgTroco =
      (forma === "dinheiro" || venda.formaPagamento === "misto") && troco > 0
        ? ` · Troco ${formatarMoeda(troco)}`
        : "";
    const extras = [];
    if (venda.formaPagamento === "misto") extras.push("dividido");
    if (validacao.foiFiado) extras.push("fiado");
    const msgExtra = extras.length ? ` · ${extras.join(", ")}` : "";
    notificar(
      `Venda: ${formatarMoeda(venda.total)}${msgTroco}${msgExtra}`,
      "sucesso"
    );
    obterRevolucao().atualizarMetaCaixa();
    liberarBotao();
    abrirModalVendaSucesso(
      {
        ...venda,
        valorRecebido,
        troco,
        abrirGaveta: Boolean(estado.configLoja?.abrirGavetaAoVender),
      },
      msgTroco
    );
  } catch (erro) {
    notificar(erro.message || "Falha ao finalizar — tente de novo.", "erro");
    liberarBotao();
  }
}

/* ---------------------------------------------------------------------------
 * Eventos
 * ------------------------------------------------------------------------- */

function registrarEventosGerais() {
  $("form-ativacao")?.addEventListener("submit", tratarAtivacao);
  $("btn-testar-conexao")?.addEventListener("click", () => {
    void atualizarStatusConexao();
  });
  $("form-setup").addEventListener("submit", tratarSetup);
  $("form-login").addEventListener("submit", tratarLogin);
  $("btn-sair").addEventListener("click", sair);

  $("form-produto").addEventListener("submit", tratarCadastroProduto);
  $("produto-preco")?.addEventListener("input", atualizarPreviewMargem);
  $("produto-custo")?.addEventListener("input", atualizarPreviewMargem);
  $("btn-sugerir-preco")?.addEventListener("click", () => {
    const custo = Number($("produto-custo")?.value);
    if (!Number.isFinite(custo) || custo < 0 || $("produto-custo").value === "") {
      notificar("Informe o custo para sugerir o preço.", "alerta");
      return;
    }
    $("produto-preco").value = String(sugerirPrecoPorCusto(custo, 40));
    atualizarPreviewMargem();
  });
  $("form-funcionario").addEventListener("submit", tratarCadastroFuncionario);
  $("func-areas")?.addEventListener("change", (evento) => {
    const check = evento.target.closest('input[name="func-areas"]');
    if (!check) return;
    check.closest(".area-chip")?.classList.toggle("ativo", check.checked);
  });
  $("btn-confirmar-excluir").addEventListener("click", confirmarExcluirProduto);

  window.addEventListener("cybhor-abrir-assistente-area", (evento) => {
    const { area, prompt } = evento.detail || {};
    if (estado.funcionario?.cargo !== CARGOS.ADMIN) {
      notificar("Somente administradores usam a CybhorIA.", "alerta");
      return;
    }
    navegarPara("assistente");
    iniciarAssistente();
    estado.painelAssistente?.prepararPergunta(area, prompt || "");
    if (prompt) {
      notificar("Pergunta pronta na CybhorIA — revise e envie.", "sucesso");
    }
  });

  document.addEventListener("click", (evento) => {
    if (evento.target.closest("#btn-ia-reposicao")) {
      pedirSugestaoReposicaoIa();
      return;
    }
    if (evento.target.closest("#btn-wa-reposicao")) {
      const baixos = listarEstoqueBaixo(estado.produtos, estado.estoqueMinimo);
      const sugeridos = listarFornecedoresParaReposicao(
        baixos,
        estado.fornecedores
      );
      const forn = sugeridos[0];
      if (!forn) {
        notificar("Nenhum fornecedor compatível com WhatsApp.", "alerta");
        return;
      }
      obterRevolucao().abrirWhatsAppReposicao(
        (forn.produtosSugeridos || []).map((nome) => {
          const p = baixos.find((b) => b.nome === nome);
          return { nome, estoque: p?.estoque };
        }),
        forn
      );
      return;
    }
    if (evento.target.closest("#btn-ir-fornecedores")) {
      sairDaVendaRapida();
      fecharPainelSino();
      if (estado.funcionario?.cargo === CARGOS.ADMIN) {
        navegarPara("fornecedores");
      }
      return;
    }
    if (
      !evento.target.closest("#painel-sino-estoque") &&
      !evento.target.closest("#btn-sino-estoque")
    ) {
      fecharPainelSino();
    }
    if (evento.target.closest("#btn-corrigir-nomes-ia")) {
      abrirCorrigirNomesComIa();
      return;
    }
    if (evento.target.closest("#btn-aplicar-nomes-aceitos")) {
      aplicarNomesAceitos();
    }
  });

  $("btn-novo-funcionario").addEventListener("click", abrirModalNovoFuncionario);
  $("btn-novo-produto").addEventListener("click", () => abrirModalProduto());
  $("btn-novo-produto-pdv").addEventListener("click", () => abrirModalProduto());

  $("input-csv-produtos")?.addEventListener("change", async (evento) => {
    const arquivo = evento.target.files?.[0];
    evento.target.value = "";
    if (!arquivo) return;
    try {
      const texto = await arquivo.text();
      const resultado = await importarProdutosCsv(texto);
      notificar(
        `${resultado.criados} produto(s) importado(s).${
          resultado.erros.length
            ? ` ${resultado.erros.length} linha(s) com erro.`
            : ""
        }`,
        resultado.erros.length ? "alerta" : "sucesso",
        5000
      );
      if (resultado.erros[0]) {
        console.warn(resultado.erros.slice(0, 5));
      }
    } catch (erro) {
      notificar(erro.message, "erro");
    }
  });

  document.querySelectorAll(".nav-item[data-rota]").forEach((botao) => {
    botao.addEventListener("click", () => navegarPara(botao.dataset.rota));
  });

  $("btn-finalizar").addEventListener("click", finalizarVenda);
  $("btn-limpar").addEventListener("click", limparCarrinhoComConfirmacao);
  $("btn-imprimir-cupom").addEventListener("click", imprimirUltimaVenda);
  $("btn-ajuda-caixa")?.addEventListener("click", abrirAjudaCaixa);
  $("btn-toggle-categorias")?.addEventListener("click", () => {
    try {
      localStorage.setItem(
        CHAVE_CATEGORIAS_RECOLHIDAS,
        categoriasRecolhidas() ? "0" : "1"
      );
    } catch {
      /* ignore */
    }
    aplicarEstadoCategorias();
  });
  $("btn-sino-estoque")?.addEventListener("click", (evento) => {
    evento.stopPropagation();
    const painel = $("painel-sino-estoque");
    if (!painel) return;
    if (painel.classList.contains("oculto")) abrirPainelSino();
    else fecharPainelSino();
  });
  $("btn-fechar-sino")?.addEventListener("click", () => fecharPainelSino());
  $("btn-sair-venda-rapida")?.addEventListener("click", () => {
    sairDaVendaRapida();
  });
  $("btn-cadastrar-venda-rapida")?.addEventListener("click", () => {
    sairDaVendaRapida();
    abrirModalProduto();
  });

  $("atalhos-pagamento")?.addEventListener("click", (evento) => {
    const botao = evento.target.closest("[data-pagamento]");
    if (!botao) return;
    definirFormaPagamento(botao.dataset.pagamento);
  });

  $("forma-pagamento")?.addEventListener("change", (evento) => {
    sincronizarBotoesPagamento(evento.target.value);
  });

  $("atalhos-rapidos")?.addEventListener("click", (evento) => {
    const botao = evento.target.closest("[data-produto-id]");
    if (!botao) return;
    adicionarAoCarrinho(botao.dataset.produtoId);
    focarBuscaProduto();
  });

  $("filtros-categoria")?.addEventListener("click", (evento) => {
    const chip = evento.target.closest("[data-categoria]");
    if (!chip) return;
    estado.categoriaFiltro = chip.dataset.categoria || "";
    estado.assinaturaProdutos = "";
    renderizarFiltrosCategoria(estado.produtos);
    renderizarGradeProdutos(estado.produtos);
  });

  $("atalhos-troco")?.addEventListener("click", (evento) => {
    const botao = evento.target.closest("[data-troco-extra]");
    if (!botao || !estado.carrinho) return;
    const extra = Number(botao.dataset.trocoExtra) || 0;
    const total = estado.carrinho.obterTotal();
    const valor = Number((total + extra).toFixed(2));
    $("carrinho-recebido").value = String(valor);
    estado.carrinho.valorRecebido = valor;
    estado.carrinho._atualizarTotais();
  });

  document.querySelectorAll("[data-fechar-modal]").forEach((botao) => {
    botao.addEventListener("click", () => {
      const id = botao.dataset.fecharModal;
      fecharModal(id);
      if (id === "modal-alterar-cargo") {
        estado.painelFuncionarios?.fecharModalAuth();
      }
      if (id === "modal-alterar-senha") {
        estado.painelFuncionarios?.fecharModalSenha();
      }
      if (id === "modal-cancelar-venda") {
        estado.painelHistorico?.fecharModalCancelar();
      }
      if (id === "modal-venda-sucesso" || id === "modal-ajuda-caixa") {
        if (estado.rotaAtual === "pdv") {
          focarBuscaProduto(40);
        }
      }
    });
  });

  // Fecha modal ao clicar no backdrop (fora da caixa)
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (evento) => {
      if (evento.target === modal) {
        modal.classList.add("oculto");
        if (modal.id === "modal-alterar-cargo") {
          estado.painelFuncionarios?.fecharModalAuth();
        }
        if (modal.id === "modal-alterar-senha") {
          estado.painelFuncionarios?.fecharModalSenha();
        }
        if (modal.id === "modal-cancelar-venda") {
          estado.painelHistorico?.fecharModalCancelar();
        }
      }
    });
  });

  const inputBusca = $("busca-produto");
  const buscaDebounced = debounce((valor) => atualizarSugestoes(valor), 120);

  inputBusca.addEventListener("input", (e) => buscaDebounced(e.target.value));
  inputBusca.addEventListener("focus", (e) =>
    atualizarSugestoes(e.target.value)
  );
  inputBusca.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmarBusca(e.target.value);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      inputBusca.value = "";
      atualizarSugestoes("");
      focarBuscaProduto();
    }
  });

  $("busca-sugestoes").addEventListener("click", (evento) => {
    const alvo = evento.target.closest(".sugestao[data-produto-id]");
    if (!alvo) return;
    adicionarAoCarrinho(alvo.dataset.produtoId);
    inputBusca.value = "";
    atualizarSugestoes("");
    focarBuscaProduto();
  });

  $("lista-produtos").addEventListener("click", (evento) => {
    const favBtn = evento.target.closest("[data-favorito-id]");
    if (favBtn) {
      evento.preventDefault();
      evento.stopPropagation();
      const id = favBtn.dataset.favoritoId;
      const ficou = alternarFavorito(estado.funcionario?.id, id);
      estado.assinaturaProdutos = "";
      renderizarGradeProdutos(estado.produtos);
      renderizarAtalhosRapidos();
      notificar(
        ficou ? "Produto fixado nos favoritos." : "Removido dos favoritos.",
        "sucesso"
      );
      return;
    }

    const editarBtn = evento.target.closest("[data-editar-produto]");
    if (editarBtn) {
      evento.preventDefault();
      evento.stopPropagation();
      if (!podeAgora("editarProduto")) {
        notificar("Você não tem permissão para editar produtos.", "alerta");
        return;
      }
      const produto = estado.produtos.find(
        (p) => p.id === editarBtn.dataset.editarProduto
      );
      if (produto) abrirModalProduto({ produto });
      return;
    }

    const card = evento.target.closest(".produto-card[data-produto-id]");
    if (!card || card.classList.contains("sem-estoque")) return;
    adicionarAoCarrinho(card.dataset.produtoId);
    focarBuscaProduto();
  });

  document.addEventListener("click", (evento) => {
    if (!evento.target.closest(".busca")) {
      $("busca-sugestoes").classList.add("oculto");
    }
  });

  document.addEventListener("keydown", (evento) => {
    const alvo = evento.target;
    const digitando =
      alvo &&
      (alvo.tagName === "INPUT" ||
        alvo.tagName === "TEXTAREA" ||
        alvo.tagName === "SELECT" ||
        alvo.isContentEditable);

    if (evento.key === "Escape") {
      const painelSino = $("painel-sino-estoque");
      if (painelSino && !painelSino.classList.contains("oculto")) {
        fecharPainelSino();
        evento.preventDefault();
        return;
      }
      if (document.body.classList.contains("venda-rapida")) {
        sairDaVendaRapida();
        evento.preventDefault();
        return;
      }
      document.querySelectorAll(".modal:not(.oculto)").forEach((modal) => {
        modal.classList.add("oculto");
      });
      estado.painelFuncionarios?.fecharModalAuth();
      estado.painelFuncionarios?.fecharModalSenha();
      estado.painelHistorico?.fecharModalCancelar();
      $("busca-sugestoes")?.classList.add("oculto");
      if (estado.rotaAtual === "pdv") {
        const busca = $("busca-produto");
        if (busca) busca.value = "";
        atualizarSugestoes("");
        focarBuscaProduto();
      }
      return;
    }

    if ($("tela-app").classList.contains("oculto")) return;
    if (document.querySelector(".modal:not(.oculto)")) return;

    if (evento.key === "F1") {
      evento.preventDefault();
      abrirAjudaCaixa();
      return;
    }

    if (evento.key === "F2") {
      evento.preventDefault();
      navegarPara("pdv");
      $("busca-produto")?.focus();
      $("busca-produto")?.select();
      return;
    }

    if (evento.key === "F5") {
      evento.preventDefault();
      if (estado.rotaAtual === "pdv") definirFormaPagamento("dinheiro");
      return;
    }
    if (evento.key === "F6") {
      evento.preventDefault();
      if (estado.rotaAtual === "pdv") definirFormaPagamento("pix");
      return;
    }
    if (evento.key === "F7") {
      evento.preventDefault();
      if (estado.rotaAtual === "pdv") definirFormaPagamento("debito");
      return;
    }
    if (evento.key === "F8") {
      evento.preventDefault();
      if (estado.rotaAtual === "pdv") definirFormaPagamento("credito");
      return;
    }

    if (evento.key === "F9") {
      evento.preventDefault();
      if (estado.rotaAtual === "pdv") repetirUltimoProduto();
      return;
    }

    if (evento.key === "F12") {
      evento.preventDefault();
      if (
        estado.rotaAtual === "pdv" &&
        !estado.finalizandoVenda &&
        !$("btn-finalizar")?.disabled
      ) {
        finalizarVenda();
      }
      return;
    }

    if (
      (evento.ctrlKey || evento.metaKey) &&
      (evento.key === "l" || evento.key === "L") &&
      estado.rotaAtual === "pdv"
    ) {
      evento.preventDefault();
      limparCarrinhoComConfirmacao();
      return;
    }

    if (
      !digitando &&
      evento.key === "/" &&
      estado.rotaAtual === "pdv"
    ) {
      evento.preventDefault();
      $("busca-produto")?.focus();
    }

    if (
      (evento.ctrlKey || evento.metaKey) &&
      evento.key === "Enter" &&
      estado.rotaAtual === "pdv" &&
      !estado.finalizandoVenda &&
      !$("btn-finalizar")?.disabled
    ) {
      evento.preventDefault();
      finalizarVenda();
    }
  });
}

window.addEventListener(EVENTO_SESSAO_EXPIRADA, () => {
  if (!estado.funcionario) return;
  const preservou = capturarCarrinhoPendente();
  sair({ preservarCarrinho: true });
  notificar(
    preservou
      ? "Sessão expirada no meio da venda. Faça login — o carrinho será restaurado."
      : "Sessão expirada. Faça login novamente.",
    "alerta",
    7000
  );
});

iniciar();
