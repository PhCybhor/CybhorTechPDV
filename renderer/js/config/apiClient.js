let apiUrlCache = null;
let tokenSessao = null;

export const EVENTO_SESSAO_EXPIRADA = "cybhor:sessao-expirada";

export function definirTokenSessao(token) {
  tokenSessao = String(token || "").trim() || null;
}

export function limparTokenSessao() {
  tokenSessao = null;
}

export function obterTokenSessao() {
  return tokenSessao;
}

function notificarSessaoExpirada() {
  limparTokenSessao();
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_SESSAO_EXPIRADA));
  } catch {
    /* ambiente sem window */
  }
}

export async function obterApiUrl() {
  if (apiUrlCache) return apiUrlCache;
  const configurada = await window.pdvAPI?.obterApiUrl?.();
  apiUrlCache = String(configurada || "http://localhost:3333").replace(/\/+$/, "");
  return apiUrlCache;
}

export async function apiRequest(caminho, opcoes = {}) {
  const apiUrl = await obterApiUrl();
  const headers = {
    Accept: "application/json",
    ...(opcoes.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(tokenSessao ? { Authorization: `Bearer ${tokenSessao}` } : {}),
    ...(opcoes.headers || {}),
  };

  let resposta;
  try {
    resposta = await fetch(`${apiUrl}${caminho}`, {
      method: opcoes.method || "GET",
      headers,
      body:
        opcoes.body === undefined
          ? undefined
          : JSON.stringify(opcoes.body),
    });
  } catch {
    throw new Error(
      "Não foi possível conectar à API. Verifique se a FastAPI está rodando."
    );
  }

  const dados =
    resposta.status === 204 ? null : await resposta.json().catch(() => null);
  if (resposta.status === 401) {
    notificarSessaoExpirada();
    throw new Error(dados?.erro || dados?.detail || "Sessão expirada. Faça login novamente.");
  }
  if (!resposta.ok) {
    throw new Error(
      dados?.erro || dados?.detail || `Falha na API (${resposta.status}).`
    );
  }
  return dados;
}
