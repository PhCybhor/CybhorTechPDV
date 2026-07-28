"use strict";

/** URL da API — mesma origem quando o site e servido pelo backend. */
const API_BASE = window.location.origin;

const form = document.getElementById("form-comprar");
const btnComprar = document.getElementById("btn-comprar");
const erroEl = document.getElementById("comprar-erro");

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  erroEl.classList.add("oculto");
  btnComprar.disabled = true;
  btnComprar.textContent = "Gerando pagamento...";

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

    window.location.href = `pagamento.html?token=${encodeURIComponent(json.tokenAtivacao)}`;
  } catch (erro) {
    erroEl.textContent = erro.message;
    erroEl.classList.remove("oculto");
    btnComprar.disabled = false;
    btnComprar.textContent = "Continuar para pagamento";
  }
});
