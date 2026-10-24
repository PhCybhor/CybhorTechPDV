"use strict";

const API_BASE = window.location.origin;
const TOKEN_KEY = "cybhor_portal_token";

const form = document.getElementById("form-login");
const btnLogin = document.getElementById("btn-login");
const erroEl = document.getElementById("login-erro");
const googleWrap = document.getElementById("google-login-wrap");
const googleBtn = document.getElementById("btn-google");

if (localStorage.getItem(TOKEN_KEY)) {
  window.location.replace("painel.html");
}

/**
 * Persiste a sessão do portal e redireciona ao painel.
 * @param {{ token: string, loja?: object, funcionario?: object }} json
 * @param {string} [usuarioFallback]
 */
function entrarComSessao(json, usuarioFallback = "") {
  localStorage.setItem(TOKEN_KEY, json.token);
  localStorage.setItem(
    "cybhor_portal_loja",
    JSON.stringify({
      id: json.loja?.id || "",
      nome: json.loja?.nome || "",
      codigo: json.loja?.codigo || "",
      usuario: json.funcionario?.usuario || usuarioFallback,
    })
  );
  window.location.href = "painel.html";
}

function mostrarErro(mensagem) {
  erroEl.textContent = mensagem;
  erroEl.classList.remove("oculto");
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
    entrarComSessao(json, corpo.usuario);
  } catch (erro) {
    mostrarErro(erro.message);
    btnLogin.disabled = false;
    btnLogin.textContent = "Entrar";
  }
});

/**
 * Troca o credential GIS por JWT da loja.
 * @param {{ credential?: string }} resposta
 */
async function aoCredencialGoogle(resposta) {
  erroEl.classList.add("oculto");
  if (!resposta?.credential) {
    mostrarErro("Nao foi possivel obter a conta Google.");
    return;
  }

  try {
    const http = await fetch(`${API_BASE}/api/auth/login-google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: resposta.credential }),
    });
    const json = await http.json();
    if (!http.ok) throw new Error(json.erro || "Falha ao entrar com Google.");
    entrarComSessao(json);
  } catch (erro) {
    mostrarErro(erro.message);
  }
}

/**
 * Aguarda o script GIS carregar (async/defer no HTML).
 * @param {number} tentativas
 * @returns {Promise<typeof google.accounts.id>}
 */
function aguardarGoogleIdentity(tentativas = 40) {
  return new Promise((resolver, rejeitar) => {
    let restantes = tentativas;
    const tick = () => {
      if (window.google?.accounts?.id) {
        resolver(window.google.accounts.id);
        return;
      }
      restantes -= 1;
      if (restantes <= 0) {
        rejeitar(new Error("Google Identity nao carregou."));
        return;
      }
      window.setTimeout(tick, 100);
    };
    tick();
  });
}

async function iniciarLoginGoogle() {
  if (!googleWrap || !googleBtn) return;

  let clientId = "";
  try {
    const resposta = await fetch(`${API_BASE}/api/auth/provedores`);
    if (!resposta.ok) return;
    const json = await resposta.json();
    clientId = String(json.googleClientId || "").trim();
  } catch {
    return;
  }
  if (!clientId) return;

  try {
    const identity = await aguardarGoogleIdentity();
    identity.initialize({
      client_id: clientId,
      callback: aoCredencialGoogle,
      auto_select: false,
      cancel_on_tap_outside: true,
      context: "signin",
      ux_mode: "popup",
    });
    identity.renderButton(googleBtn, {
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "rectangular",
      logo_alignment: "left",
      width: Math.min(googleBtn.parentElement?.clientWidth || 320, 400),
      locale: "pt-BR",
    });
    googleWrap.classList.remove("oculto");
  } catch {
    // Sem GIS o login por usuario/senha continua disponivel.
  }
}

iniciarLoginGoogle();
