import cors from "cors";
import { config } from "../config.js";

export const TAMANHO_MAX_REQUISICAO = 512 * 1024;

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' https://sdk.mercadopago.com https://http2.mlstatic.com https://www.mercadopago.com https://www.mercadopago.com.br",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: https:",
  "connect-src 'self' https://api.mercadopago.com https://api.mercadopago.com.br https://www.mercadopago.com https://www.mercadopago.com.br",
  "frame-src https://www.mercadopago.com https://www.mercadopago.com.br https://http2.mlstatic.com",
  "form-action 'self' https://www.mercadopago.com https://www.mercadopago.com.br",
].join("; ");

/** Cabeçalhos de segurança em todas as respostas (API, site e erros). */
export function cabecalhosSeguranca(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-DNS-Prefetch-Control", "off");
  if (config.emProducao) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

/** Recusa pelo Content-Length antes de ler o corpo (o express.json cobre envio chunked). */
export function limitarTamanhoRequisicao(req, res, next) {
  const tamanho = req.get("content-length");
  if (tamanho === undefined) return next();
  if (!/^\d+$/.test(tamanho)) return res.status(400).json({ erro: "Requisicao invalida." });
  if (Number(tamanho) > TAMANHO_MAX_REQUISICAO) return res.status(413).json({ erro: "Requisicao grande demais." });
  return next();
}

function origensPermitidas() {
  const origens = [...config.corsLista];
  if (config.emProducao) {
    const site = config.urlPublicaSite.replace(/\/+$/, "");
    if (site && !origens.includes(site)) origens.push(site);
  }
  return origens;
}

/**
 * CORS só com Bearer (sem cookies). Electron file:// envia Origin "null", sempre aceito
 * quando há lista de origens; sem lista fora de produção, libera qualquer origem.
 */
export function criarCors() {
  const origens = origensPermitidas();
  const opcoesBase = {
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Accept"],
    credentials: false,
    maxAge: 600,
  };
  if (!config.emProducao && !origens.length) return cors({ ...opcoesBase, origin: "*" });

  const permitidas = new Set([...origens, "null"]);
  return cors({
    ...opcoesBase,
    origin(origem, responder) {
      responder(null, origem !== undefined && permitidas.has(origem) ? origem : false);
    },
  });
}
