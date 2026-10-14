"use strict";

const API_BASE = window.CYBHOR_API_BASE || window.location.origin;
const TOKEN_KEY = "cybhor_portal_token";

const form = document.getElementById("form-login");
const btnLogin = document.getElementById("btn-login");
const erroEl = document.getElementById("login-erro");

if (localStorage.getItem(TOKEN_KEY)) {
  window.location.replace("painel.html");
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  erroEl.classList.add("oculto");
  btnLogin.disabled = true;
  btnLogin.textContent = "Entrando...";

  const dados = new FormData(form);
  const email = String(dados.get("email") || "").trim();
  const corpo = {
    usuario: String(dados.get("usuario") || "").trim().toLowerCase(),
    senha: dados.get("senha") || "",
  };
  if (email) corpo.email = email;

  try {
    const resposta = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const json = await resposta.json();
    if (!resposta.ok) throw new Error(json.erro || "Falha ao entrar.");

    localStorage.setItem(TOKEN_KEY, json.token);
    localStorage.setItem(
      "cybhor_portal_loja",
      JSON.stringify({
        id: json.loja?.id || "",
        nome: json.loja?.nome || "",
        codigo: json.loja?.codigo || "",
        usuario: json.funcionario?.usuario || corpo.usuario,
      })
    );
    window.location.href = "painel.html";
  } catch (erro) {
    erroEl.textContent = erro.message;
    erroEl.classList.remove("oculto");
    btnLogin.disabled = false;
    btnLogin.textContent = "Entrar";
  }
});
