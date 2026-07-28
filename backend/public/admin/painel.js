"use strict";

/**
 * Painel do administrador do sistema.
 * Consome a API em /api/admin/* com token JWT guardado em sessionStorage
 * (sessao expira ao fechar o navegador — mais seguro que localStorage).
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const CHAVE_TOKEN = "cybhor-admin-token";

  const obterToken = () => sessionStorage.getItem(CHAVE_TOKEN);

  function escapeHtml(texto) {
    const div = document.createElement("div");
    div.textContent = String(texto ?? "");
    return div.innerHTML;
  }

  async function chamarApi(caminho, opcoes = {}) {
    const resposta = await fetch(`/api${caminho}`, {
      ...opcoes,
      headers: {
        "Content-Type": "application/json",
        ...(obterToken() ? { Authorization: `Bearer ${obterToken()}` } : {}),
        ...(opcoes.headers || {}),
      },
    });

    if (resposta.status === 401) {
      sessionStorage.removeItem(CHAVE_TOKEN);
      mostrarLogin();
      throw new Error("Sessao expirada.");
    }

    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(dados.erro || "Falha na requisicao.");
    return dados;
  }

  function mostrarLogin() {
    $("tela-login").classList.remove("oculto");
    $("tela-painel").classList.add("oculto");
  }

  function mostrarPainel() {
    $("tela-login").classList.add("oculto");
    $("tela-painel").classList.remove("oculto");
  }

  function formatarGB(usoBytes) {
    const bytes = Number(usoBytes) || 0;
    const gb = bytes / 1024 ** 3;
    if (gb >= 0.01) return `${gb.toFixed(2)} GB`;
    const mb = bytes / 1024 ** 2;
    if (mb >= 0.01) return `${mb.toFixed(2)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  const formatarReal = (valor) =>
    Number(valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  function seloAssinatura(status) {
    const mapa = {
      ativa: ["selo-ok", "Ativa"],
      pendente: ["selo-alerta", "Pendente"],
      inadimplente: ["selo-erro", "Inadimplente"],
      cancelada: ["selo-erro", "Cancelada"],
    };
    const [classe, rotulo] = mapa[status] || ["selo-alerta", status || "—"];
    return `<span class="selo ${classe}">${rotulo}</span>`;
  }

  function renderizarResumo(lojas) {
    const totais = lojas.reduce(
      (acc, l) => ({
        lojas: acc.lojas + 1,
        ativas: acc.ativas + (l.ativa ? 1 : 0),
        vendas: acc.vendas + Number(l.totalVendas || 0),
        faturamento: acc.faturamento + Number(l.faturamentoTotal || 0),
        bytes: acc.bytes + Number(l.usoBytes || 0),
      }),
      { lojas: 0, ativas: 0, vendas: 0, faturamento: 0, bytes: 0 }
    );

    $("resumo-cards").innerHTML = [
      ["Lojas", totais.lojas],
      ["Lojas ativas", totais.ativas],
      ["Vendas registradas", totais.vendas],
      ["Faturamento das lojas", formatarReal(totais.faturamento)],
      ["Uso total de dados", formatarGB(totais.bytes)],
    ]
      .map(
        ([rotulo, valor]) =>
          `<div class="card"><div class="rotulo">${rotulo}</div><div class="valor">${valor}</div></div>`
      )
      .join("");
  }

  function renderizarTabela(lojas) {
    $("tabela-lojas").innerHTML = lojas
      .map(
        (loja) => `
        <tr>
          <td><strong>${escapeHtml(loja.nome)}</strong></td>
          <td class="codigo">${escapeHtml(loja.codigo)}</td>
          <td>${seloAssinatura(loja.assinaturaStatus)}</td>
          <td>${loja.totalFuncionarios}</td>
          <td>${loja.totalProdutos}</td>
          <td>${loja.totalVendas}</td>
          <td>${formatarReal(loja.faturamentoTotal)}</td>
          <td>${formatarGB(loja.usoBytes)}</td>
          <td>${loja.ativa ? '<span class="selo selo-ok">Ativa</span>' : '<span class="selo selo-erro">Bloqueada</span>'}</td>
          <td><button class="btn-suave" data-loja="${loja.id}" data-ativa="${!loja.ativa}">
            ${loja.ativa ? "Bloquear" : "Liberar"}
          </button></td>
        </tr>`
      )
      .join("");

    document.querySelectorAll("#tabela-lojas button[data-loja]").forEach((botao) => {
      botao.addEventListener("click", async () => {
        botao.disabled = true;
        try {
          await chamarApi(`/admin/lojas/${botao.dataset.loja}/ativa`, {
            method: "PATCH",
            body: JSON.stringify({ ativa: botao.dataset.ativa === "true" }),
          });
          await carregarLojas();
        } catch (erro) {
          alert(erro.message);
          botao.disabled = false;
        }
      });
    });
  }

  async function carregarLojas() {
    const lojas = await chamarApi("/admin/lojas");
    renderizarResumo(lojas);
    renderizarTabela(lojas);
  }

  $("form-login").addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const erroEl = $("login-erro");
    erroEl.classList.add("oculto");
    try {
      const sessao = await chamarApi("/admin/login", {
        method: "POST",
        body: JSON.stringify({
          email: $("login-email").value,
          senha: $("login-senha").value,
        }),
      });
      sessionStorage.setItem(CHAVE_TOKEN, sessao.token);
      mostrarPainel();
      await carregarLojas();
    } catch (erro) {
      erroEl.textContent = erro.message;
      erroEl.classList.remove("oculto");
    }
  });

  $("btn-atualizar").addEventListener("click", () => carregarLojas().catch(() => {}));
  $("btn-sair").addEventListener("click", () => {
    sessionStorage.removeItem(CHAVE_TOKEN);
    mostrarLogin();
  });

  if (obterToken()) {
    mostrarPainel();
    carregarLojas().catch(() => mostrarLogin());
  }
})();
