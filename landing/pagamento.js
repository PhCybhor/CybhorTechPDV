"use strict";

const API_BASE = window.location.origin;
const params = new URLSearchParams(window.location.search);
const token = params.get("token");

const erroEl = document.getElementById("pagamento-erro");
const carregandoEl = document.getElementById("pagamento-carregando");
const brickEl = document.getElementById("paymentBrick_container");
const listaMetodosEl = document.getElementById("lista-metodos-mp");

function escapeHtml(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

let brickController = null;
let dadosPagamento = null;

function mostrarErro(mensagem) {
  erroEl.textContent = mensagem;
  erroEl.classList.remove("oculto");
  carregandoEl.classList.add("oculto");
}

function renderizarMetodos(metodosHabilitados, metodosDisponiveis) {
  if (!listaMetodosEl) return;

  const idsMp = new Set((metodosDisponiveis || []).map((m) => m.id));
  const linhas = (metodosHabilitados || []).map((m) => {
    const ativo =
      m.chave === "creditCard" ||
      m.chave === "debitCard" ||
      m.chave === "prepaidCard" ||
      (m.chave === "ticket" && idsMp.has("bolbradesco")) ||
      (m.chave === "bankTransfer" && idsMp.has("pix")) ||
      m.chave === "mercadoPago";
    return `<li class="${ativo ? "" : "metodo-indisponivel"}">${escapeHtml(m.rotulo)}</li>`;
  });

  listaMetodosEl.innerHTML = linhas.join("");
}

function aguardarSdkMercadoPago(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (window.MercadoPago) {
      resolve();
      return;
    }
    const inicio = Date.now();
    const intervalo = setInterval(() => {
      if (window.MercadoPago) {
        clearInterval(intervalo);
        resolve();
      } else if (Date.now() - inicio > timeoutMs) {
        clearInterval(intervalo);
        reject(new Error("SDK do Mercado Pago nao carregou. Verifique sua conexao."));
      }
    }, 100);
  });
}

async function desmontarBrick() {
  if (brickController?.unmount) {
    try {
      await brickController.unmount();
    } catch {
      /* brick ja removido */
    }
    brickController = null;
  }
}

/** Status Screen Brick — exibe QR Pix, boleto ou status do pagamento pendente. */
async function exibirStatusPagamento(paymentId, publicKey) {
  await desmontarBrick();
  carregandoEl.classList.add("oculto");
  brickEl.classList.remove("oculto");

  const mp = new MercadoPago(publicKey, { locale: "pt-BR" });
  brickController = await mp.bricks().create("statusScreen", "paymentBrick_container", {
    initialization: { paymentId: String(paymentId) },
    callbacks: {
      onReady: () => {},
      onError: (erro) => {
        console.error("Status Screen MP:", erro);
      },
    },
  });

  // Quando Pix/boleto for pago, redireciona para pagina do codigo
  const intervalo = setInterval(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/site/ativacao?token=${encodeURIComponent(token)}`);
      const json = await r.json();
      if (json.status === "ativa") {
        clearInterval(intervalo);
        window.location.href = `/sucesso.html?token=${encodeURIComponent(token)}`;
      }
    } catch {
      /* continua polling */
    }
  }, 5000);
}

async function montarPaymentBrick(dados) {
  await desmontarBrick();

  const mp = new MercadoPago(dados.publicKey, { locale: "pt-BR" });
  const customization = dados.customization || {};
  const cpf = String(dados.cpf || "").replace(/\D/g, "");
  const payer = {
    email: dados.email,
    firstName: dados.primeiroNome,
    lastName: dados.sobrenome,
  };
  if (cpf.length === 11) {
    payer.identification = { type: "CPF", number: cpf };
  }

  let brickPronto = false;
  const avisoLento = window.setTimeout(() => {
    if (!brickPronto) {
      mostrarErro(
        "O formulario de pagamento demorou para abrir. Recarregue a pagina ou tente outro navegador."
      );
    }
  }, 20000);

  try {
    brickController = await mp.bricks().create("payment", "paymentBrick_container", {
      initialization: {
        amount: Number(dados.valorMensal),
        payer,
      },
      customization,
      callbacks: {
        onReady: () => {
          brickPronto = true;
          window.clearTimeout(avisoLento);
          erroEl.classList.add("oculto");
          carregandoEl.classList.add("oculto");
          brickEl.classList.remove("oculto");
        },
        onSubmit: ({ formData }) =>
          new Promise((resolve, reject) => {
            erroEl.classList.add("oculto");
            fetch(`${API_BASE}/api/site/pagar`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tokenAtivacao: token, formData }),
            })
              .then(async (r) => {
                const json = await r.json();
                if (!r.ok) throw new Error(json.erro || "Pagamento recusado.");

                if (json.status === "approved") {
                  window.location.href = json.redirectUrl;
                  resolve();
                  return;
                }

                if (json.exibirStatus && json.paymentId) {
                  await exibirStatusPagamento(json.paymentId, dados.publicKey);
                  resolve();
                  return;
                }

                if (json.redirectUrl) {
                  window.location.href = json.redirectUrl;
                }
                resolve();
              })
              .catch((erro) => {
                mostrarErro(erro.message);
                reject();
              });
          }),
        onError: (erro) => {
          console.error("Payment Brick MP:", erro);
          brickPronto = true;
          window.clearTimeout(avisoLento);
          mostrarErro(
            erro?.message || "Erro ao carregar formas de pagamento. Recarregue a pagina."
          );
        },
      },
    });
  } catch (erro) {
    window.clearTimeout(avisoLento);
    throw erro;
  }
}

async function iniciar() {
  if (!token) {
    mostrarErro("Sessao invalida. Faca o cadastro novamente.");
    return;
  }

  try {
    const resposta = await fetch(
      `${API_BASE}/api/site/pagamento?token=${encodeURIComponent(token)}`
    );
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || "Falha ao carregar pagamento.");

    if (dados.jaAtiva) {
      window.location.href = `/sucesso.html?token=${encodeURIComponent(token)}`;
      return;
    }

    dadosPagamento = dados;
    document.getElementById("nome-loja-resumo").textContent = dados.nomeLoja;
    const titulo = document.getElementById("titulo-pagamento");
    if (titulo && dados.planoNome) titulo.textContent = `Plano ${dados.planoNome}`;
    const rotulo = dados.planoRotulo || "/mes";
    document.querySelector(".cadastro-preco").innerHTML =
      `<span>R$</span>${Number(dados.valorMensal).toFixed(2).replace(".", ",")}<small>${escapeHtml(rotulo)}</small>`;

    if (!dados.publicKey) {
      if (!dados.checkoutUrl) {
        throw new Error("Pagamento indisponivel no momento.");
      }
      window.location.href = dados.checkoutUrl;
      return;
    }

    renderizarMetodos(dados.metodosHabilitados, dados.metodosDisponiveis);

    await aguardarSdkMercadoPago();
    await montarPaymentBrick(dados);
  } catch (erro) {
    mostrarErro(erro.message);
  }
}

brickEl.classList.add("oculto");
iniciar();
