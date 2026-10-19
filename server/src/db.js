import mysql from 'mysql2/promise';
import { config } from './config.js';
import { logger } from './logger.js';

const ER_LOCK_DEADLOCK = 'ER_LOCK_DEADLOCK';
const MAXIMO_TENTATIVAS_DEADLOCK = 3;

let pool = null;

/**
 * TINYINT(1) (BOOLEAN) vira boolean para a API devolver true/false como antes.
 * Demais tipos seguem o parser padrão do mysql2.
 */
function converterTipoColuna(campo, proximo) {
  if (campo.type === 'TINY' && campo.length === 1) {
    const valor = campo.string();
    return valor === null ? null : valor === '1';
  }
  return proximo();
}

/** Converte DATABASE_URL (mysql://usuario:senha@host:porta/banco) nas opções do mysql2. */
export function opcoesDaUrl(databaseUrl) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL invalida. Use mysql://usuario:senha@host:3306/banco');
  }
  if (url.protocol !== 'mysql:') {
    throw new Error('DATABASE_URL deve usar o protocolo mysql://');
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
}

function criarPool() {
  const novoPool = mysql.createPool({
    ...opcoesDaUrl(config.databaseUrl),
    connectionLimit: config.dbPoolMax,
    waitForConnections: true,
    queueLimit: 0,
    charset: 'utf8mb4',
    // Datas armazenadas e lidas sempre em UTC.
    timezone: 'Z',
    // DATE vira 'YYYY-MM-DD' (sem fuso); DATETIME vira Date e serializa como ISO-8601.
    dateStrings: ['DATE'],
    // DECIMAL como number: o contrato JSON sempre devolveu valores monetários numéricos.
    decimalNumbers: true,
    supportBigNumbers: true,
    // UPDATE devolve linhas casadas (não só alteradas): "0 linhas" significa "não encontrado".
    flags: ['+FOUND_ROWS'],
    enableKeepAlive: true,
    keepAliveInitialDelay: 30_000,
    typeCast: converterTipoColuna,
  });

  // READ COMMITTED reproduz o padrão do PostgreSQL e evita gap locks do InnoDB, que
  // causariam deadlock ao bloquear (FOR UPDATE) documentos_loja ainda inexistentes.
  // Os comandos de uma conexão são enfileirados: o SET roda antes de qualquer query do pool.
  novoPool.pool.on('connection', (conexao) => {
    conexao.query(
      "SET time_zone = '+00:00', SESSION transaction_isolation = 'READ-COMMITTED'",
      (erro) => {
        if (erro) logger.error('falha ao configurar sessao MySQL', erro);
      },
    );
  });
  return novoPool;
}

/** @returns {import('mysql2/promise').Pool} */
export function obterPool() {
  if (pool === null) pool = criarPool();
  return pool;
}

export async function fecharPool() {
  if (pool !== null) {
    const atual = pool;
    pool = null;
    await atual.end();
  }
}

// Usamos query() (e não execute()) porque o protocolo de prepared statements do MySQL 8
// rejeita parâmetros numéricos em LIMIT/INTERVAL. Os "?" continuam sendo escapados pelo
// driver: nunca concatene dados do usuário no SQL.

/**
 * Executa SELECT e devolve as linhas.
 * @param {string} sql
 * @param {any[]} [params]
 * @returns {Promise<Record<string, any>[]>}
 */
export async function consultar(sql, params = []) {
  const [linhas] = await obterPool().query(sql, params);
  return linhas;
}

/**
 * Executa INSERT/UPDATE/DELETE e devolve as linhas afetadas.
 * @param {string} sql
 * @param {any[]} [params]
 * @returns {Promise<number>}
 */
export async function executar(sql, params = []) {
  const [resultado] = await obterPool().query(sql, params);
  return resultado.affectedRows;
}

/**
 * Contexto de transação entregue aos serviços: mesma conexão para todas as queries.
 * @typedef {Object} ContextoTransacao
 * @property {(sql: string, params?: any[]) => Promise<Record<string, any>[]>} consultar
 * @property {(sql: string, params?: any[]) => Promise<number>} executar
 */

function criarContexto(conexao) {
  return {
    async consultar(sql, params = []) {
      const [linhas] = await conexao.query(sql, params);
      return linhas;
    },
    async executar(sql, params = []) {
      const [resultado] = await conexao.query(sql, params);
      return resultado.affectedRows;
    },
  };
}

async function adquirirLockNomeado(conexao, nome, timeoutSegundos) {
  const [linhas] = await conexao.query('SELECT GET_LOCK(?, ?) AS adquirido', [nome, timeoutSegundos]);
  if (Number(linhas[0].adquirido) !== 1) {
    throw new Error(`Nao foi possivel adquirir o lock "${nome}"`);
  }
}

async function liberarLockNomeado(conexao, nome) {
  try {
    await conexao.query('SELECT RELEASE_LOCK(?)', [nome]);
  } catch (erro) {
    logger.error('falha ao liberar lock nomeado', erro);
  }
}

async function executarTransacaoUmaVez(callback, { lockNome, lockTimeoutSegundos }) {
  const conexao = await obterPool().getConnection();
  let lockAdquirido = false;
  try {
    // O lock nomeado (GET_LOCK) é da sessão: precisa ser pego antes do BEGIN e solto só
    // depois do COMMIT, para quem esperava enxergar o resultado já confirmado.
    if (lockNome) {
      await adquirirLockNomeado(conexao, lockNome, lockTimeoutSegundos);
      lockAdquirido = true;
    }
    await conexao.beginTransaction();
    try {
      const resultado = await callback(criarContexto(conexao));
      await conexao.commit();
      return resultado;
    } catch (erro) {
      await conexao.rollback().catch(() => {});
      throw erro;
    }
  } finally {
    if (lockAdquirido) await liberarLockNomeado(conexao, lockNome);
    conexao.release();
  }
}

/**
 * Executa o callback dentro de BEGIN/COMMIT (ROLLBACK em qualquer erro).
 * Em deadlock a transação inteira é repetida, por isso o callback deve reler
 * seu estado a cada execução (todos os serviços o fazem com SELECT … FOR UPDATE).
 *
 * @template T
 * @param {(contexto: ContextoTransacao) => Promise<T>} callback
 * @param {{ lockNome?: string, lockTimeoutSegundos?: number }} [opcoes]
 * @returns {Promise<T>}
 */
export async function transacao(callback, opcoes = {}) {
  const { lockNome = '', lockTimeoutSegundos = 30 } = opcoes;
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      return await executarTransacaoUmaVez(callback, { lockNome, lockTimeoutSegundos });
    } catch (erro) {
      const deadlock = erro?.code === ER_LOCK_DEADLOCK;
      if (!deadlock || tentativa >= MAXIMO_TENTATIVAS_DEADLOCK) throw erro;
    }
  }
}

/** SELECT 1 barato para readiness. Não expõe erro/DSN. */
export async function ping() {
  try {
    const linhas = await consultar('SELECT 1 AS ok');
    return linhas.length > 0;
  } catch {
    return false;
  }
}

/** @param {unknown} erro @param {string} codigo ex.: 'ER_DUP_ENTRY' */
export function ehErroMysql(erro, codigo) {
  return typeof erro === 'object' && erro !== null && erro.code === codigo;
}
