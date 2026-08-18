"use strict";

const API_BASE = window.location.origin;
const PLANOS_PADRAO = {
  teste: { id: "teste", nome: "Teste gratis", valor: 0, rotuloPeriodo: "/30 dias", gratis: true },
  mensal: { id: "mensal", nome: "Mensal", valor: 99.9, rotuloPeriodo: "/mes", gratis: false },
  semestral: { id: "semestral", nome: "Semestral", valor: 499.9, rotuloPeriodo: "/6 meses", gratis: false },
  anual: { id: "anual", nome: "Anual", valor: 899.9, rotuloPeriodo: "/ano", gratis: false },
};

const form = document.getElementById("form-comprar");
const btnComprar = document.getElementById("btn-comprar");
const erroEl = document.getElementById("comprar-erro");
const precoEl = document.querySelector(".cadastro-preco");
const nomePlanoEl = document.getElementById("nome-plano");
const cadastroSubEl = document.getElementById("cadastro-sub");
const cadastroNotaEl = document.getElementById("cadastro-nota");
const campoCpf = document.getElementById("campo-cpf");
const params = new URLSearchParams(window.location.search);
let planoAtual = String(params.get("plano") || "mensal").toLowerCase();
if (!PLANOS_PADRAO[planoAtual]) planoAtual = "mensal";

function formatarBRL(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function mascaraCpf(valor) {
  const d = String(valor || "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
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
  const gratis = Boolean(plano.gratis);
  const passoEl = document.querySelector(".cartao-cadastro .eyebrow");
  if (passoEl) passoEl.textContent = gratis ? "Teste gratis" : "Passo 1 de 2";
  if (cadastroSubEl) {
    cadastroSubEl.textContent = gratis
      ? "Preencha os dados com o CPF do responsavel. O teste de 30 dias vale uma unica vez por CPF."
      : "Preencha os dados abaixo. Na proxima etapa voce sera redirecionado ao Mercado Pago para pagar.";
  }
  if (cadastroNotaEl) {
    cadastroNotaEl.innerHTML = gratis
      ? "O teste gratis e limitado a <strong>um CPF</strong>. Depois de 30 dias, assine um plano pago para continuar."
      : "Na proxima tela voce paga no site (Pix, cartao ou boleto). Apos o pagamento, recebe o <strong>codigo individual</strong> da sua loja.";
  }
  if (btnComprar && !btnComprar.disabled) {
    btnComprar.textContent = gratis ? "Ativar teste gratis" : "Continuar para pagamento";
  }
}

async function carregarPreco() {
  aplicarPlano(PLANOS_PADRAO[planoAtual]);
  try {
    const res = await fetch(`${API_BASE}/api/site/preco`);
    const dados = await res.json();
    if (!dados.ok) return;
    const planos = Array.isArray(dados.planos) ? dados.planos : [];
    for (const plano of planos) {
      PLANOS_PADRAO[plano.id] = {
        id: plano.id,
        nome: plano.nome,
        valor: plano.valor,
        rotuloPeriodo: plano.rotuloPeriodo,
        gratis: Boolean(plano.gratis),
      };
    }
    aplicarPlano(PLANOS_PADRAO[planoAtual] || PLANOS_PADRAO.mensal);
  } catch {
    /* mantem o preco estatico */
  }
}

campoCpf?.addEventListener("input", () => {
  campoCpf.value = mascaraCpf(campoCpf.value);
});

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  erroEl.classList.add("oculto");
  btnComprar.disabled = true;
  const gratis = Boolean(PLANOS_PADRAO[planoAtual]?.gratis);
  btnComprar.textContent = gratis ? "Ativando teste..." : "Preparando pagamento...";

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
          cpf: dados.get("cpf"),
        },
        admin: {
          nome: dados.get("nomeAdmin"),
          sobrenome: dados.get("sobrenomeAdmin"),
          usuario: String(dados.get("usuario") || "").toLowerCase(),
          senha: dados.get("senha"),
          email: dados.get("email"),
          cpf: dados.get("cpf"),
        },
      }),
    });

    const json = await resposta.json();
    if (!resposta.ok) throw new Error(json.erro || "Falha ao iniciar compra.");

    if (json.trial && json.redirectUrl) {
      window.location.href = json.redirectUrl;
      return;
    }
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
    btnComprar.textContent = Boolean(PLANOS_PADRAO[planoAtual]?.gratis)
      ? "Ativar teste gratis"
      : "Continuar para pagamento";
  }
});

carregarPreco();
