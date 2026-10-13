let apiUrlCache = null;
let tokenSessao = null;

/** Fallback do instalador — nunca localhost no .exe do cliente. */
const API_URL_PRODUCAO = "https://pdv.vps10229.panel.icontainer.run";

export const EVENTO_SESSAO_EXPIRADA = "cybhor:sessao-expirada";
export const EVENTO_CONEXAO = "cybhor:conexao";

/** Gateway fora do ar responde 502/503/504: para o caixa é o mesmo que estar sem internet. */
const STATUS_SERVIDOR_INALCANCAVEL = new Set([502, 503, 504]);

let servidorAlcancavel = true;

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
  const configurada = String((await window.pdvAPI?.obterApiUrl?.()) || "")
    .trim()
    .replace(/\/+$/, "");
  apiUrlCache = configurada || API_URL_PRODUCAO;
  return apiUrlCache;
}

function mensagemErroRede(erro) {
  const bruto = String(
    (erro && erro.message) || (erro && erro.code) || erro || ""
  ).toLowerCase();
  if (
    bruto.includes("cert") ||
    bruto.includes("ssl") ||
    bruto.includes("tls") ||
    bruto.includes("err_cert")
  ) {
    return "Falha de certificado SSL ao falar com o servidor. Atualize o CybhorPDV ou a data/hora do Windows.";
  }
  if (bruto.includes("enotfound") || bruto.includes("getaddrinfo") || bruto.includes("err_name_not_resolved")) {
    return "Sem DNS/internet. Verifique a conexão de rede do computador.";
  }
  if (bruto.includes("etimedout") || bruto.includes("timeout") || bruto.includes("err_connection_timed_out")) {
    return "Tempo esgotado ao conectar. Verifique a internet e tente de novo.";
  }
  if (bruto.includes("econnrefused") || bruto.includes("err_connection_refused")) {
    return "Servidor recusou a conexão. Tente novamente em instantes.";
  }
  // CORS/preflight e offline no Chromium caem em TypeError "Failed to fetch".
  return "Sem conexão com o servidor CybhorPDV. Verifique a internet do computador e tente de novo.";
}

function registrarEstadoConexao(alcancavel) {
  if (servidorAlcancavel === alcancavel) return;
  servidorAlcancavel = alcancavel;
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_CONEXAO, { detail: { online: alcancavel } }));
  } catch {
    /* ambiente sem window */
  }
}

/** @returns {boolean} */
export function servidorEstaAlcancavel() {
  return servidorAlcancavel;
}

/**
 * Erros com `semConexao` não são recusa do servidor: a operação pode ser repetida
 * quando a internet voltar.
 * @param {unknown} erro
 * @returns {boolean}
 */
export function ehErroDeConexao(erro) {
  return Boolean(erro && erro.semConexao);
}

function criarErro(mensagem, { status = 0, semConexao = false } = {}) {
  const erro = new Error(mensagem);
  erro.status = status;
  erro.semConexao = semConexao;
  return erro;
}

/**
 * @param {string} caminho
 * @param {{ method?: string, body?: unknown, headers?: Record<string, string>, timeoutMs?: number }} [opcoes]
 */
export async function apiRequest(caminho, opcoes = {}) {
  const apiUrl = await obterApiUrl();
  const headers = {
    Accept: "application/json",
    ...(opcoes.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...(tokenSessao ? { Authorization: `Bearer ${tokenSessao}` } : {}),
    ...(opcoes.headers || {}),
  };

  // Internet "pendurada" não dá erro, só demora: sem limite o caixa fica travado.
  const controle = opcoes.timeoutMs > 0 ? new AbortController() : null;
  const temporizador = controle ? setTimeout(() => controle.abort(), opcoes.timeoutMs) : null;

  let resposta;
  try {
    resposta = await fetch(`${apiUrl}${caminho}`, {
      method: opcoes.method || "GET",
      headers,
      // Bearer only — alinhado ao CORS allow_credentials=False (file:// → https).
      credentials: "omit",
      body:
        opcoes.body === undefined
          ? undefined
          : JSON.stringify(opcoes.body),
      signal: controle?.signal,
    });
  } catch (erro) {
    registrarEstadoConexao(false);
    const motivo = controle?.signal.aborted ? new Error("timeout") : erro;
    throw criarErro(mensagemErroRede(motivo), { semConexao: true });
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }

  if (STATUS_SERVIDOR_INALCANCAVEL.has(resposta.status)) {
    registrarEstadoConexao(false);
    throw criarErro("Servidor CybhorPDV fora do ar no momento. Tente de novo em instantes.", {
      status: resposta.status,
      semConexao: true,
    });
  }
  registrarEstadoConexao(true);

  const dados =
    resposta.status === 204 ? null : await resposta.json().catch(() => null);
  if (resposta.status === 401) {
    notificarSessaoExpirada();
    throw criarErro(dados?.erro || dados?.detail || "Sessão expirada. Faça login novamente.", {
      status: 401,
    });
  }
  if (!resposta.ok) {
    throw criarErro(
      dados?.erro ||
        dados?.detail ||
        `Não foi possível concluir a operação (${resposta.status}).`,
      { status: resposta.status }
    );
  }
  return dados;
}
