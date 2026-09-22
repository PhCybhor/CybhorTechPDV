"use strict";

/**
 * Painel do administrador do sistema.
 * Consome a API em /api/admin/* com token JWT guardado em sessionStorage
 * (sessao expira ao fechar o navegador — mais seguro que localStorage).
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const CHAVE_TOKEN = "cybhor-admin-token";
  let lojasCache = [];
  let filtroSoAtrasadas = false;

  function ordenarLojas(lojas) {
    return [...lojas].sort((a, b) => {
      const da = a.assinaturaAtrasada ? 1 : 0;
      const db = b.assinaturaAtrasada ? 1 : 0;
      if (db !== da) return db - da;
      return String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR");
    });
  }

  function lojasVisiveis() {
    const base = ordenarLojas(lojasCache);
    if (!filtroSoAtrasadas) return base;
    return base.filter((l) => l.assinaturaAtrasada);
  }

  function atualizarBotaoFiltro() {
    const botao = $("btn-filtro-atrasadas");
    if (!botao) return;
    botao.setAttribute("aria-pressed", filtroSoAtrasadas ? "true" : "false");
    botao.classList.toggle("btn-filtro-ativo", filtroSoAtrasadas);
    botao.textContent = filtroSoAtrasadas ? "Ver todas" : "Só atrasadas";
  }


  const obterToken = () => sessionStorage.getItem(CHAVE_TOKEN) || "";

  function escapeHtml(texto) {
    const div = document.createElement("div");
    div.textContent = String(texto ?? "");
    return div.innerHTML;
  }

  function mensagemErroApi(dados, fallback) {
    const erro = dados?.erro || dados?.detail || dados?.mensagem;
    if (typeof erro === "string" && erro.trim()) return erro.trim();
    return fallback;
  }

  async function chamarApi(caminho, opcoes = {}) {
    const ehLogin = caminho === "/admin/login";
    // Congela o token desta requisicao — evita que um 401 antigo apague login novo.
    const tokenUsado = ehLogin ? "" : obterToken();
    const cabecalhos = {
      "Content-Type": "application/json",
      ...(opcoes.headers || {}),
    };
    if (tokenUsado) cabecalhos.Authorization = `Bearer ${tokenUsado}`;

    const resposta = await fetch(`/api${caminho}`, {
      ...opcoes,
      headers: cabecalhos,
    });

    const dados = await resposta.json().catch(() => ({}));
    if (resposta.status === 401) {
      // Login com senha errada tambem retorna 401 — nao confundir com sessao.
      if (!ehLogin && tokenUsado && obterToken() === tokenUsado) {
        sessionStorage.removeItem(CHAVE_TOKEN);
        mostrarLogin();
      }
      throw new Error(
        mensagemErroApi(
          dados,
          ehLogin ? "Credenciais invalidas." : "Sessao expirada. Entre novamente."
        )
      );
    }

    if (!resposta.ok) {
      throw new Error(mensagemErroApi(dados, "Falha na requisicao."));
    }
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

  function seloAssinatura(loja) {
    const status = typeof loja === "string" ? loja : loja?.assinaturaStatus;
    const atrasada = Boolean(loja && loja.assinaturaAtrasada);
    if (atrasada) {
      return `<span class="selo selo-erro" title="Pagamento em atraso — loja ainda liberada com aviso">Atrasada</span>`;
    }
    const mapa = {
      ativa: ["selo-ok", "Ativa"],
      pendente: ["selo-alerta", "Pendente"],
      inadimplente: ["selo-erro", "Inadimplente"],
      cancelada: ["selo-erro", "Cancelada"],
    };
    const [classe, rotulo] = mapa[status] || ["selo-alerta", status || "—"];
    return `<span class="selo ${classe}">${escapeHtml(rotulo)}</span>`;
  }

  function renderizarResumo(lojas) {
    const totais = lojas.reduce(
      (acc, l) => ({
        lojas: acc.lojas + 1,
        ativas: acc.ativas + (l.ativa ? 1 : 0),
        atrasadas: acc.atrasadas + (l.assinaturaAtrasada ? 1 : 0),
        vendas: acc.vendas + Number(l.totalVendas || 0),
        faturamento: acc.faturamento + Number(l.faturamentoTotal || 0),
        bytes: acc.bytes + Number(l.usoBytes || 0),
      }),
      { lojas: 0, ativas: 0, atrasadas: 0, vendas: 0, faturamento: 0, bytes: 0 }
    );

    $("resumo-cards").innerHTML = [
      ["Lojas", totais.lojas],
      ["Lojas ativas", totais.ativas],
      ["Assinaturas atrasadas", totais.atrasadas],
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

  async function copiarTexto(texto) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      return false;
    }
  }

  function mostrarContaCriada(conta) {
    $("conta-criada").classList.remove("oculto");
    $("criada-nome").textContent = conta.nomeLoja;
    $("criada-usuario").textContent = conta.usuario;
    $("criada-codigo").textContent = conta.codigo;
  }

  function renderizarTabela(lojas) {
    $("tabela-lojas").innerHTML = lojas
      .map(
        (loja) => `
        <tr>
          <td><strong>${escapeHtml(loja.nome)}</strong></td>
          <td class="codigo">
            <span>${escapeHtml(loja.codigo)}</span>
            <button type="button" class="btn-icone" data-copiar="${escapeHtml(loja.codigo)}" title="Copiar chave">Copiar</button>
          </td>
          <td>${seloAssinatura(loja)}</td>
          <td>${loja.totalFuncionarios}</td>
          <td>${loja.totalProdutos}</td>
          <td>${loja.totalVendas}</td>
          <td>${formatarReal(loja.faturamentoTotal)}</td>
          <td>${formatarGB(loja.usoBytes)}</td>
          <td>${loja.ativa ? '<span class="selo selo-ok">Ativa</span>' : '<span class="selo selo-erro">Bloqueada</span>'}</td>
          <td class="acoes-loja">
            <button class="btn-suave" data-loja="${loja.id}" data-ativa="${!loja.ativa}">
              ${loja.ativa ? "Bloquear" : "Liberar"}
            </button>
            <button class="btn-suave" data-regenerar="${loja.id}" data-nome="${escapeHtml(loja.nome)}">
              Nova chave
            </button>
          </td>
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

    document.querySelectorAll("#tabela-lojas button[data-regenerar]").forEach((botao) => {
      botao.addEventListener("click", async () => {
        const nome = botao.dataset.nome;
        if (!confirm(`Gerar uma nova chave para "${nome}"? A chave atual deixa de funcionar.`)) {
          return;
        }
        botao.disabled = true;
        try {
          const resultado = await chamarApi(`/admin/lojas/${botao.dataset.regenerar}/regenerar-chave`, {
            method: "POST",
          });
          await carregarLojas();
          alert(`Nova chave: ${resultado.codigo}`);
        } catch (erro) {
          alert(erro.message);
          botao.disabled = false;
        }
      });
    });

    document.querySelectorAll("#tabela-lojas button[data-copiar]").forEach((botao) => {
      botao.addEventListener("click", async () => {
        const ok = await copiarTexto(botao.dataset.copiar);
        botao.textContent = ok ? "Copiado" : "Falhou";
        setTimeout(() => {
          botao.textContent = "Copiar";
        }, 1600);
      });
    });
  }

  async function carregarLojas() {
    lojasCache = await chamarApi("/admin/lojas");
    renderizarResumo(lojasCache);
    renderizarTabela(lojasVisiveis());
    atualizarBotaoFiltro();
  }

  $("form-login").addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const erroEl = $("login-erro");
    const botao = $("form-login")?.querySelector("button[type=submit]");
    erroEl.classList.add("oculto");
    if (botao) botao.disabled = true;
    try {
      // Descarta token antigo antes do login para nao misturar sessoes.
      sessionStorage.removeItem(CHAVE_TOKEN);
      const sessao = await chamarApi("/admin/login", {
        method: "POST",
        body: JSON.stringify({
          email: $("login-email").value,
          senha: $("login-senha").value,
        }),
      });
      if (!sessao?.token) {
        throw new Error("Login sem token. Tente novamente.");
      }
      sessionStorage.setItem(CHAVE_TOKEN, sessao.token);
      mostrarPainel();
      await carregarLojas();
    } catch (erro) {
      sessionStorage.removeItem(CHAVE_TOKEN);
      mostrarLogin();
      erroEl.textContent = erro.message || "Nao foi possivel entrar.";
      erroEl.classList.remove("oculto");
    } finally {
      if (botao) botao.disabled = false;
    }
  });

  $("form-criar-conta").addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const erroEl = $("criar-erro");
    const botao = $("btn-criar-conta");
    erroEl.classList.add("oculto");
    botao.disabled = true;
    botao.textContent = "Criando...";
    try {
      const conta = await chamarApi("/admin/lojas", {
        method: "POST",
        body: JSON.stringify({
          loja: {
            nome: $("nova-nome-loja").value,
            email: $("nova-email").value,
            telefone: $("nova-telefone").value,
          },
          admin: {
            nome: $("nova-nome").value,
            sobrenome: $("nova-sobrenome").value,
            usuario: $("nova-usuario").value.toLowerCase(),
            senha: $("nova-senha").value,
            email: $("nova-email").value,
          },
        }),
      });
      mostrarContaCriada(conta);
      $("form-criar-conta").reset();
      await carregarLojas();
    } catch (erro) {
      erroEl.textContent = erro.message;
      erroEl.classList.remove("oculto");
    } finally {
      botao.disabled = false;
      botao.textContent = "Criar conta e gerar chave";
    }
  });

  $("btn-copiar-criada").addEventListener("click", async () => {
    const codigo = $("criada-codigo").textContent;
    const ok = await copiarTexto(codigo);
    $("btn-copiar-criada").textContent = ok ? "Copiado!" : "Nao foi possivel copiar";
    setTimeout(() => {
      $("btn-copiar-criada").textContent = "Copiar chave";
    }, 1800);
  });

  $("btn-atualizar").addEventListener("click", () => {
    carregarLojas().catch((erro) => {
      alert(erro.message || "Falha ao atualizar.");
    });
  });
  $("btn-sair").addEventListener("click", () => {
    sessionStorage.removeItem(CHAVE_TOKEN);
    mostrarLogin();
  });

  async function restaurarSessao() {
    const token = obterToken();
    if (!token) return;
    mostrarPainel();
    try {
      await carregarLojas();
    } catch {
      // So volta ao login se o token ainda for o que falhou (evita corrida com login novo).
      if (obterToken() === token) {
        sessionStorage.removeItem(CHAVE_TOKEN);
        mostrarLogin();
      }
    }
  }

  $("btn-filtro-atrasadas").addEventListener("click", () => {
    filtroSoAtrasadas = !filtroSoAtrasadas;
    renderizarTabela(lojasVisiveis());
    atualizarBotaoFiltro();
  });

  void restaurarSessao();
})();
