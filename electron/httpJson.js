"use strict";

const http = require("http");
const https = require("https");

/**
 * POST/GET JSON com fallbacks (Win7 / Electron 22 sem fetch nativo):
 * 1) electron.net (Chromium)
 * 2) fetch (Electron 31+)
 * 3) http/https do Node
 *
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string,string>, body?: string }} opcoes
 * @returns {Promise<{ ok: boolean, status: number, dados: any }>}
 */
async function requisitarJson(url, opcoes = {}) {
  const erros = [];

  try {
    const { net, app } = require("electron");
    if (net && typeof net.request === "function" && app && app.isReady()) {
      return await requisitarComElectronNet(net, url, opcoes);
    }
  } catch (erro) {
    erros.push(erro);
  }

  if (typeof fetch === "function") {
    try {
      const resposta = await fetch(url, {
        method: opcoes.method || "GET",
        headers: opcoes.headers || {},
        credentials: "omit",
        body: opcoes.body,
      });
      const dados = await resposta.json().catch(() => ({}));
      return { ok: resposta.ok, status: resposta.status, dados };
    } catch (erro) {
      erros.push(erro);
    }
  }

  try {
    return await requisitarComNode(url, opcoes);
  } catch (erro) {
    erros.push(erro);
    const ultimo = erros[erros.length - 1] || erro;
    const mensagem = traduzirErroRede(ultimo);
    const falha = new Error(mensagem);
    falha.causa = ultimo;
    throw falha;
  }
}

/**
 * @param {unknown} erro
 * @returns {string}
 */
function traduzirErroRede(erro) {
  const bruto = String(
    (erro && erro.message) || (erro && erro.code) || erro || "falha de rede"
  );
  const texto = bruto.toLowerCase();
  if (
    texto.includes("cert") ||
    texto.includes("ssl") ||
    texto.includes("tls") ||
    texto.includes("unable_to_verify") ||
    texto.includes("err_cert")
  ) {
    return "Falha de certificado SSL ao falar com o servidor. Atualize o CybhorPDV ou a data/hora do Windows.";
  }
  if (texto.includes("enotfound") || texto.includes("getaddrinfo")) {
    return "Sem DNS/internet. Verifique a conexao de rede do computador.";
  }
  if (texto.includes("etimedout") || texto.includes("timeout") || texto.includes("tempo esgotado")) {
    return "Tempo esgotado ao conectar. Verifique a internet e tente de novo.";
  }
  if (texto.includes("econnrefused")) {
    return "Servidor recusou a conexao. Tente novamente em instantes.";
  }
  return "Sem conexao com o servidor. Verifique a internet e tente novamente.";
}

/**
 * @param {typeof import("electron").net} net
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string,string>, body?: string }} opcoes
 */
function requisitarComElectronNet(net, url, opcoes) {
  return new Promise((resolve, reject) => {
    const req = net.request({
      url,
      method: opcoes.method || "GET",
    });
    const headers = opcoes.headers || {};
    for (const [chave, valor] of Object.entries(headers)) {
      if (valor != null) req.setHeader(chave, String(valor));
    }
    const partes = [];
    req.on("response", (res) => {
      res.on("data", (chunk) => partes.push(Buffer.from(chunk)));
      res.on("end", () => {
        const texto = Buffer.concat(partes).toString("utf8");
        let dados = {};
        try {
          dados = texto ? JSON.parse(texto) : {};
        } catch (_erro) {
          dados = {};
        }
        const status = res.statusCode || 0;
        resolve({ ok: status >= 200 && status < 300, status, dados });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    if (opcoes.body) req.write(opcoes.body);
    req.end();
  });
}

/**
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string,string>, body?: string }} opcoes
 */
function requisitarComNode(url, opcoes) {
  return new Promise((resolve, reject) => {
    const alvo = new URL(url);
    const lib = alvo.protocol === "https:" ? https : http;
    const corpo = opcoes.body || "";
    const headers = { ...(opcoes.headers || {}) };
    if (corpo && !headers["Content-Length"]) {
      headers["Content-Length"] = Buffer.byteLength(corpo);
    }
    const req = lib.request(
      {
        hostname: alvo.hostname,
        port: alvo.port || (alvo.protocol === "https:" ? 443 : 80),
        path: `${alvo.pathname}${alvo.search}`,
        method: opcoes.method || "GET",
        headers,
        timeout: 20000,
        // Ultimo recurso no Node: alguns Win7 quebram na cadeia LE nova.
        rejectUnauthorized: true,
      },
      (res) => {
        const partes = [];
        res.on("data", (chunk) => partes.push(chunk));
        res.on("end", () => {
          const texto = Buffer.concat(partes).toString("utf8");
          let dados = {};
          try {
            dados = texto ? JSON.parse(texto) : {};
          } catch (_erro) {
            dados = {};
          }
          const status = res.statusCode || 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            dados,
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("Tempo esgotado ao conectar ao servidor."));
    });
    req.on("error", reject);
    if (corpo) req.write(corpo);
    req.end();
  });
}

module.exports = { requisitarJson, traduzirErroRede };
