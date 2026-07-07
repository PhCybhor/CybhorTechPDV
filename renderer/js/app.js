import {
  existeAdministrador,
  autenticar,
  criarFuncionario,
  validarAdministrador,
  observarFuncionarios,
  CARGOS,
} from "./services/authService.js";
import {
  observarProdutos,
  criarProduto,
} from "./services/produtoService.js";
import { registrarVenda, observarVendas } from "./services/vendaService.js";
import { atualizarIndice, buscar } from "./services/buscaFuzzy.js";
import { Carrinho } from "./ui/carrinho.js";
import { Dashboard } from "./ui/dashboard.js";
import { PainelFuncionarios } from "./ui/funcionarios.js";
import { notificar } from "./ui/notificacao.js";
import { formatarMoeda } from "./utils/formato.js";
import { debounce } from "./utils/debounce.js";
import { escapeHtml } from "./utils/escape.js";

/** Estado global minimo da aplicacao. */
const estado = {
  funcionario: null,
  produtos: [],
  carrinho: null,
  dashboard: null,
  painelFuncionarios: null,
  cancelarObservacaoVendas: null,
  cancelarObservacaoFuncionarios: null,
  assinaturaProdutos: "",
};

const $ = (id) => document.getElementById(id);

/**
 * Exibe apenas a tela informada, ocultando as demais.
 * @param {string} idTela
 */
function mostrarTela(idTela) {
  ["tela-carregando", "tela-setup", "tela-login", "tela-pdv", "tela-relatorios", "tela-funcionarios"].forEach(
    (id) => {
      $(id).classList.toggle("oculto", id !== idTela);
    }
  );
}

function abrirModal(id) {
  $(id).classList.remove("oculto");
}

function fecharModal(id) {
  $(id).classList.add("oculto");
}

/* ---------------------------------------------------------------------------
 * Inicializacao
 * ------------------------------------------------------------------------- */

async function iniciar() {
  registrarEventosGerais();

  try {
    const temAdmin = await existeAdministrador();
    mostrarTela(temAdmin ? "tela-login" : "tela-setup");
  } catch (erro) {
    notificar(
      "Falha ao conectar ao servidor. Verifique sua conexao com a internet.",
      "erro",
      6000
    );
    mostrarTela("tela-login");
  }
}

/* ---------------------------------------------------------------------------
 * Autenticacao
 * ------------------------------------------------------------------------- */

async function tratarSetup(evento) {
  evento.preventDefault();
  const erroEl = $("setup-erro");
  erroEl.textContent = "";

  try {
    await criarFuncionario({
      nome: $("setup-nome").value,
      usuario: $("setup-usuario").value,
      senha: $("setup-senha").value,
      cargo: CARGOS.ADMIN,
    });
    notificar("Administrador criado com sucesso.", "sucesso");
    $("form-setup").reset();
    mostrarTela("tela-login");
  } catch (erro) {
    erroEl.textContent = erro.message;
  }
}

async function tratarLogin(evento) {
  evento.preventDefault();
  const erroEl = $("login-erro");
  erroEl.textContent = "";

  try {
    estado.funcionario = await autenticar(
      $("login-usuario").value,
      $("login-senha").value
    );
    $("form-login").reset();
    await entrarNoPdv();
  } catch (erro) {
    erroEl.textContent = erro.message;
  }
}

function sair() {
  estado.funcionario = null;
  estado.carrinho?.limpar();
  pararObservacaoVendas();
  pararObservacaoFuncionarios();
  mostrarTela("tela-login");
}

/* ---------------------------------------------------------------------------
 * Relatorios (somente administrador)
 * ------------------------------------------------------------------------- */

/** Encerra a escuta em tempo real das vendas, se ativa. */
function pararObservacaoVendas() {
  if (typeof estado.cancelarObservacaoVendas === "function") {
    estado.cancelarObservacaoVendas();
    estado.cancelarObservacaoVendas = null;
  }
}

