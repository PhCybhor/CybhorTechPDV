import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PASTA_BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ARQUIVO_ENV = path.join(PASTA_BACKEND, ".env");
if (existsSync(ARQUIVO_ENV)) {
  // Variáveis já exportadas pelo painel (Hostinger/Docker) têm prioridade sobre o .env.
  process.loadEnvFile(ARQUIVO_ENV);
}

const VALORES_VERDADEIROS = new Set(["1", "true", "yes", "on", "sim"]);

function lerTexto(nome, padrao = "") {
  const valor = process.env[nome];
  return valor === undefined ? padrao : String(valor);
}

function lerInteiro(nome, padrao) {
  const numero = Number.parseInt(lerTexto(nome, ""), 10);
  return Number.isFinite(numero) ? numero : padrao;
}

function lerDecimal(nome, padrao) {
  const numero = Number.parseFloat(lerTexto(nome, ""));
  return Number.isFinite(numero) ? numero : padrao;
}

function lerBooleano(nome) {
  return VALORES_VERDADEIROS.has(lerTexto(nome, "").trim().toLowerCase());
}

/**
 * Configuração central lida das variáveis de ambiente (nunca do código).
 * Os nomes são os mesmos do backend Python para reaproveitar o mesmo .env.
 */
export const config = Object.freeze({
  bancoUrl: lerTexto("DATABASE_URL"),
  bancoPoolMax: Math.max(1, lerInteiro("DB_POOL_MAX", 10)),
  porta: lerInteiro("PORT", 3333),
  proxiesConfiaveis: Math.max(0, lerInteiro("PROXIES_CONFIAVEIS", 1)),
  jwtSegredo: lerTexto("JWT_SEGREDO"),
  jwtExpiracao: lerTexto("JWT_EXPIRACAO", "12h"),
  corsOrigens: lerTexto("CORS_ORIGENS"),
  ambiente: lerTexto("NODE_ENV"),

  mpAccessToken: lerTexto("MP_ACCESS_TOKEN"),
  mpPublicKey: lerTexto("MP_PUBLIC_KEY"),
  mpWebhookSecret: lerTexto("MP_WEBHOOK_SECRET"),
  // Liberação temporária enquanto o segredo do painel MP não é cadastrado. Aceitável
  // porque o webhook sempre reconsulta o pagamento na API do MP com nosso token:
  // a assinatura evita spam de consultas, mas não é o que impede pagamento forjado.
  mpWebhookSemAssinatura: lerBooleano("MP_WEBHOOK_SEM_ASSINATURA"),

  assinaturaValorMensal: lerDecimal("ASSINATURA_VALOR_MENSAL", 99.9),
  assinaturaValorSemestral: lerDecimal("ASSINATURA_VALOR_SEMESTRAL", 499.9),
  assinaturaValorAnual: lerDecimal("ASSINATURA_VALOR_ANUAL", 899.9),

  urlPublicaApi: lerTexto("URL_PUBLICA_API"),
  urlPublicaSite: lerTexto("URL_PUBLICA_SITE", "http://localhost:3333"),
  adminBootstrapSecret: lerTexto("ADMIN_BOOTSTRAP_SECRET"),
  pastaDownloads: lerTexto("PASTA_DOWNLOADS"),

  get corsLista() {
    return this.corsOrigens
      .split(",")
      .map((origem) => origem.trim())
      .filter(Boolean);
  },

  get emProducao() {
    return ["production", "prod"].includes(this.ambiente.trim().toLowerCase());
  },
});

/**
 * Falha cedo se faltarem segredos obrigatórios, igual ao backend Python.
 * @throws {Error} lista das variáveis ausentes ou inválidas.
 */
export function validarVariaveisObrigatorias() {
  const faltando = [];
  if (!config.bancoUrl) faltando.push("DATABASE_URL");
  if (config.jwtSegredo.length < 32) faltando.push("JWT_SEGREDO (minimo 32 caracteres)");
  if (config.emProducao) {
    if (!config.mpAccessToken) faltando.push("MP_ACCESS_TOKEN");
    if (!config.mpWebhookSecret.trim() && !config.mpWebhookSemAssinatura) {
      faltando.push("MP_WEBHOOK_SECRET");
    }
    if (!config.urlPublicaApi.startsWith("https://")) faltando.push("URL_PUBLICA_API (https)");
  }
  if (faltando.length) {
    throw new Error(`Variaveis de ambiente ausentes/invalidas: ${faltando.join(", ")}`);
  }
}
