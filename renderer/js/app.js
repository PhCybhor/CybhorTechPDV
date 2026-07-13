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
  atualizarProduto,
  excluirProduto,
  ajustarEstoque,
  encontrarPorCodigoBarras,
} from "./services/produtoService.js";
import { registrarVenda, observarVendas } from "./services/vendaService.js";
import { imprimirCupomVenda } from "./services/impressaoService.js";
import { atualizarIndice, buscar } from "./services/buscaFuzzy.js";
import { Carrinho } from "./ui/carrinho.js";
import { Dashboard } from "./ui/dashboard.js";
import { PainelFuncionarios } from "./ui/funcionarios.js";
import { PainelProdutos } from "./ui/produtos.js";
import { notificar } from "./ui/notificacao.js";
import { formatarMoeda } from "./utils/formato.js";
import { debounce } from "./utils/debounce.js";
import { escapeHtml } from "./utils/escape.js";

const ROTAS = ["pdv", "produtos", "relatorios", "funcionarios"];

/** Estado global minimo da aplicacao. */
const estado = {
  funcionario: null,
  produtos: [],
  carrinho: null,
  dashboard: null,
  painelFuncionarios: null,
  painelProdutos: null,
  cancelarObservacaoProdutos: null,
  cancelarObservacaoVendas: null,
  cancelarObservacaoFuncionarios: null,
  assinaturaProdutos: "",
  produtoExcluirId: null,
  rotaAtual: "pdv",
  /** Ultima venda finalizada, usada pelo botao de imprimir cupom. */
  ultimaVendaCupom: null,
};