/** Abre o painel de relatorios e passa a observar as vendas em tempo real. */
async function abrirRelatorios() {
  if (estado.funcionario?.cargo !== CARGOS.ADMIN) return;

  pararObservacaoFuncionarios();
  $("admin-barra").classList.remove("oculto");

  if (!estado.dashboard) {
    estado.dashboard = new Dashboard({ raiz: $("tela-relatorios") });
  }

  mostrarTela("tela-relatorios");

  try {
    estado.cancelarObservacaoVendas = await observarVendas((vendas) =>
      estado.dashboard.atualizar(vendas)
    );
  } catch (erro) {
    notificar("Nao foi possivel carregar os relatorios.", "erro");
  }
}

/** Fecha os relatorios e volta ao PDV. */
function fecharRelatorios() {
  pararObservacaoVendas();
  mostrarTela("tela-pdv");
}

/* ---------------------------------------------------------------------------
 * Funcionarios (somente administrador)
 * ------------------------------------------------------------------------- */

function pararObservacaoFuncionarios() {
  if (typeof estado.cancelarObservacaoFuncionarios === "function") {
    estado.cancelarObservacaoFuncionarios();
    estado.cancelarObservacaoFuncionarios = null;
  }
}

async function abrirFuncionarios() {
  if (estado.funcionario?.cargo !== CARGOS.ADMIN) return;

  pararObservacaoVendas();

  if (!estado.painelFuncionarios) {
    estado.painelFuncionarios = new PainelFuncionarios({
      raiz: $("tela-funcionarios"),
    });
  }

  mostrarTela("tela-funcionarios");

  try {
    estado.cancelarObservacaoFuncionarios = await observarFuncionarios(
      (funcionarios) => estado.painelFuncionarios.atualizar(funcionarios)
    );
  } catch {
    notificar("Nao foi possivel carregar os funcionarios.", "erro");
  }
}

function fecharFuncionarios() {
  pararObservacaoFuncionarios();
  mostrarTela("tela-pdv");
}

function abrirModalNovoFuncionario() {
  $("form-funcionario").reset();
  $("func-erro").textContent = "";
  abrirModal("modal-funcionario");
}

/* ---------------------------------------------------------------------------
 * PDV
 * ------------------------------------------------------------------------- */

async function entrarNoPdv() {
  const { nome, cargo } = estado.funcionario;
  const ehAdmin = cargo === CARGOS.ADMIN;
  $("pdv-funcionario").innerHTML = `<strong>${escapeHtml(nome)}</strong> · ${escapeHtml(cargo)}`;
  $("btn-novo-funcionario").classList.toggle("oculto", !ehAdmin);
  $("btn-relatorios").classList.toggle("oculto", !ehAdmin);
  $("btn-funcionarios").classList.toggle("oculto", !ehAdmin);

  estado.assinaturaProdutos = "";

  estado.carrinho = new Carrinho({
    containerItens: $("carrinho-itens"),
    elementoSubtotal: $("carrinho-subtotal-valor"),
    inputDesconto: $("carrinho-desconto"),
    elementoTotal: $("carrinho-total-valor"),
    botaoFinalizar: $("btn-finalizar"),
  });

  await observarProdutos((produtos) => {
    estado.produtos = produtos;
    atualizarIndice(produtos);
    renderizarGradeProdutos(produtos);
    atualizarSugestoes($("busca-produto").value);
  });

  mostrarTela("tela-pdv");
}

/**
 * Renderiza a grade de produtos. So reescreve o DOM quando a lista mudou,
 * evitando flicker desnecessario a cada tick do Realtime Database.
 * @param {Array<object>} produtos
 */
function renderizarGradeProdutos(produtos) {
  const container = $("lista-produtos");
  const ordenados = [...produtos].sort((a, b) => a.nome.localeCompare(b.nome));

  const assinatura = ordenados
    .map((p) => `${p.id}:${p.estoque}:${p.preco}`)
    .join("|");

  if (assinatura === estado.assinaturaProdutos) return;
  estado.assinaturaProdutos = assinatura;

  if (ordenados.length === 0) {
    container.innerHTML =
      '<p class="grade-vazia">Nenhum produto cadastrado.<br>Use a busca para cadastrar o primeiro.</p>';
    return;
  }

  container.innerHTML = ordenados
    .map((produto) => {
      const semEstoque = (Number(produto.estoque) || 0) < 1;
      return `
      <div class="produto-card${semEstoque ? " sem-estoque" : ""}" data-produto-id="${escapeHtml(produto.id)}">
        <span class="produto-nome">${escapeHtml(produto.nome)}</span>
        <span class="produto-preco">${formatarMoeda(produto.preco)}</span>
        <span class="produto-estoque ${semEstoque ? "sem" : ""}">
          ${semEstoque ? "Sem estoque" : `Estoque: ${produto.estoque}`}
        </span>
      </div>`;
    })
    .join("");
}

