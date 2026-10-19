// Aplica db/schema.mysql.sql no banco de DATABASE_URL. O schema é idempotente.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';
import { DIRETORIO_SERVER, config } from '../src/config.js';
import { opcoesDaUrl } from '../src/db.js';

async function aplicarSchema() {
  if (!config.databaseUrl) throw new Error('DATABASE_URL nao definida.');
  const sql = await readFile(resolve(DIRETORIO_SERVER, 'db/schema.mysql.sql'), 'utf8');
  const conexao = await mysql.createConnection({
    ...opcoesDaUrl(config.databaseUrl),
    charset: 'utf8mb4',
    multipleStatements: true,
  });
  try {
    await conexao.query(sql);
    console.info('Schema aplicado com sucesso.');
  } finally {
    await conexao.end();
  }
}

aplicarSchema().catch((erro) => {
  console.error(`Falha ao aplicar o schema: ${erro.message}`);
  process.exit(1);
});