const $ = (id) => document.getElementById(id);

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
  ["tela-carregando", "tela-setup", "tela-login", "tela-app"].forEach((id) => {
    $(id).classList.toggle("oculto", id !== idTela);
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
function navegarPara(rota) {
  if (!ROTAS.includes(rota)) return;
  if (rota !== "pdv" && estado.funcionario?.cargo !== CARGOS.ADMIN) return;

  estado.rotaAtual = rota;

  ROTAS.forEach((nome) => {
    $(`rota-${nome}`).classList.toggle("oculto", nome !== rota);
    const nav = $(`nav-${nome}`);
    if (nav) nav.classList.toggle("ativo", nome === rota);
  });

  if (rota === "relatorios") iniciarRelatorios();
  else pararObservacaoVendas();

  if (rota === "funcionarios") iniciarFuncionarios();
  else pararObservacaoFuncionarios();

  if (rota === "pdv") {
    setTimeout(() => $("busca-produto")?.focus(), 50);
  }
}

/* ---------------------------------------------------------------------------
 * Inicializacao
 * ------------------------------------------------------------------------- */

async function iniciar() {
  registrarEventosGerais();

  try {
    const temAdmin = await existeAdministrador();
    mostrarTela(temAdmin ? "tela-login" : "tela-setup");
  } catch {
    notificar(
      "Falha ao conectar ao banco de dados. Verifique a internet e o arquivo .env.",
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
  setErro($("setup-erro"), "");

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

function sair() {
  estado.funcionario = null;
  estado.carrinho?.destruir();
  estado.carrinho = null;
  estado.painelProdutos?.destruir();
  estado.painelProdutos = null;
  estado.dashboard = null;
  estado.painelFuncionarios = null;
  pararObservacaoProdutos();
  pararObservacaoVendas();
  pararObservacaoFuncionarios();
  estado.assinaturaProdutos = "";
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

async function iniciarRelatorios() {
  if (estado.funcionario?.cargo !== CARGOS.ADMIN) return;

  if (!estado.dashboard) {
    estado.dashboard = new Dashboard({ raiz: $("rota-relatorios") });
  }

  if (estado.cancelarObservacaoVendas) return;

  try {
    estado.cancelarObservacaoVendas = await observarVendas((vendas) =>
      estado.dashboard.atualizar(vendas)
    );
  } catch {
    notificar("Nao foi possivel carregar os relatorios.", "erro");
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
    });
  }

  if (estado.cancelarObservacaoFuncionarios) return;

  try {
    estado.cancelarObservacaoFuncionarios = await observarFuncionarios(
      (funcionarios) => estado.painelFuncionarios.atualizar(funcionarios)
    );
  } catch {
    notificar("Nao foi possivel carregar os funcionarios.", "erro");
  }
}

/* ---------------------------------------------------------------------------
 * App autenticado
 * ------------------------------------------------------------------------- */

async function entrarNoApp() {
  const { nome, cargo } = estado.funcionario;
  const ehAdmin = cargo === CARGOS.ADMIN;

  $("app-funcionario").innerHTML = `<strong>${escapeHtml(nome)}</strong>${escapeHtml(cargo)}`;
  $("nav-produtos").classList.toggle("oculto", !ehAdmin);
  $("nav-relatorios").classList.toggle("oculto", !ehAdmin);
  $("nav-funcionarios").classList.toggle("oculto", !ehAdmin);

  estado.assinaturaProdutos = "";
  estado.carrinho?.destruir();

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
  });

  if (ehAdmin) {
    estado.painelProdutos?.destruir();
    estado.painelProdutos = new PainelProdutos({
      container: $("lista-gestao-produtos"),
      inputFiltro: $("filtro-produtos"),
      onEditar: (produto) => abrirModalProduto({ produto }),
      onExcluir: (produto) => abrirModalExcluir(produto),
      onAjustarEstoque: async (produto, delta) => {
        try {
          await ajustarEstoque(produto.id, produto.estoque, delta);
        } catch (erro) {
          notificar(erro.message, "erro");
        }
      },
    });
  }

  pararObservacaoProdutos();
  estado.cancelarObservacaoProdutos = await observarProdutos((produtos) => {
    estado.produtos = produtos;
    atualizarIndice(produtos);
    renderizarGradeProdutos(produtos);
    estado.painelProdutos?.atualizar(produtos);
    atualizarSugestoes($("busca-produto").value);
  });

  mostrarTela("tela-app");
  navegarPara("pdv");
}

/**
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
      '<p class="grade-vazia">Nenhum produto cadastrado.<br>Use a busca ou o botao Novo produto.</p>';
    return;
  }

  container.innerHTML = ordenados
    .map((produto) => {
      const semEstoque = (Number(produto.estoque) || 0) < 1;
      return `
      <div class="produto-card${semEstoque ? " sem-estoque" : ""}" data-produto-id="${escapeHtml(produto.id)}" ${semEstoque ? 'aria-disabled="true"' : ""}>
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
 * @param {string} produtoId
 */
function adicionarAoCarrinho(produtoId) {
  const produto = estado.produtos.find((p) => p.id === produtoId);
  if (!produto) return;

  const adicionado = estado.carrinho.adicionar(produto);
  if (!adicionado) {
    notificar(
      `"${produto.nome}" sem estoque suficiente.`,
      "alerta"
    );
  }
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
    painel.innerHTML = `
      <div class="sugestao-vazia">
        <p>Nenhum produto para "<strong>${escapeHtml(consulta)}</strong>".</p>
        <button type="button" class="btn btn-primario" id="btn-criar-da-busca">
          + Cadastrar "${escapeHtml(consulta)}"
        </button>
      </div>`;
    $("btn-criar-da-busca").addEventListener("click", () =>
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
 * @param {string} termo
 */
function confirmarBusca(termo) {
  const consulta = (termo || "").trim();
  if (!consulta) return;

  const porCodigo = encontrarPorCodigoBarras(estado.produtos, consulta);
  if (porCodigo) {
    adicionarAoCarrinho(porCodigo.id);
    $("busca-produto").value = "";
    atualizarSugestoes("");
    return;
  }

  const resultados = buscar(consulta);
  if (resultados.length > 0) {
    adicionarAoCarrinho(resultados[0].id);
    $("busca-produto").value = "";
    atualizarSugestoes("");
  }
}

/* ---------------------------------------------------------------------------
 * Produtos
 * ------------------------------------------------------------------------- */

/**
 * @param {{nomeInicial?: string, produto?: object}} [opcoes]
 */
function abrirModalProduto({ nomeInicial = "", produto = null } = {}) {
  $("form-produto").reset();
  setErro($("produto-erro"), "");

  const editando = Boolean(produto);
  $("modal-produto-titulo").textContent = editando
    ? "Editar produto"
    : "Cadastrar produto";
  $("produto-id").value = produto?.id || "";
  $("produto-nome").value = produto?.nome || nomeInicial;
  $("produto-preco").value = produto ? String(produto.preco) : "";
  $("produto-estoque").value = produto ? String(produto.estoque) : "1";
  $("produto-codigo").value = produto?.codigoBarras || "";
  $("produto-categoria").value = produto?.categoria || "";
  $("produto-adicionar-venda").checked = !editando;
  $("wrap-adicionar-venda").classList.toggle("oculto", editando);

  abrirModal("modal-produto");
  (editando ? $("produto-nome") : $("produto-preco")).focus();
}

function abrirModalExcluir(produto) {
  estado.produtoExcluirId = produto.id;
  $("excluir-produto-resumo").textContent =
    `Remover "${produto.nome}" do catalogo? Esta acao nao pode ser desfeita.`;
  abrirModal("modal-excluir-produto");
}

async function tratarCadastroProduto(evento) {
  evento.preventDefault();
  setErro($("produto-erro"), "");

  const idExistente = $("produto-id").value.trim();
  const payload = {
    nome: $("produto-nome").value,
    preco: $("produto-preco").value,
    estoque: $("produto-estoque").value,
    codigoBarras: $("produto-codigo").value,
    categoria: $("produto-categoria").value,
  };

  try {
    if (idExistente) {
      await atualizarProduto(idExistente, payload);
      fecharModal("modal-produto");
      notificar("Produto atualizado.", "sucesso");
      return;
    }

    const adicionarNaVenda = $("produto-adicionar-venda").checked;
    const id = await criarProduto(payload);
    fecharModal("modal-produto");
    notificar("Produto cadastrado.", "sucesso");

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
  try {
    await excluirProduto(estado.produtoExcluirId);
    estado.produtoExcluirId = null;
    fecharModal("modal-excluir-produto");
    notificar("Produto excluido.", "sucesso");
  } catch (erro) {
    notificar(erro.message, "erro");
  }
}

/* ---------------------------------------------------------------------------
 * Funcionarios
 * ------------------------------------------------------------------------- */

function abrirModalNovoFuncionario() {
  $("form-funcionario").reset();
  setErro($("func-erro"), "");
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
      setErro($("func-erro"), "Credenciais de administrador invalidas.");
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
    notificar("Funcionario cadastrado.", "sucesso");
  } catch (erro) {
    setErro($("func-erro"), erro.message);
  }
}

/* ---------------------------------------------------------------------------
 * Venda
 * ------------------------------------------------------------------------- */

/**
 * Abre o modal pos-venda com botao de imprimir o cupom na Jetway.
 * @param {object} venda
 * @param {string} msgExtra
 */
function abrirModalVendaSucesso(venda, msgExtra = "") {
  estado.ultimaVendaCupom = venda;
  const resumo = `Total: ${formatarMoeda(venda.total)}${msgExtra}`;
  $("venda-sucesso-resumo").textContent = resumo;
  const status = $("venda-sucesso-impressao-status");
  status.textContent = "";
  status.classList.add("oculto");
  const botaoImprimir = $("btn-imprimir-cupom");
  botaoImprimir.disabled = false;
  botaoImprimir.textContent = "Imprimir cupom / nota";
  abrirModal("modal-venda-sucesso");
}

/**
 * Envia a ultima venda para a impressora Jetway JP-800.
 */
async function imprimirUltimaVenda() {
  const venda = estado.ultimaVendaCupom;
  if (!venda) {
    notificar("Nenhuma venda disponivel para impressao.", "alerta");
    return;
  }

  const botao = $("btn-imprimir-cupom");
  const status = $("venda-sucesso-impressao-status");
  botao.disabled = true;
  botao.textContent = "Imprimindo...";
  status.classList.add("oculto");

  try {
    const impressao = await imprimirCupomVenda(venda);
    if (!impressao.ok) {
      status.textContent =
        impressao.mensagem || "Impressora nao respondeu. Verifique a Jetway JP-800.";
      status.classList.remove("oculto");
      notificar(status.textContent, "alerta");
      botao.disabled = false;
      botao.textContent = "Tentar imprimir de novo";
      return;
    }

    status.textContent = impressao.impressora
      ? `Enviado para: ${impressao.impressora}`
      : "Cupom enviado para a impressora.";
    status.classList.remove("oculto");
    notificar("Cupom enviado para impressao.", "sucesso");
    botao.textContent = "Imprimir novamente";
    botao.disabled = false;
  } catch (erro) {
    status.textContent = erro.message || "Falha ao imprimir o cupom.";
    status.classList.remove("oculto");
    notificar(status.textContent, "erro");
    botao.disabled = false;
    botao.textContent = "Tentar imprimir de novo";
  }
}

async function finalizarVenda() {
  const itens = estado.carrinho.obterItens();
  if (itens.length === 0) return;

  if (!estado.carrinho.pagamentoDinheiroOk()) {
    notificar("Valor recebido insuficiente para o troco.", "alerta");
    return;
  }

  const botao = $("btn-finalizar");
  botao.disabled = true;

  try {
    const troco = estado.carrinho.obterTroco();
    const valorRecebido = estado.carrinho.obterValorRecebido();
    const forma = $("forma-pagamento").value;
    const venda = await registrarVenda({
      itens,
      desconto: estado.carrinho.obterDesconto(),
      formaPagamento: forma,
      funcionario: estado.funcionario,
    });
    estado.carrinho.limpar();
    const msgTroco =
      forma === "dinheiro" && troco > 0
        ? ` · Troco: ${formatarMoeda(troco)}`
        : "";
    notificar(`Venda finalizada: ${formatarMoeda(venda.total)}${msgTroco}`, "sucesso");
    abrirModalVendaSucesso(
      {
        ...venda,
        valorRecebido,
        troco,
      },
      msgTroco
    );
  } catch (erro) {
    notificar(erro.message, "erro");
    botao.disabled = false;
  }
}

/* ---------------------------------------------------------------------------
 * Eventos
 * ------------------------------------------------------------------------- */

function registrarEventosGerais() {
  $("form-setup").addEventListener("submit", tratarSetup);
  $("form-login").addEventListener("submit", tratarLogin);
  $("btn-sair").addEventListener("click", sair);

  $("form-produto").addEventListener("submit", tratarCadastroProduto);
  $("form-funcionario").addEventListener("submit", tratarCadastroFuncionario);
  $("btn-confirmar-excluir").addEventListener("click", confirmarExcluirProduto);

  $("btn-novo-funcionario").addEventListener("click", abrirModalNovoFuncionario);
  $("btn-novo-produto").addEventListener("click", () => abrirModalProduto());
  $("btn-novo-produto-pdv").addEventListener("click", () => abrirModalProduto());

  document.querySelectorAll(".nav-item[data-rota]").forEach((botao) => {
    botao.addEventListener("click", () => navegarPara(botao.dataset.rota));
  });

  $("btn-finalizar").addEventListener("click", finalizarVenda);
  $("btn-limpar").addEventListener("click", () => estado.carrinho?.limpar());
  $("btn-imprimir-cupom").addEventListener("click", imprimirUltimaVenda);

  document.querySelectorAll("[data-fechar-modal]").forEach((botao) => {
    botao.addEventListener("click", () => {
      const id = botao.dataset.fecharModal;
      fecharModal(id);
      if (id === "modal-alterar-cargo") {
        estado.painelFuncionarios?.fecharModalAuth();
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
    }
  });

  $("busca-sugestoes").addEventListener("click", (evento) => {
    const alvo = evento.target.closest(".sugestao[data-produto-id]");
    if (!alvo) return;
    adicionarAoCarrinho(alvo.dataset.produtoId);
    inputBusca.value = "";
    atualizarSugestoes("");
    inputBusca.focus();
  });

  $("lista-produtos").addEventListener("click", (evento) => {
    const card = evento.target.closest(".produto-card[data-produto-id]");
    if (!card || card.classList.contains("sem-estoque")) return;
    adicionarAoCarrinho(card.dataset.produtoId);
  });

  document.addEventListener("click", (evento) => {
    if (!evento.target.closest(".busca")) {
      $("busca-sugestoes").classList.add("oculto");
    }
  });

  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape") {
      document.querySelectorAll(".modal:not(.oculto)").forEach((modal) => {
        modal.classList.add("oculto");
      });
      estado.painelFuncionarios?.fecharModalAuth();
      $("busca-sugestoes").classList.add("oculto");
    }
  });
}

iniciar();
