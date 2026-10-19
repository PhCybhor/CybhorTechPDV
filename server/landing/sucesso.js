"use strict";

const API_BASE = window.location.origin;
const params = new URLSearchParams(window.location.search);
const token = params.get("token");
let intervaloAtivacao = null;

const estadoPendente = document.getElementById("estado-pendente");
const estadoAtivo = document.getElementById("estado-ativo");
const estadoErro = document.getElementById("estado-erro");

function mostrarAtivo(dados) {
  estadoPendente.classList.add("oculto");
  estadoErro.classList.add("oculto");
  estadoAtivo.classList.remove("oculto");
  document.getElementById("codigo-loja").textContent = dados.codigo;
  document.getElementById("nome-loja").textContent = dados.nomeLoja;
  document.getElementById("usuario-login").textContent = dados.usuario;
  if (params.get("trial") === "1") {
    const selo = document.getElementById("selo-ativo");
    if (selo) selo.textContent = "Teste gratis de 30 dias ativado";
  }
  if (typeof carregarInstaladores === "function") {
    carregarInstaladores("lista-downloads");
  }
}

function mostrarErro(mensagem) {
  estadoPendente.classList.add("oculto");
  estadoAtivo.classList.add("oculto");
  estadoErro.classList.remove("oculto");
  document.getElementById("erro-texto").textContent = mensagem;
}

async function consultarAtivacao() {
  if (!token) {
    mostrarErro("Link invalido. Faca uma nova compra em nosso site.");
    return;
  }

  try {
    const qs = new URLSearchParams({ token });
    const resposta = await fetch(`${API_BASE}/api/site/ativacao?${qs.toString()}`);
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || "Falha ao consultar ativacao.");

    if (dados.status === "ativa") {
      if (intervaloAtivacao) {
        clearInterval(intervaloAtivacao);
        intervaloAtivacao = null;
      }
      mostrarAtivo(dados);
      return;
    }
  } catch (erro) {
    mostrarErro(erro.message);
  }
}

document.getElementById("btn-copiar-codigo")?.addEventListener("click", () => {
  const codigo = document.getElementById("codigo-loja").textContent;
  navigator.clipboard.writeText(codigo).then(() => {
    const btn = document.getElementById("btn-copiar-codigo");
    btn.textContent = "Copiado!";
    setTimeout(() => { btn.textContent = "Copiar codigo"; }, 2000);
  });
});

if (token) {
  consultarAtivacao();
  intervaloAtivacao = setInterval(consultarAtivacao, 4000);
} else {
  mostrarErro("Token de ativacao nao encontrado.");
}
