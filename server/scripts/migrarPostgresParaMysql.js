#!/usr/bin/env node
/**
 * Copia dados do PostgreSQL legado para o MySQL 8 da API Node.
 *
 * Uso:
 *   SOURCE_DATABASE_URL=postgres://... DATABASE_URL=mysql://... npm run db:migrar-pg
 *
 * Idempotente por REPLACE/upsert nas PKs. Respeita FKs na ordem das tabelas.
 */
import 'dotenv/config';
import pg from 'pg';
import mysql from 'mysql2/promise';

const ORDEM = [
  'lojas',
  'administradores_sistema',
  'funcionarios',
  'produtos',
  'assinaturas',
  'vendas',
  'venda_itens',
  'pagamentos',
  'documentos_loja',
  'trials_cpf',
  'aceites_diretrizes',
];

function parseMysqlUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    timezone: 'Z',
    dateStrings: true,
  };
}

function comoTexto(valor) {
  if (valor == null) return null;
  return String(valor);
}

function comoJson(valor) {
  if (valor == null) return null;
  if (typeof valor === 'string') return valor;
  return JSON.stringify(valor);
}

function comoDatetime(valor) {
  if (valor == null) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 23).replace('T', ' ');
}

function comoDate(valor) {
  if (valor == null) return null;
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}

async function tabelasPostgres(client) {
  const { rows } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  return new Set(rows.map((r) => r.tablename));
}

async function lerTabela(client, tabela) {
  const { rows } = await client.query(`SELECT * FROM ${tabela}`);
  return rows;
}

function mapearLinha(tabela, row) {
  switch (tabela) {
    case 'lojas':
      return {
        id: comoTexto(row.id),
        nome: row.nome ?? '',
        cnpj: row.cnpj ?? '',
        endereco: row.endereco ?? '',
        telefone: row.telefone ?? '',
        email: row.email ?? '',
        cpf: row.cpf ?? '',
        responsavel_nome: row.responsavel_nome ?? '',
        responsavel_sobrenome: row.responsavel_sobrenome ?? '',
        codigo: row.codigo,
        ativa: row.ativa ? 1 : 0,
        criado_em: comoDatetime(row.criado_em),
        atualizado_em: comoDatetime(row.atualizado_em),
      };
    case 'administradores_sistema':
      return {
        id: comoTexto(row.id),
        nome: row.nome,
        email: row.email,
        salt: row.salt,
        senha_hash: row.senha_hash,
        criado_em: comoDatetime(row.criado_em),
      };
    case 'funcionarios':
      return {
        id: comoTexto(row.id),
        loja_id: comoTexto(row.loja_id),
        nome: row.nome,
        usuario: row.usuario,
        salt: row.salt,
        senha_hash: row.senha_hash,
        cargo: row.cargo,
        dados: comoJson(row.dados ?? {}),
        criado_em: comoDatetime(row.criado_em),
        atualizado_em: comoDatetime(row.atualizado_em),
      };
    case 'produtos':
      return {
        id: comoTexto(row.id),
        loja_id: comoTexto(row.loja_id),
        nome: row.nome,
        codigo_barras: row.codigo_barras ?? '',
        preco: row.preco,
        estoque: row.estoque ?? 0,
        categoria: row.categoria ?? '',
        criado_em: comoDatetime(row.criado_em),
        atualizado_em: comoDatetime(row.atualizado_em),
      };
    case 'assinaturas':
      return {
        id: comoTexto(row.id),
        loja_id: comoTexto(row.loja_id),
        plano: row.plano ?? 'mensal',
        valor_mensal: row.valor_mensal ?? 0,
        status: row.status ?? 'pendente',
        mp_preference_id: row.mp_preference_id ?? null,
        token_ativacao: row.token_ativacao ?? null,
        valida_ate: comoDate(row.valida_ate),
        atualizado_em: comoDatetime(row.atualizado_em),
      };
    case 'vendas':
      return {
        id: comoTexto(row.id),
        loja_id: comoTexto(row.loja_id),
        funcionario_id: comoTexto(row.funcionario_id),
        funcionario_nome: row.funcionario_nome,
        subtotal: row.subtotal,
        desconto: row.desconto ?? 0,
        total: row.total,
        forma_pagamento: row.forma_pagamento,
        criado_em: comoDatetime(row.criado_em),
      };
    case 'venda_itens':
      return {
        id: Number(row.id),
        venda_id: comoTexto(row.venda_id),
        produto_id: comoTexto(row.produto_id),
        nome: row.nome,
        quantidade: row.quantidade,
        preco_unitario: row.preco_unitario,
        subtotal: row.subtotal,
      };
    case 'pagamentos':
      return {
        id: comoTexto(row.id),
        loja_id: comoTexto(row.loja_id),
        mp_payment_id: row.mp_payment_id ?? null,
        status: row.status,
        valor: row.valor,
        payload: comoJson(row.payload),
        criado_em: comoDatetime(row.criado_em),
      };
    case 'documentos_loja':
      return {
        loja_id: comoTexto(row.loja_id),
        recurso: row.recurso,
        dados: comoJson(row.dados ?? {}),
        atualizado_em: comoDatetime(row.atualizado_em),
      };
    case 'trials_cpf':
      return {
        cpf: row.cpf,
        loja_id: comoTexto(row.loja_id),
        criado_em: comoDatetime(row.criado_em),
      };
    case 'aceites_diretrizes':
      return {
        id: comoTexto(row.id),
        loja_id: comoTexto(row.loja_id),
        versao: row.versao,
        ip: row.ip ?? '',
        navegador: row.navegador ?? '',
        aceito_em: comoDatetime(row.aceito_em),
      };
    default:
      throw new Error(`Tabela nao mapeada: ${tabela}`);
  }
}

