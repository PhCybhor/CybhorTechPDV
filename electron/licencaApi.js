"use strict";

const { requisitarJson, traduzirErroRede } = require("./httpJson");

/** URL publica de producao — fallback do instalador (nunca localhost no .exe). */
const API_URL_PRODUCAO = "https://pdv.cybhor.tech";

/**
 * @returns {boolean}
 */
function appEmpacotado() {
  try {
    const { app } = require("electron");
    return Boolean(app.isPackaged);
  } catch (_erro) {
    return false;
  }
}

/**
 * @returns {string}
 */
function obterUrlApi() {
  const configurada = String(process.env.CYBHOR_API_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (configurada) return configurada;
  if (appEmpacotado()) return API_URL_PRODUCAO;
  return "http://localhost:3333";
}

/**
 * Hosts oficiais da API — usados no bypass controlado de certificado (Win7).
 * @returns {Set<string>}
 */
function hostsApiConfiaveis() {
  const hosts = new Set(["pdv.cybhor.tech", "pdv.vps10229.panel.icontainer.run"]);
  try {
    hosts.add(new URL(API_URL_PRODUCAO).hostname);
  } catch (_erro) {
    /* ignore */
  }
  try {
    const atual = obterUrlApi();
    if (atual.startsWith("https://")) hosts.add(new URL(atual).hostname);
  } catch (_erro) {
    /* ignore */
  }
  return hosts;
}

/**
 * Testa se a API responde (usado na tela de ativacao/login).
 * @returns {Promise<{ok: boolean, mensagem: string, apiUrl: string}>}
 */
async function testarConexaoApi() {
  const apiUrl = obterUrlApi();
  try {
    const resposta = await requisitarJson(`${apiUrl}/api/saude`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (resposta.ok && (resposta.dados?.ok === true || resposta.status === 200)) {
      return { ok: true, mensagem: "Conectado ao servidor CybhorPDV.", apiUrl };
    }
    return {
      ok: false,
      mensagem:
        "Servidor respondeu, mas a saude da API falhou. Tente de novo em instantes.",
      apiUrl,
    };
  } catch (erro) {
    return {
      ok: false,
      mensagem: traduzirErroRede(erro),
      apiUrl,
    };
  }
}

/**
 * @param {string} chave
 * @returns {Promise<{ok: boolean, lojaId?: string, email?: string, nomeLoja?: string, mensagem?: string, chave?: string}>}
 */
async function validarLicencaRemota(chave) {
  const limpa = String(chave || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  if (!limpa || limpa.length < 6) {
    return { ok: false, mensagem: "Digite o codigo da loja (ex.: MP9S33)." };
  }

  const url = `${obterUrlApi()}/api/ativar`;
  try {
    const resposta = await requisitarJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ chave: limpa }),
    });
    const dados = resposta.dados || {};
    if (!resposta.ok || !dados.ok) {
      return {
        ok: false,
        mensagem:
          dados.mensagem ||
          dados.erro ||
          "Codigo invalido ou loja inativa. Confira o codigo na Area do cliente do site.",
      };
    }
    return {
      ok: true,
      lojaId: dados.lojaId,
      email: dados.email || "",
      nomeLoja: dados.nomeLoja || "",
      chave: limpa,
    };
  } catch (erro) {
    return {
      ok: false,
      mensagem: traduzirErroRede(erro),
    };
  }
}

module.exports = {
  API_URL_PRODUCAO,
  obterUrlApi,
  hostsApiConfiaveis,
  testarConexaoApi,
  validarLicencaRemota,
};
