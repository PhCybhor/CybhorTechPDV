"use strict";

const jwt = require("jsonwebtoken");
const { consultar } = require("../config/db");
const { env } = require("../config/env");
const { ErroNegocio } = require("../middlewares/erros");
const { verificarSenha } = require("../utils/senha");

/**
 * Login do administrador do SISTEMA (dono do produto).
 * @param {{email: string, senha: string}} credenciais
 */
async function loginAdminSistema({ email, senha }) {
  const emailLimpo = (email || "").trim().toLowerCase();
  const resultado = await consultar(
    "SELECT id, nome, email, salt, senha_hash FROM administradores_sistema WHERE email = $1",
    [emailLimpo]
  );
  if (resultado.rowCount === 0) throw new ErroNegocio("Credenciais invalidas.", 401);

  const admin = resultado.rows[0];
  const senhaOk = await verificarSenha(senha || "", admin.salt, admin.senha_hash);
  if (!senhaOk) throw new ErroNegocio("Credenciais invalidas.", 401);

  const token = jwt.sign(
    { tipo: "admin-sistema", adminId: admin.id, email: admin.email },
    env.jwtSegredo,
    { expiresIn: env.jwtExpiracao }
  );
  return { token, admin: { id: admin.id, nome: admin.nome, email: admin.email } };
}

/**
 * Visao geral de todas as lojas com contadores, faturamento e
 * uso de armazenamento estimado em bytes (soma do tamanho real das
 * linhas de cada tabela pertencentes a loja, via pg_column_size).
 */
async function listarLojasComMetricas() {
  const resultado = await consultar(
    `SELECT
       l.id, l.nome, l.codigo, l.ativa, l.criado_em AS "criadoEm",
       a.status AS "assinaturaStatus", a.valida_ate AS "assinaturaValidaAte",
       COALESCE(f.qtd, 0)::int AS "totalFuncionarios",
       COALESCE(p.qtd, 0)::int AS "totalProdutos",
       COALESCE(v.qtd, 0)::int AS "totalVendas",
       COALESCE(v.faturamento, 0)::numeric(14,2) AS "faturamentoTotal",
       (COALESCE(f.bytes, 0) + COALESCE(p.bytes, 0) + COALESCE(v.bytes, 0)
        + COALESCE(vi.bytes, 0))::bigint AS "usoBytes"
     FROM lojas l
     LEFT JOIN assinaturas a ON a.loja_id = l.id
     LEFT JOIN (
       SELECT loja_id, count(*) AS qtd, sum(pg_column_size(funcionarios.*)) AS bytes
       FROM funcionarios GROUP BY loja_id
     ) f ON f.loja_id = l.id
     LEFT JOIN (
       SELECT loja_id, count(*) AS qtd, sum(pg_column_size(produtos.*)) AS bytes
       FROM produtos GROUP BY loja_id
     ) p ON p.loja_id = l.id
     LEFT JOIN (
       SELECT loja_id, count(*) AS qtd, sum(total) AS faturamento,
              sum(pg_column_size(vendas.*)) AS bytes
       FROM vendas GROUP BY loja_id
     ) v ON v.loja_id = l.id
     LEFT JOIN (
       SELECT vd.loja_id, sum(pg_column_size(vi.*)) AS bytes
       FROM venda_itens vi JOIN vendas vd ON vd.id = vi.venda_id
       GROUP BY vd.loja_id
     ) vi ON vi.loja_id = l.id
     ORDER BY l.criado_em DESC`
  );

  return resultado.rows.map((loja) => ({
    ...loja,
    usoGB: Number((Number(loja.usoBytes) / 1024 ** 3).toFixed(6)),
    usoMB: Number((Number(loja.usoBytes) / 1024 ** 2).toFixed(3)),
  }));
}

/**
 * Detalhe de uma loja: metricas + vendas dos ultimos 30 dias por dia.
 * @param {string} lojaId
 */
async function detalharLoja(lojaId) {
  const lojas = await listarLojasComMetricas();
  const loja = lojas.find((l) => l.id === lojaId);
  if (!loja) throw new ErroNegocio("Loja nao encontrada.", 404);

  const vendasPorDia = await consultar(
    `SELECT date_trunc('day', criado_em)::date AS dia,
            count(*)::int AS vendas, sum(total)::numeric(14,2) AS faturamento
     FROM vendas
     WHERE loja_id = $1 AND criado_em >= now() - interval '30 days'
     GROUP BY 1 ORDER BY 1`,
    [lojaId]
  );

  const pagamentos = await consultar(
    `SELECT mp_payment_id AS "mpPaymentId", status, valor, criado_em AS "criadoEm"
     FROM pagamentos WHERE loja_id = $1 ORDER BY criado_em DESC LIMIT 20`,
    [lojaId]
  );

  return { loja, vendasPorDia: vendasPorDia.rows, pagamentos: pagamentos.rows };
}

/**
 * Ativa/desativa uma loja (bloqueia login e uso do PDV).
 * @param {string} lojaId
 * @param {boolean} ativa
 */
async function definirLojaAtiva(lojaId, ativa) {
  const resultado = await consultar(
    "UPDATE lojas SET ativa = $1, atualizado_em = now() WHERE id = $2",
    [Boolean(ativa), lojaId]
  );
  if (resultado.rowCount === 0) throw new ErroNegocio("Loja nao encontrada.", 404);
}

module.exports = {
  loginAdminSistema,
  listarLojasComMetricas,
  detalharLoja,
  definirLojaAtiva,
};
