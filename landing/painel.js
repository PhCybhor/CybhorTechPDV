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
const elKpis = document.getElementById("kpis-analise");
const elGraficoDias = document.getElementById("grafico-dias");
const elPagamentos = document.getElementById("lista-pagamentos");
const elProdutos = document.getElementById("lista-produtos");
const elOperadores = document.getElementById("lista-operadores");
const elAnaliseVazia = document.getElementById("analise-vazia");

let vendasCache = [];
let periodoAtual = "hoje";

const LABELS_PAGAMENTO = {
  dinheiro: "Dinheiro",
  credito: "Credito",
  debito: "Debito",
  pix: "Pix",
};

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

function escapeHtml(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function chaveDia(data) {
  const y = data.getFullYear();
  const m = String(data.getMonth() + 1).padStart(2, "0");
  const d = String(data.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function inicioHojeLocal() {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
}

function filtrarPorPeriodo(vendas, periodo) {
  if (periodo === "tudo") return vendas.slice();
  const inicio = inicioHojeLocal();
  if (periodo === "7d") inicio.setDate(inicio.getDate() - 6);
  if (periodo === "30d") inicio.setDate(inicio.getDate() - 29);
  return vendas.filter((v) => {
    const data = new Date(v.criadoEm);
    return !Number.isNaN(data.getTime()) && data >= inicio;
  });
}

function agruparMapa(itens, chaveFn, valorFn) {
  const mapa = new Map();
  for (const item of itens) {
    const chave = chaveFn(item);
    const atual = mapa.get(chave) || { chave, total: 0, qtd: 0 };
    atual.total += valorFn(item);
    atual.qtd += 1;
    mapa.set(chave, atual);
  }
  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

function preencherLoja(perfil, cache) {
  document.getElementById("titulo-loja").textContent = perfil.nome || cache.nome || "Minha loja";
  document.getElementById("codigo-loja").textContent = perfil.codigo || cache.codigo || "--------";
  document.getElementById("usuario-login").textContent = cache.usuario || "—";
  document.getElementById("nome-usuario").textContent = cache.usuario
    ? `Ola, ${cache.usuario}`
    : "";
  const planoEl = document.getElementById("plano-loja");
  const validadeEl = document.getElementById("validade-loja");
  if (planoEl) {
    const nomes = { teste: "Teste gratis (30 dias)", mensal: "Mensal", semestral: "Semestral", anual: "Anual" };
    planoEl.textContent = nomes[perfil.plano] || perfil.plano || "—";
  }
  if (validadeEl && perfil.validaAte) {
    const data = new Date(`${perfil.validaAte}T00:00:00`);
    const texto = Number.isNaN(data.getTime())
      ? perfil.validaAte
      : data.toLocaleDateString("pt-BR");
    validadeEl.textContent = `Valido ate ${texto}. Mesmo login criado no cadastro.`;
  }
}

function renderizarKpis(vendas) {
  const faturamento = vendas.reduce((acc, v) => acc + Number(v.total || 0), 0);
  const descontos = vendas.reduce((acc, v) => acc + Number(v.desconto || 0), 0);
  const ticket = vendas.length ? faturamento / vendas.length : 0;
  const itensVendidos = vendas.reduce((acc, v) => {
    const itens = Array.isArray(v.itens) ? v.itens : [];
    return acc + itens.reduce((s, i) => s + Number(i.quantidade || 0), 0);
  }, 0);

  elKpis.innerHTML = `
    <div class="kpi-card"><span>Faturamento</span><strong>${formatarBRL(faturamento)}</strong></div>
    <div class="kpi-card"><span>Vendas</span><strong>${vendas.length}</strong></div>
    <div class="kpi-card"><span>Ticket medio</span><strong>${formatarBRL(ticket)}</strong></div>
    <div class="kpi-card"><span>Itens vendidos</span><strong>${itensVendidos}</strong></div>
    <div class="kpi-card"><span>Descontos</span><strong>${formatarBRL(descontos)}</strong></div>
  `;
}

function renderizarGraficoDias(vendas, periodo) {
  const dias = [];
  const inicio = inicioHojeLocal();
  let qtdDias = 1;
  if (periodo === "7d") qtdDias = 7;
  else if (periodo === "30d") qtdDias = 30;
  else if (periodo === "tudo") {
    if (!vendas.length) {
      elGraficoDias.innerHTML = `<p class="ranking-vazio">Sem dados.</p>`;
      return;
    }
    const datas = vendas
      .map((v) => new Date(v.criadoEm))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => a - b);
    const primeira = new Date(datas[0].getFullYear(), datas[0].getMonth(), datas[0].getDate());
    const ultima = inicioHojeLocal();
    qtdDias = Math.min(
      30,
      Math.max(1, Math.floor((ultima - primeira) / 86400000) + 1)
    );
    inicio.setTime(ultima.getTime());
    inicio.setDate(inicio.getDate() - (qtdDias - 1));
  }

  for (let i = 0; i < qtdDias; i += 1) {
    const d = new Date(inicio);
    d.setDate(inicio.getDate() + i);
    dias.push({ chave: chaveDia(d), label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), total: 0 });
  }

  const mapa = new Map(dias.map((d) => [d.chave, d]));
  for (const venda of vendas) {
    const data = new Date(venda.criadoEm);
    if (Number.isNaN(data.getTime())) continue;
    const item = mapa.get(chaveDia(data));
    if (item) item.total += Number(venda.total || 0);
  }

  const max = Math.max(...dias.map((d) => d.total), 1);
  elGraficoDias.innerHTML = dias
    .map((d) => {
      const altura = Math.max(4, Math.round((d.total / max) * 100));
      return `
        <div class="barra-dia" title="${d.label}: ${formatarBRL(d.total)}">
          <div class="barra-coluna" style="height:${altura}%"></div>
          <span>${d.label}</span>
        </div>
      `;
    })
    .join("");
}

function renderizarRanking(el, linhas, formatarLinha) {
  if (!linhas.length) {
    el.innerHTML = `<p class="ranking-vazio">Sem dados neste periodo.</p>`;
    return;
  }
  const max = Math.max(...linhas.map((l) => l.total), 1);
  el.innerHTML = linhas
    .slice(0, 6)
    .map((linha) => {
      const pct = Math.round((linha.total / max) * 100);
      return `
        <div class="ranking-item">
          <div class="ranking-topo">
            <strong>${escapeHtml(formatarLinha(linha))}</strong>
            <span>${escapeHtml(formatarBRL(linha.total))}</span>
          </div>
          <div class="ranking-barra"><i style="width:${pct}%"></i></div>
          <p class="ranking-meta">${linha.qtd} venda${linha.qtd === 1 ? "" : "s"}</p>
        </div>
      `;
    })
    .join("");
}

function renderizarAnalise(vendas, periodo) {
  const filtradas = filtrarPorPeriodo(vendas, periodo);
  if (!filtradas.length) {
    elKpis.innerHTML = "";
    elGraficoDias.innerHTML = "";
    elPagamentos.innerHTML = "";
    elProdutos.innerHTML = "";
    elOperadores.innerHTML = "";
    elAnaliseVazia.classList.remove("oculto");
    return;
  }

  elAnaliseVazia.classList.add("oculto");
  renderizarKpis(filtradas);
  renderizarGraficoDias(filtradas, periodo);

  const pagamentos = agruparMapa(
    filtradas,
    (v) => String(v.formaPagamento || "outros").toLowerCase(),
    (v) => Number(v.total || 0)
  ).map((item) => ({ ...item, qtd: item.qtd }));

  // Recontar qtd corretamente (agruparMapa já conta)
  renderizarRanking(
    elPagamentos,
    pagamentos,
    (l) => LABELS_PAGAMENTO[l.chave] || l.chave
  );

  const produtosFlat = [];
  for (const venda of filtradas) {
    for (const item of venda.itens || []) {
      produtosFlat.push({
        nome: item.nome || "Produto",
        total: Number(item.subtotal || 0),
        qtd: Number(item.quantidade || 0),
      });
    }
  }
  const produtosMap = new Map();
  for (const p of produtosFlat) {
    const atual = produtosMap.get(p.nome) || { chave: p.nome, total: 0, qtd: 0 };
    atual.total += p.total;
    atual.qtd += p.qtd;
    produtosMap.set(p.nome, atual);
  }
  const produtos = [...produtosMap.values()].sort((a, b) => b.total - a.total);
  renderizarRanking(elProdutos, produtos, (l) => l.chave);

  const operadores = agruparMapa(
    filtradas,
    (v) => v.funcionarioNome || "Operador",
    (v) => Number(v.total || 0)
  );
  renderizarRanking(elOperadores, operadores, (l) => l.chave);
}

function renderizarHistorico(vendas) {
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

  for (const venda of vendas.slice(0, 50)) {
    const itens = Array.isArray(venda.itens) ? venda.itens : [];
    const resumoItens = itens
      .slice(0, 3)
      .map((i) => `${i.quantidade}× ${i.nome}`)
      .join(", ");
    const extra = itens.length > 3 ? ` +${itens.length - 3}` : "";

    const card = document.createElement("article");
    card.className = "venda-item";
    const forma =
      LABELS_PAGAMENTO[String(venda.formaPagamento || "").toLowerCase()] ||
      venda.formaPagamento ||
      "—";
    card.innerHTML = `
      <div class="venda-topo">
        <strong>${escapeHtml(formatarBRL(venda.total))}</strong>
        <span>${escapeHtml(formatarData(venda.criadoEm))}</span>
      </div>
      <p class="venda-meta">
        ${escapeHtml(forma)}
        · ${escapeHtml(venda.funcionarioNome || "Operador")}
        ${Number(venda.desconto) > 0 ? ` · Desc. ${escapeHtml(formatarBRL(venda.desconto))}` : ""}
      </p>
      <p class="venda-itens">${escapeHtml(resumoItens)}${escapeHtml(extra || (itens.length ? "" : "Sem itens"))}</p>
    `;
    elLista.appendChild(card);
  }
}

function aplicarPeriodo(periodo) {
  periodoAtual = periodo;
  document.querySelectorAll(".filtro-periodo").forEach((btn) => {
    btn.classList.toggle("ativo", btn.dataset.periodo === periodo);
  });
  renderizarAnalise(vendasCache, periodoAtual);
}

async function carregarVendas() {
  elVendasErro.classList.add("oculto");
  try {
    const vendas = await apiGet("/api/vendas?limite=500");
    vendasCache = Array.isArray(vendas) ? vendas : [];
    renderizarAnalise(vendasCache, periodoAtual);
    renderizarHistorico(vendasCache);
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
    if (typeof carregarInstaladores === "function") {
      carregarInstaladores("lista-downloads");
    }
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

document.querySelectorAll(".filtro-periodo").forEach((btn) => {
  btn.addEventListener("click", () => aplicarPeriodo(btn.dataset.periodo));
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
