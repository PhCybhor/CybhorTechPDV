"use strict";

const http = require("http");
const https = require("https");

/**
 * POST/GET JSON:
 * 1) electron.net (Chromium) — melhor TLS no Windows 7
 * 2) fetch nativo (Electron 31+)
 * 3) http/https do Node
 *
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string,string>, body?: string }} opcoes
 * @returns {Promise<{ ok: boolean, status: number, dados: any }>}
 */
function requisitarJson(url, opcoes = {}) {
  try {
    const { net, app } = require("electron");
    // Electron 22 (Win7) nao tem fetch no Node — preferir net apos ready.
    if (net && typeof net.request === "function" && app && app.isReady()) {
      return requisitarComElectronNet(net, url, opcoes);
    }
  } catch (_erro) {
    /* fora do processo Electron */
  }

  if (typeof fetch === "function") {
    return fetch(url, {
      method: opcoes.method || "GET",
      headers: opcoes.headers || {},
      body: opcoes.body,
    }).then(async (resposta) => {
      const dados = await resposta.json().catch(() => ({}));
      return { ok: resposta.ok, status: resposta.status, dados };
    });
  }

  return requisitarComNode(url, opcoes);
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
        } catch {
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
      },
      (res) => {
        const partes = [];
        res.on("data", (chunk) => partes.push(chunk));
        res.on("end", () => {
          const texto = Buffer.concat(partes).toString("utf8");
          let dados = {};
          try {
            dados = texto ? JSON.parse(texto) : {};
          } catch {
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

module.exports = { requisitarJson };