async function upsert(conn, tabela, linha) {
  const cols = Object.keys(linha);
  const placeholders = cols.map(() => '?').join(', ');
  const updates = cols
    .filter((c) => c !== 'id' || tabela === 'venda_itens')
    .map((c) => `\`${c}\` = VALUES(\`${c}\`)`)
    .join(', ');
  const sql = `INSERT INTO \`${tabela}\` (${cols.map((c) => `\`${c}\``).join(', ')})
    VALUES (${placeholders})
    ON DUPLICATE KEY UPDATE ${updates}`;
  await conn.execute(sql, cols.map((c) => linha[c]));
}

async function main() {
  const sourceUrl =
    process.env.SOURCE_DATABASE_URL ||
    process.env.POSTGRES_DATABASE_URL ||
    '';
  const mysqlUrl = process.env.DATABASE_URL || '';
  if (!sourceUrl.startsWith('postgres')) {
    throw new Error(
      'Defina SOURCE_DATABASE_URL=postgres://usuario:senha@host:5432/banco'
    );
  }
  if (!mysqlUrl.startsWith('mysql')) {
    throw new Error('Defina DATABASE_URL=mysql://usuario:senha@host:3306/banco');
  }

  const pgClient = new pg.Client({ connectionString: sourceUrl });
  await pgClient.connect();
  const mysqlConn = await mysql.createConnection(parseMysqlUrl(mysqlUrl));
  await mysqlConn.query("SET time_zone = '+00:00'");
  await mysqlConn.query('SET FOREIGN_KEY_CHECKS = 0');

  const existentes = await tabelasPostgres(pgClient);
  const resumo = [];

  try {
    await mysqlConn.beginTransaction();
    for (const tabela of ORDEM) {
      if (!existentes.has(tabela)) {
        resumo.push({ tabela, origem: 0, destino: 0, pulada: true });
        continue;
      }
      const rows = await lerTabela(pgClient, tabela);
      for (const row of rows) {
        await upsert(mysqlConn, tabela, mapearLinha(tabela, row));
      }
      const [[{ c }]] = await mysqlConn.query(
        `SELECT COUNT(*) AS c FROM \`${tabela}\``
      );
      resumo.push({
        tabela,
        origem: rows.length,
        destino: Number(c),
        pulada: false,
      });
    }
    // Ajusta AUTO_INCREMENT de venda_itens apos copiar IDs explicitos.
    const [[{ maxId }]] = await mysqlConn.query(
      'SELECT COALESCE(MAX(id), 0) AS maxId FROM venda_itens'
    );
    await mysqlConn.query(
      `ALTER TABLE venda_itens AUTO_INCREMENT = ${Number(maxId) + 1}`
    );
    await mysqlConn.commit();
  } catch (erro) {
    await mysqlConn.rollback();
    throw erro;
  } finally {
    await mysqlConn.query('SET FOREIGN_KEY_CHECKS = 1');
    await mysqlConn.end();
    await pgClient.end();
  }

  console.log(JSON.stringify({ ok: true, resumo }, null, 2));
}

main().catch((erro) => {
  console.error('Migracao falhou:', erro?.message || erro);
  process.exit(1);
});
