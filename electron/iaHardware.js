"use strict";
const os = require("os");
const http = require("http");

function ramLivreGb() {
  return os.freemem() / 1024 ** 3;
}

function probeOllamaHttp(baseUrl = "http://127.0.0.1:11434") {
  return new Promise((resolve) => {
    const req = http.get(`${baseUrl}/api/tags`, { timeout: 800 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * @param {{
 *   ramMinGb?: number,
 *   diskMinGb?: number,
 *   ollamaBaseUrl?: string,
 *   probeOllama?: () => Promise<boolean>,
 *   ramLivreGbOverride?: number,
 * }} [opts]
 */
async function avaliarHardwareLocal(opts = {}) {
  const ramMin = Number.isFinite(opts.ramMinGb) ? opts.ramMinGb : 6;
  const livre =
    Number.isFinite(opts.ramLivreGbOverride)
      ? opts.ramLivreGbOverride
      : ramLivreGb();
  if (livre < ramMin) {
    return {
      localOk: false,
      motivo: `ram_livre_${livre.toFixed(1)}gb`,
      ramLivreGb: livre,
    };
  }
  const probe = opts.probeOllama || (() => probeOllamaHttp(opts.ollamaBaseUrl));
  const ollamaOk = await probe();
  if (!ollamaOk) {
    return { localOk: false, motivo: "ollama_indisponivel", ramLivreGb: livre };
  }
  return { localOk: true, motivo: "ok", ramLivreGb: livre };
}

module.exports = { avaliarHardwareLocal, probeOllamaHttp, ramLivreGb };
