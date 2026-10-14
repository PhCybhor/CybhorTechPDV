/**
 * Aplica db/schema.sql no banco do DATABASE_URL (idempotente: CREATE TABLE IF NOT EXISTS).
 *
 * Uso: npm run banco:schema
 * Útil na Hostinger, onde o phpMyAdmin também serve, mas o terminal SSH é mais rápido.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { config, PASTA_BACKEND } from "../src/config.js";

const ARQUIVO_SCHEMA = path.join(PASTA_BACKEND, "db", "schema.sql");

function separarComandos(sql) {
  return sql
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((comando) => comando.trim())
    .filter(Boolean);
}

async function principal() {
  if (!config.bancoUrl) throw new Error("Defina DATABASE_URL no .env.");
  const conexao = await mysql.createConnection({ uri: config.bancoUrl, charset: "utf8mb4" });
  try {
    const comandos = separarComandos(readFileSync(ARQUIVO_SCHEMA, "utf8"));
    for (const comando of comandos) await conexao.query(comando);
    process.stdout.write(`Schema aplicado: ${comandos.length} comandos.\n`);
  } finally {
    await conexao.end();
  }
}

principal().catch((erro) => {
  process.stderr.write(`Falha ao aplicar schema: ${erro.message}\n`);
  process.exitCode = 1;
});
