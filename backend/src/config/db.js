"use strict";

const { Pool } = require("pg");
const { env } = require("./env");

/**
 * Pool unico de conexoes. Todas as consultas usam parametros ($1, $2...)
 * — nunca interpolacao de strings — para impedir SQL Injection.
 */
const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
});

/**
 * @param {string} sql
 * @param {Array<unknown>} [params]
 * @returns {Promise<import("pg").QueryResult>}
 */
function consultar(sql, params = []) {
  return pool.query(sql, params);
}

/**
 * Executa um bloco dentro de uma transacao.
 * @template T
 * @param {(cliente: import("pg").PoolClient) => Promise<T>} bloco
 * @returns {Promise<T>}
 */
async function transacao(bloco) {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const resultado = await bloco(cliente);
    await cliente.query("COMMIT");
    return resultado;
  } catch (erro) {
    await cliente.query("ROLLBACK");
    throw erro;
  } finally {
    cliente.release();
  }
}

module.exports = { pool, consultar, transacao };
