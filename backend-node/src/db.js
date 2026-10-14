import mysql from "mysql2/promise";
import { config } from "./config.js";

let pool = null;

function criarPool() {
  const novoPool = mysql.createPool({
    uri: config.bancoUrl,
    connectionLimit: config.bancoPoolMax,
    waitForConnections: true,
    enableKeepAlive: true,
    // Datas sempre em UTC; DATE volta como 'AAAA-MM-DD' (igual ao str(date) do Python).
    timezone: "Z",
    dateStrings: ["DATE"],
    decimalNumbers: true,
    charset: "utf8mb4",
  });
  // DEFAULT CURRENT_TIMESTAMP grava no fuso da sessão; fixar UTC evita misturar fusos.
  novoPool.pool.on("connection", (conexao) => {
    conexao.query("SET time_zone = '+00:00'");
  });
  return novoPool;
}

function obterPool() {
  if (!pool) pool = criarPool();
  return pool;
}

/**
 * Gera "?, ?, ?" para listas em IN (...), já que prepared statements não expandem arrays.
 * @param {number} quantidade
 * @returns {string}
 */
export function marcadores(quantidade) {
  return Array.from({ length: quantidade }, () => "?").join(", ");
}

/**
 * MariaDB guarda JSON como LONGTEXT e devolve string; MySQL devolve objeto.
 * @param {unknown} valor
 * @returns {unknown}
 */
export function lerJson(valor) {
  if (typeof valor !== "string") return valor ?? null;
  try {
    return JSON.parse(valor);
  } catch {
    return null;
  }
}

// O mysql2 rejeita `undefined` em prepared statements; campo ausente vira NULL.
function normalizarParametros(parametros) {
  return parametros.map((valor) => (valor === undefined ? null : valor));
}

function criarExecutor(alvo) {
  return {
    /** @returns {Promise<Record<string, any>[]>} */
    async consultar(sql, parametros = []) {
      const [linhas] = await alvo.execute(sql, normalizarParametros(parametros));
      return Array.isArray(linhas) ? linhas : [];
    },
    /** @returns {Promise<number>} linhas encontradas pelo WHERE (FOUND_ROWS do mysql2). */
    async executar(sql, parametros = []) {
      const [resultado] = await alvo.execute(sql, normalizarParametros(parametros));
      return resultado.affectedRows ?? 0;
    },
  };
}

/**
 * SELECT com prepared statement; devolve as linhas.
 * @param {string} sql
 * @param {unknown[]} [parametros]
 */
export function consultar(sql, parametros = []) {
  return criarExecutor(obterPool()).consultar(sql, parametros);
}

/**
 * INSERT/UPDATE/DELETE com prepared statement; devolve as linhas afetadas.
 * @param {string} sql
 * @param {unknown[]} [parametros]
 */
export function executar(sql, parametros = []) {
  return criarExecutor(obterPool()).executar(sql, parametros);
}

/**
 * Executa `trabalho` dentro de BEGIN/COMMIT na mesma conexão.
 * `bloqueio` serializa transações com a mesma chave (GET_LOCK substitui o
 * pg_advisory_xact_lock; como ele é por sessão, é liberado manualmente no fim).
 * @template T
 * @param {(transacao: ReturnType<typeof criarExecutor>) => Promise<T>} trabalho
 * @param {{ bloqueio?: string }} [opcoes]
 * @returns {Promise<T>}
 */
export async function transacao(trabalho, { bloqueio } = {}) {
  const conexao = await obterPool().getConnection();
  let bloqueado = false;
  try {
    if (bloqueio) {
      const [linhas] = await conexao.execute("SELECT GET_LOCK(?, 30) AS obtido", [bloqueio]);
      if (linhas[0]?.obtido !== 1) throw new Error(`Nao foi possivel obter o bloqueio ${bloqueio}.`);
      bloqueado = true;
    }
    await conexao.beginTransaction();
    try {
      const resultado = await trabalho(criarExecutor(conexao));
      await conexao.commit();
      return resultado;
    } catch (erro) {
      await conexao.rollback();
      throw erro;
    }
  } finally {
    if (bloqueado) await conexao.execute("SELECT RELEASE_LOCK(?)", [bloqueio]).catch(() => {});
    conexao.release();
  }
}

/** SELECT 1 barato para readiness; não expõe erro nem DSN. */
export async function pingar() {
  try {
    const linhas = await consultar("SELECT 1 AS ok");
    return linhas.length > 0;
  } catch {
    return false;
  }
}

export async function fecharPool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Erro de chave única duplicada (equivalente ao UniqueViolation do Postgres). */
export function ehChaveDuplicada(erro) {
  return erro?.code === "ER_DUP_ENTRY";
}
