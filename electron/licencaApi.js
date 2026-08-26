"use strict";

const { requisitarJson } = require("./httpJson");

/** URL publica de producao — fallback do instalador (nunca localhost no .exe). */
const API_URL_PRODUCAO = "https://pdv.vps10229.panel.icontainer.run";

/**
 * @returns {boolean}
 */
function appEmpacotado() {
  try {
    const { app } = require("electron");
    return Boolean(app?.isPackaged);
  } catch {
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
    if (resposta.ok && resposta.dados?.ok) {
      return { ok: true, mensagem: "Conectado ao servidor CybhorPDV.", apiUrl };
    }
    return {
      ok: false,
      mensagem: "Servidor respondeu, mas a saude da API falhou. Tente de novo em instantes.",
      apiUrl,
    };
  } catch (erro) {
    return {
      ok: false,
      mensagem:
        "Sem conexao com o servidor. Verifique a internet do computador e tente novamente.",
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
  } catch {
    return {
      ok: false,
      mensagem:
        "Nao foi possivel conectar ao servidor. Verifique a internet e tente novamente.",
    };
  }
}

module.exports = {
  API_URL_PRODUCAO,
  obterUrlApi,
  testarConexaoApi,
  validarLicencaRemota,
};
