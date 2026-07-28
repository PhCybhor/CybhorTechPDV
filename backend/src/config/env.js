"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

/**
 * Configuracao central da API. Falha cedo se faltarem segredos obrigatorios,
 * evitando subir em producao com JWT fraco ou banco errado.
 */
const env = {
  porta: Number(process.env.PORT) || 3333,
  databaseUrl: process.env.DATABASE_URL || "",
  jwtSegredo: process.env.JWT_SEGREDO || "",
  jwtExpiracao: process.env.JWT_EXPIRACAO || "12h",
  corsOrigens: (process.env.CORS_ORIGENS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  mercadoPago: {
    appId: process.env.MP_APP_ID || "",
    accessToken: process.env.MP_ACCESS_TOKEN || "",
    publicKey: process.env.MP_PUBLIC_KEY || "",
    valorMensal: Number(process.env.ASSINATURA_VALOR_MENSAL) || 99.9,
    urlPublicaApi: process.env.URL_PUBLICA_API || "",
    urlPublicaSite: process.env.URL_PUBLICA_SITE || "http://localhost:3333",
  },
  emProducao: process.env.NODE_ENV === "production",
};

function validarObrigatorias() {
  const faltando = [];
  if (!env.databaseUrl) faltando.push("DATABASE_URL");
  if (!env.jwtSegredo || env.jwtSegredo.length < 32)
    faltando.push("JWT_SEGREDO (minimo 32 caracteres)");
  if (faltando.length > 0) {
    throw new Error(`Variaveis de ambiente ausentes/invalidas: ${faltando.join(", ")}`);
  }
}

module.exports = { env, validarObrigatorias };
