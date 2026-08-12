"use strict";

const API_BASE = window.location.origin;
const TOKEN_KEY = "cybhor_portal_token";
const LOJA_KEY = "cybhor_portal_loja";

const elCarregando = document.getElementById("painel-carregando");
const elConteudo = document.getElementById("painel-conteudo");
const elErro = document.getElementById("painel-erro");
const elLista = document.getElementById("lista-vendas");
const elVazio = document.getElementById("vendas-vazio");
const elVendasErro = document.getElementById("vendas-erro");
const elResumo = document.getElementById("resumo-vendas");

function tokenAtual() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

function limparSessao() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LOJA_KEY);
}

function mostrarErro(mensagem) {
  elCarregando.classList.add("oculto");
  elConteudo.classList.add("oculto");
  elErro.classList.remove("oculto");
  document.getElementById("painel-erro-texto").textContent = mensagem;
}

async function apiGet(caminho) {
  const resposta = await fetch(`${API_BASE}${caminho}`, {
    headers: { Authorization: `Bearer ${tokenAtual()}` },
  });
  const dados = await resposta.json().catch(() => ({}));
  if (resposta.status === 401 || resposta.status === 403) {
    limparSessao();
    throw new Error(dados.erro || "Sessao expirada. Entre novamente.");
  }
  if (!resposta.ok) throw new Error(dados.erro || "Falha ao carregar dados.");
  return dados;
}

function formatarBRL(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatarData(iso) {
  if (!iso) return "—";
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return String(iso);
  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function preencherLoja(perfil, cache) {
  document.getElementById("titulo-loja").textContent = perfil.nome || cache.nome || "Minha loja";
  document.getElementById("codigo-loja").textContent = perfil.codigo || cache.codigo || "--------";
  document.getElementById("usuario-login").textContent = cache.usuario || "—";
  document.getElementById("nome-usuario").textContent = cache.usuario
    ? `Olá, ${cache.usuario}`
    : "";
}

function renderizarVendas(vendas) {
  elVendasErro.classList.add("oculto");
  elLista.innerHTML = "";

  if (!vendas.length) {
    elResumo.innerHTML = "";
    elVazio.classList.remove("oculto");
    return;
  }

  elVazio.classList.add("oculto");
  const totalGeral = vendas.reduce((acc, v) => acc + Number(v.total || 0), 0);
  elResumo.innerHTML = `
    <div class="resumo-item"><span>Ultimas vendas</span><strong>${vendas.length}</strong></div>
    <div class="resumo-item"><span>Soma exibida</span><strong>${formatarBRL(totalGeral)}</strong></div>
  `;

  for (const venda of vendas) {
    const itens = Array.isArray(venda.itens) ? venda.itens : [];
    const resumoItens = itens
      .slice(0, 3)
      .map((i) => `${i.quantidade}× ${i.nome}`)
      .join(", ");
    const extra = itens.length > 3 ? ` +${itens.length - 3}` : "";

    const card = document.createElement("article");
    card.className = "venda-item";
    card.innerHTML = `
      <div class="venda-topo">
        <strong>${formatarBRL(venda.total)}</strong>
        <span>${formatarData(venda.criadoEm)}</span>
      </div>
      <p class="venda-meta">
        ${venda.formaPagamento || "—"} · ${venda.funcionarioNome || "Operador"}
        ${Number(venda.desconto) > 0 ? ` · Desc. ${formatarBRL(venda.desconto)}` : ""}
      </p>
      <p class="venda-itens">${resumoItens}${extra || (itens.length ? "" : "Sem itens")}</p>
    `;
    elLista.appendChild(card);
  }
}

async function carregarVendas() {
  elVendasErro.classList.add("oculto");
  try {
    const vendas = await apiGet("/api/vendas?limite=100");
    renderizarVendas(Array.isArray(vendas) ? vendas : []);
  } catch (erro) {
    elVendasErro.textContent = erro.message;
    elVendasErro.classList.remove("oculto");
  }
}

async function iniciar() {
  if (!tokenAtual()) {
    window.location.replace("login.html");
    return;
  }

  let cache = {};
  try {
    cache = JSON.parse(localStorage.getItem(LOJA_KEY) || "{}");
  } catch {
    cache = {};
  }

  try {
    const perfil = await apiGet("/api/lojas/perfil");
    localStorage.setItem(
      LOJA_KEY,
      JSON.stringify({
        ...cache,
        id: perfil.id,
        nome: perfil.nome,
        codigo: perfil.codigo,
      })
    );
    preencherLoja(perfil, cache);
    elCarregando.classList.add("oculto");
    elConteudo.classList.remove("oculto");
    await carregarVendas();
  } catch (erro) {
    mostrarErro(erro.message);
  }
}

document.getElementById("btn-sair").addEventListener("click", () => {
  limparSessao();
  window.location.href = "login.html";
});

document.getElementById("btn-atualizar").addEventListener("click", () => {
  carregarVendas();
});

document.getElementById("btn-copiar-codigo").addEventListener("click", () => {
  const codigo = document.getElementById("codigo-loja").textContent;
  navigator.clipboard.writeText(codigo).then(() => {
    const btn = document.getElementById("btn-copiar-codigo");
    btn.textContent = "Copiado!";
    setTimeout(() => {
      btn.textContent = "Copiar codigo";
    }, 2000);
  });
});

iniciar();