/**
 * Adiciona um produto ao carrinho pelo id, avisando quando sem estoque.
 * @param {string} produtoId
 */
function adicionarAoCarrinho(produtoId) {
  const produto = estado.produtos.find((p) => p.id === produtoId);
  if (!produto) return;

  const adicionado = estado.carrinho.adicionar(produto);
  if (!adicionado) {
    notificar(
      `"${produto.nome}" sem estoque suficiente. Cadastre/reabasteca o produto.`,
      "alerta"
    );
  }
}

/* ---------------------------------------------------------------------------
 * Busca com sugestao (fuzzy)
 * ------------------------------------------------------------------------- */

/**
 * Atualiza a lista de sugestoes conforme o termo digitado.
 * Quando nada e encontrado, oferece o cadastro rapido do produto.
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
    painel.innerHTML = `
      <div class="sugestao-vazia">
        <p>Nenhum produto encontrado para "<strong>${escapeHtml(consulta)}</strong>".</p>
        <button class="btn btn-primario" id="btn-criar-da-busca">
          + Cadastrar "${escapeHtml(consulta)}"
        </button>
      </div>`;
    $("btn-criar-da-busca").addEventListener("click", () =>
      abrirModalProduto(consulta)
    );
    return;
  }

  painel.innerHTML = resultados
    .map((produto) => {
      const semEstoque = (Number(produto.estoque) || 0) < 1;
      return `
      <div class="sugestao" data-produto-id="${escapeHtml(produto.id)}">
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

/* ---------------------------------------------------------------------------
 * Cadastro rapido de produto
 * ------------------------------------------------------------------------- */

/**
 * Abre o modal de cadastro de produto, opcionalmente com o nome pre-preenchido.
 * @param {string} [nomeInicial=""]
 */
function abrirModalProduto(nomeInicial = "") {
  $("form-produto").reset();
  $("produto-erro").textContent = "";
  $("produto-nome").value = nomeInicial;
  $("produto-estoque").value = "1";
  $("produto-adicionar-venda").checked = true;
  abrirModal("modal-produto");
  $("produto-preco").focus();
}

async function tratarCadastroProduto(evento) {
  evento.preventDefault();
  const erroEl = $("produto-erro");
  erroEl.textContent = "";

  try {
    const adicionarNaVenda = $("produto-adicionar-venda").checked;
    const id = await criarProduto({
      nome: $("produto-nome").value,
      preco: $("produto-preco").value,
      estoque: $("produto-estoque").value,
      codigoBarras: $("produto-codigo").value,
      categoria: $("produto-categoria").value,
    });

    fecharModal("modal-produto");
    notificar("Produto cadastrado com sucesso.", "sucesso");

    if (adicionarNaVenda) {
      // O observador em tempo real atualiza estado.produtos; aguardamos um tick.
      setTimeout(() => adicionarAoCarrinho(id), 400);
    }

    $("busca-produto").value = "";
    atualizarSugestoes("");
  } catch (erro) {
    erroEl.textContent = erro.message;
  }
}

/* ---------------------------------------------------------------------------
 * Cadastro de funcionario / caixa (autorizado por admin)
 * ------------------------------------------------------------------------- */

