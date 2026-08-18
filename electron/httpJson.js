"use strict";

const http = require("http");
const https = require("https");

/**
 * POST/GET JSON compativel com Electron 22 (Node 16, sem fetch nativo).
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string,string>, body?: string }} opcoes
 * @returns {Promise<{ ok: boolean, status: number, dados: any }>}
 */
function requisitarJson(url, opcoes = {}) {
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
    req.on("error", reject);
    if (corpo) req.write(corpo);
    req.end();
  });
}

module.exports = { requisitarJson };
