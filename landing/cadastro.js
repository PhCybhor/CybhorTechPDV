"use strict";

const API_BASE = window.location.origin;
const PLANOS_PADRAO = {
  mensal: { id: "mensal", nome: "Mensal", valor: 99.9, rotuloPeriodo: "/mes" },
  semestral: { id: "semestral", nome: "Semestral", valor: 499.9, rotuloPeriodo: "/6 meses" },
  anual: { id: "anual", nome: "Anual", valor: 899.9, rotuloPeriodo: "/ano" },
};

const form = document.getElementById("form-comprar");
const btnComprar = document.getElementById("btn-comprar");
const erroEl = document.getElementById("comprar-erro");
const precoEl = document.querySelector(".cadastro-preco");
const nomePlanoEl = document.getElementById("nome-plano");
const params = new URLSearchParams(window.location.search);
let planoAtual = String(params.get("plano") || "mensal").toLowerCase();
if (!PLANOS_PADRAO[planoAtual]) planoAtual = "mensal";

function formatarBRL(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function aplicarPlano(plano) {
  planoAtual = plano.id;
  if (nomePlanoEl) nomePlanoEl.textContent = `Plano ${plano.nome}`;
  if (precoEl) {
    precoEl.innerHTML = `<span>R$</span>${formatarBRL(plano.valor)}<small>${plano.rotuloPeriodo}</small>`;
  }
  document.querySelectorAll("#seletor-planos a").forEach((link) => {
    link.classList.toggle("ativo", link.dataset.plano === plano.id);
  });
}

async function carregarPreco() {
  aplicarPlano(PLANOS_PADRAO[planoAtual]);
  try {
    const res = await fetch(`${API_BASE}/api/site/preco`);
    const dados = await res.json();
    if (!dados.ok) return;
    const planos = Array.isArray(dados.planos) ? dados.planos : [];
    for (const plano of planos) {
      if (PLANOS_PADRAO[plano.id]) {
        PLANOS_PADRAO[plano.id] = {
          id: plano.id,
          nome: plano.nome,
          valor: plano.valor,
          rotuloPeriodo: plano.rotuloPeriodo,
        };
      }
    }
    aplicarPlano(PLANOS_PADRAO[planoAtual] || PLANOS_PADRAO.mensal);
  } catch {
    /* mantem o preco estatico */
  }
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  erroEl.classList.add("oculto");
  btnComprar.disabled = true;
  btnComprar.textContent = "Preparando pagamento...";

  const dados = new FormData(form);

  try {
    const resposta = await fetch(`${API_BASE}/api/site/comprar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plano: planoAtual,
        loja: {
          nome: dados.get("nomeLoja"),
          telefone: dados.get("telefone") || "",
          email: dados.get("email"),
        },
        admin: {
          nome: dados.get("nomeAdmin"),
          sobrenome: dados.get("sobrenomeAdmin"),
          usuario: String(dados.get("usuario") || "").toLowerCase(),
          senha: dados.get("senha"),
          email: dados.get("email"),
        },
      }),
    });

    const json = await resposta.json();
    if (!resposta.ok) throw new Error(json.erro || "Falha ao iniciar compra.");

    if (json.publicKey) {
      window.location.href = `pagamento.html?token=${encodeURIComponent(json.tokenAtivacao)}`;
      return;
    }
    if (!json.checkoutUrl) {
      throw new Error("Nao foi possivel abrir o pagamento. Tente novamente.");
    }
    window.location.href = json.checkoutUrl;
  } catch (erro) {
    erroEl.textContent = erro.message;
    erroEl.classList.remove("oculto");
    btnComprar.disabled = false;
    btnComprar.textContent = "Continuar para pagamento";
  }
});

carregarPreco();
