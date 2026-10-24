import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const DIRETORIO_SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// O .env fica ao lado do package.json, independente de onde o processo foi iniciado.
dotenv.config({ path: resolve(DIRETORIO_SERVER, '.env') });

const VALORES_VERDADEIROS = new Set(['1', 'true', 't', 'yes', 'y', 'on']);

function lerTexto(chave, padrao = '') {
  const valor = process.env[chave];
  return valor === undefined ? padrao : valor;
}

function lerInteiro(chave, padrao) {
  const bruto = process.env[chave];
  if (bruto === undefined || bruto.trim() === '') return padrao;
  const numero = Number.parseInt(bruto, 10);
  return Number.isFinite(numero) ? numero : padrao;
}

function lerDecimal(chave, padrao) {
  const bruto = process.env[chave];
  if (bruto === undefined || bruto.trim() === '') return padrao;
  const numero = Number(bruto);
  return Number.isFinite(numero) ? numero : padrao;
}

function lerBooleano(chave, padrao = false) {
  const bruto = process.env[chave];
  if (bruto === undefined || bruto.trim() === '') return padrao;
  return VALORES_VERDADEIROS.has(bruto.trim().toLowerCase());
}

/**
 * Converte '12h', '7d', '30m', '45s' ou segundos numéricos em segundos.
 * Mesmas regras do backend original para não invalidar JWT_EXPIRACAO já em uso.
 * @param {string} valor
 * @returns {number}
 */
export function converterExpiracaoParaSegundos(valor) {
  const texto = (valor || '12h').trim().toLowerCase();
  const multiplicadores = { h: 3600, d: 86400, m: 60, s: 1 };
  const sufixo = texto.slice(-1);
  const corpo = multiplicadores[sufixo] ? texto.slice(0, -1) : texto;
  const quantidade = Number.parseInt(corpo, 10);
  if (!/^\d+$/.test(corpo) || !Number.isFinite(quantidade) || quantidade <= 0) {
    throw new Error(`JWT_EXPIRACAO invalida: "${valor}"`);
  }
  return quantidade * (multiplicadores[sufixo] || 1);
}

const nodeEnv = lerTexto('NODE_ENV');
const emProducao = ['production', 'prod'].includes(nodeEnv.trim().toLowerCase());

export const config = Object.freeze({
  databaseUrl: lerTexto('DATABASE_URL'),
  // mysql2 não mantém conexões mínimas; só o teto importa.
  dbPoolMax: Math.max(1, lerInteiro('DB_POOL_MAX', 20)),
  porta: lerInteiro('PORT', 3333),
  jwtSegredo: lerTexto('JWT_SEGREDO'),
  jwtExpiracaoSegundos: converterExpiracaoParaSegundos(lerTexto('JWT_EXPIRACAO', '12h')),
  corsOrigens: lerTexto('CORS_ORIGENS')
    .split(',')
    .map((origem) => origem.trim())
    .filter(Boolean),
  nodeEnv,
  emProducao,

  mpAccessToken: lerTexto('MP_ACCESS_TOKEN'),
  mpPublicKey: lerTexto('MP_PUBLIC_KEY'),
  mpWebhookSecret: lerTexto('MP_WEBHOOK_SECRET'),
  // Liberação temporária enquanto o segredo do painel MP não é cadastrado. Aceitável
  // porque o webhook sempre reconsulta o pagamento na API do MP com o nosso token:
  // a assinatura evita spam de consultas, mas não é o que impede pagamento forjado.
  // Ignorada assim que MP_WEBHOOK_SECRET for preenchido.
  mpWebhookSemAssinatura: lerBooleano('MP_WEBHOOK_SEM_ASSINATURA'),

  assinaturaValorMensal: lerDecimal('ASSINATURA_VALOR_MENSAL', 99.9),
  assinaturaValorSemestral: lerDecimal('ASSINATURA_VALOR_SEMESTRAL', 499.9),
  assinaturaValorAnual: lerDecimal('ASSINATURA_VALOR_ANUAL', 899.9),

  urlPublicaApi: lerTexto('URL_PUBLICA_API'),
  urlPublicaSite: lerTexto('URL_PUBLICA_SITE', 'http://localhost:3333'),
  // Client ID OAuth (tipo "Aplicativo da Web") do Google Cloud Console. Vazio = botão oculto.
  googleClientId: lerTexto('GOOGLE_CLIENT_ID').trim(),
  adminBootstrapSecret: lerTexto('ADMIN_BOOTSTRAP_SECRET'),

  diretorioAdmin: lerTexto('ADMIN_DIR') || resolve(DIRETORIO_SERVER, 'public/admin'),
  diretorioLanding: lerTexto('LANDING_DIR') || resolve(DIRETORIO_SERVER, 'landing'),
  diretorioDownloads: lerTexto('DOWNLOADS_DIR'),
});

/**
 * Falha cedo se faltarem segredos obrigatórios.
 * @throws {Error} com a lista de variáveis ausentes/inválidas.
 */
export function validarConfiguracaoObrigatoria() {
  const faltando = [];
  if (!config.databaseUrl) faltando.push('DATABASE_URL');
  if (!config.jwtSegredo || config.jwtSegredo.length < 32) {
    faltando.push('JWT_SEGREDO (minimo 32 caracteres)');
  }
  if (config.emProducao) {
    if (!config.mpAccessToken) faltando.push('MP_ACCESS_TOKEN');
    if (!config.mpWebhookSecret.trim() && !config.mpWebhookSemAssinatura) {
      faltando.push('MP_WEBHOOK_SECRET');
    }
    if (!config.urlPublicaApi.startsWith('https://')) faltando.push('URL_PUBLICA_API (https)');
  }
  if (faltando.length > 0) {
    throw new Error(`Variaveis de ambiente ausentes/invalidas: ${faltando.join(', ')}`);
  }
}