async function tratarCadastroFuncionario(evento) {
  evento.preventDefault();
  const erroEl = $("func-erro");
  erroEl.textContent = "";

  try {
    const adminOk = await validarAdministrador(
      $("func-admin-usuario").value,
      $("func-admin-senha").value
    );
    if (!adminOk) {
      erroEl.textContent = "Credenciais de administrador invalidas.";
      return;
    }

    await criarFuncionario({
      nome: $("func-nome").value,
      usuario: $("func-usuario").value,
      senha: $("func-senha").value,
      cargo: $("func-cargo").value,
    });

    fecharModal("modal-funcionario");
    $("form-funcionario").reset();
    notificar("Funcionario cadastrado com sucesso.", "sucesso");
  } catch (erro) {
    erroEl.textContent = erro.message;
  }
}

/* ---------------------------------------------------------------------------
 * Finalizacao da venda
 * ------------------------------------------------------------------------- */

async function finalizarVenda() {
  const itens = estado.carrinho.obterItens();
  if (itens.length === 0) return;

  const botao = $("btn-finalizar");
  botao.disabled = true;

  try {
    const { total } = await registrarVenda({
      itens,
      desconto: estado.carrinho.obterDesconto(),
      formaPagamento: $("forma-pagamento").value,
      funcionario: estado.funcionario,
    });
    estado.carrinho.limpar();
    notificar(`Venda finalizada: ${formatarMoeda(total)}`, "sucesso");
  } catch (erro) {
    notificar(erro.message, "erro");
    botao.disabled = false;
  }
}

/* ---------------------------------------------------------------------------
 * Eventos gerais
 * ------------------------------------------------------------------------- */

function registrarEventosGerais() {
  $("form-setup").addEventListener("submit", tratarSetup);
  $("form-login").addEventListener("submit", tratarLogin);
  $("btn-sair").addEventListener("click", sair);

  $("form-produto").addEventListener("submit", tratarCadastroProduto);
  $("form-funcionario").addEventListener("submit", tratarCadastroFuncionario);

  $("btn-novo-funcionario").addEventListener("click", abrirModalNovoFuncionario);
  $("btn-novo-funcionario-2").addEventListener("click", abrirModalNovoFuncionario);

  $("btn-relatorios").addEventListener("click", abrirRelatorios);
  $("btn-voltar-pdv").addEventListener("click", fecharRelatorios);

  $("btn-funcionarios").addEventListener("click", abrirFuncionarios);
  $("btn-voltar-pdv-func").addEventListener("click", fecharFuncionarios);
  $("btn-gerenciar-func-relatorios").addEventListener("click", abrirFuncionarios);
  $("btn-gerenciar-func-barra").addEventListener("click", abrirFuncionarios);
  $("btn-novo-func-barra").addEventListener("click", abrirModalNovoFuncionario);

  $("btn-finalizar").addEventListener("click", finalizarVenda);
  $("btn-limpar").addEventListener("click", () => estado.carrinho?.limpar());

  document.querySelectorAll("[data-fechar-modal]").forEach((botao) => {
    botao.addEventListener("click", () =>
      fecharModal(botao.dataset.fecharModal)
    );
  });

  const inputBusca = $("busca-produto");
  const buscaDebounced = debounce((valor) => atualizarSugestoes(valor), 120);

  inputBusca.addEventListener("input", (e) => buscaDebounced(e.target.value));
  inputBusca.addEventListener("focus", (e) =>
    atualizarSugestoes(e.target.value)
  );

  // Clique em sugestao adiciona o produto ao carrinho.
  $("busca-sugestoes").addEventListener("click", (evento) => {
    const alvo = evento.target.closest(".sugestao[data-produto-id]");
    if (!alvo) return;
    adicionarAoCarrinho(alvo.dataset.produtoId);
    inputBusca.value = "";
    atualizarSugestoes("");
    inputBusca.focus();
  });

  // Clique em produto da grade adiciona ao carrinho.
  $("lista-produtos").addEventListener("click", (evento) => {
    const card = evento.target.closest(".produto-card[data-produto-id]");
    if (card) adicionarAoCarrinho(card.dataset.produtoId);
  });

  // Fecha as sugestoes ao clicar fora do campo de busca.
  document.addEventListener("click", (evento) => {
    if (!evento.target.closest(".busca")) {
      $("busca-sugestoes").classList.add("oculto");
    }
  });
}

iniciar();
