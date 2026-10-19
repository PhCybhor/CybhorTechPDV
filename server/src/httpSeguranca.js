import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';

export const TAMANHO_MAX_REQUISICAO_BYTES = 512 * 1024;

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
  'frame-src https://www.mercadopago.com https://www.mercadopago.com.br https://http2.mlstatic.com',
  "form-action 'self' https://www.mercadopago.com https://www.mercadopago.com.br",
].join('; ');

const METODOS_CORS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const CABECALHOS_CORS = ['Authorization', 'Content-Type', 'Accept'];

/**
 * IP do cliente atrás do nginx (X-Forwarded-For), senão o peer direto.
 *
 * Usa o primeiro hop do XFF porque, no Docker, todos os clientes chegam com o IP do
 * bridge e o rate limit viraria global. O nginx precisa sobrescrever (não anexar) o
 * cabeçalho, senão o cliente consegue forjar o IP.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
export function chaveRateLimit(req) {
  const encaminhado = req.headers['x-forwarded-for'] || req.headers['x-real-ip'];
  if (typeof encaminhado === 'string' && encaminhado) {
    const primeiro = encaminhado.split(',')[0].trim();
    if (primeiro) return primeiro;
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Limita o tamanho do corpo (via Content-Length) e aplica os cabeçalhos de segurança.
 * @type {import('express').RequestHandler}
 */
export function cabecalhosSeguranca(req, res, next) {
  const tamanho = req.headers['content-length'];
  if (tamanho !== undefined) {
    const bytes = Number(tamanho);
    if (!Number.isInteger(bytes) || bytes < 0) {
      res.status(400).json({ erro: 'Requisicao invalida.' });
      return;
    }
    if (bytes > TAMANHO_MAX_REQUISICAO_BYTES) {
      res.status(413).json({ erro: 'Requisicao grande demais.' });
      return;
    }
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  if (config.emProducao) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

/**
 * CORS sem cookies (Bearer only). Electron via file:// envia Origin "null" e precisa
 * ser aceito mesmo quando CORS_ORIGENS está vazio em produção.
 */
export function criarMiddlewareCors() {
  const origens = [...config.corsOrigens];
  const base = {
    methods: METODOS_CORS,
    allowedHeaders: CABECALHOS_CORS,
    credentials: false,
    optionsSuccessStatus: 200,
    maxAge: 600,
  };

  if (config.emProducao) {
    const site = config.urlPublicaSite.replace(/\/+$/, '');
    if (site && !origens.includes(site)) origens.push(site);
  }

  const restringir = config.emProducao || origens.length > 0;
  if (!restringir) return cors({ ...base, origin: '*' });

  return cors({
    ...base,
    origin: (origem, retorno) => retorno(null, origem === 'null' || origens.includes(origem)),
  });
}

/**
 * Rate limit por IP e por rota (cada chamada cria um contador independente).
 * @param {number} maximo requisições permitidas na janela.
 * @param {number} janelaMinutos
 */
export function criarLimitador(maximo, janelaMinutos) {
  return rateLimit({
    windowMs: janelaMinutos * 60 * 1000,
    limit: maximo,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: chaveRateLimit,
    // O IP vem do XFF por escolha própria (ver chaveRateLimit); a validação padrão
    // da lib só reclama porque "trust proxy" não está ligado.
    validate: { xForwardedForHeader: false, trustProxy: false, ip: false },
    handler: (_req, res) => {
      res.status(429).json({ erro: 'Muitas requisicoes. Tente novamente em instantes.' });
    },
  });
}
