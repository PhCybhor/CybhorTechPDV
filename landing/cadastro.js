"use strict";

/** URL da API — mesma origem quando o site e servido pelo backend. */
const API_BASE = window.location.origin;

const form = document.getElementById("form-comprar");
const btnComprar = document.getElementById("btn-comprar");
const erroEl = document.getElementById("comprar-erro");
const precoEl = document.querySelector(".cadastro-preco");

function formatarBRL(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

async function carregarPreco() {
  try {
    const res = await fetch(`${API_BASE}/api/site/preco`);
    const dados = await res.json();
    if (dados.ok && precoEl) {
      precoEl.innerHTML = `<span>R$</span>${formatarBRL(dados.preco)}<small>/mes</small>`;
    }
  } catch {
    /* mantem o preco estatico do HTML */
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
