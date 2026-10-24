import { randomUUID } from 'node:crypto';
import { avaliarAssinatura } from '../assinatura.js';
import { config } from '../config.js';
import * as db from '../db.js';
import { emitirToken } from '../deps.js';
import { ErroNegocio } from '../errors.js';
import {
  compararEmTempoConstante,
  gerarHashSenha,
  gerarSalt,
  validarTamanhoSenha,
  verificarSenha,
} from '../security.js';
import { objetoOuVazio, tamanhoEmCaracteres, texto } from '../utils/valores.js';
import { criarLojaComAdmin, regenerarCodigoLoja } from './lojaService.js';

const BYTES_POR_GB = 1024 ** 3;
const BYTES_POR_MB = 1024 ** 2;
const DIAS_HISTORICO_VENDAS = 30;
const LIMITE_PAGAMENTOS_DETALHE = 20;

// MySQL não expõe o tamanho físico de uma linha (como pg_column_size do PostgreSQL).
// O uso por loja é estimado pelo tamanho dos textos/JSON + uma sobra fixa por linha
// (ids, números e datas); serve para ranking e cobrança por faixa, não para auditoria.
const SOBRA_BYTES_FUNCIONARIO = 100;
const SOBRA_BYTES_PRODUTO = 100;
const SOBRA_BYTES_VENDA = 160;
const SOBRA_BYTES_VENDA_ITEM = 100;
const SOBRA_BYTES_DOCUMENTO = 50;

const SQL_METRICAS_LOJAS = `
  SELECT
    l.id, l.nome, l.codigo, l.ativa, l.criado_em AS criadoEm,
    a.status AS assinaturaStatus, a.valida_ate AS assinaturaValidaAte,
    COALESCE(f.qtd, 0) AS totalFuncionarios,
    COALESCE(p.qtd, 0) AS totalProdutos,
    COALESCE(v.qtd, 0) AS totalVendas,
    COALESCE(v.faturamento, 0) AS faturamentoTotal,
    (COALESCE(f.bytes, 0) + COALESCE(p.bytes, 0) + COALESCE(v.bytes, 0)
     + COALESCE(vi.bytes, 0) + COALESCE(d.bytes, 0)) AS usoBytes
  FROM lojas l
  LEFT JOIN assinaturas a ON a.loja_id = l.id
  LEFT JOIN (
    SELECT loja_id, COUNT(*) AS qtd,
           SUM(OCTET_LENGTH(nome) + OCTET_LENGTH(usuario) + OCTET_LENGTH(salt)
               + OCTET_LENGTH(senha_hash) + OCTET_LENGTH(cargo)
               + JSON_STORAGE_SIZE(dados) + ${SOBRA_BYTES_FUNCIONARIO}) AS bytes
    FROM funcionarios GROUP BY loja_id
  ) f ON f.loja_id = l.id
  LEFT JOIN (
    SELECT loja_id, COUNT(*) AS qtd,
           SUM(OCTET_LENGTH(nome) + OCTET_LENGTH(codigo_barras) + OCTET_LENGTH(categoria)
               + ${SOBRA_BYTES_PRODUTO}) AS bytes
    FROM produtos GROUP BY loja_id
  ) p ON p.loja_id = l.id
  LEFT JOIN (
    SELECT loja_id, COUNT(*) AS qtd, SUM(total) AS faturamento,
           SUM(OCTET_LENGTH(funcionario_nome) + OCTET_LENGTH(forma_pagamento)
               + ${SOBRA_BYTES_VENDA}) AS bytes
    FROM vendas GROUP BY loja_id
  ) v ON v.loja_id = l.id
  LEFT JOIN (
    SELECT vd.loja_id, SUM(OCTET_LENGTH(vi.nome) + ${SOBRA_BYTES_VENDA_ITEM}) AS bytes
    FROM venda_itens vi JOIN vendas vd ON vd.id = vi.venda_id
    GROUP BY vd.loja_id
  ) vi ON vi.loja_id = l.id
  LEFT JOIN (
    SELECT loja_id, SUM(OCTET_LENGTH(recurso) + JSON_STORAGE_SIZE(dados)
                        + ${SOBRA_BYTES_DOCUMENTO}) AS bytes
    FROM documentos_loja GROUP BY loja_id
  ) d ON d.loja_id = l.id`;

export async function loginAdminSistema({ email, senha }) {
  const emailLimpo = texto(email).toLowerCase();
  const linhas = await db.consultar(
    'SELECT id, nome, email, salt, senha_hash FROM administradores_sistema WHERE email = ?',
    [emailLimpo],
  );
  if (linhas.length === 0) throw new ErroNegocio('Credenciais invalidas.', 401);

  const admin = linhas[0];
  if (!(await verificarSenha(senha || '', admin.salt, admin.senha_hash))) {
    throw new ErroNegocio('Credenciais invalidas.', 401);
  }

  const token = emitirToken({
    tipo: 'admin-sistema',
    adminId: String(admin.id),
    email: admin.email,
  });
  return { token, admin: { id: String(admin.id), nome: admin.nome, email: admin.email } };
}

async function metricasLojas(lojaId = null) {
  const filtro = lojaId ? 'WHERE l.id = ?' : '';
  const linhas = await db.consultar(`${SQL_METRICAS_LOJAS} ${filtro} ORDER BY l.criado_em DESC`, lojaId ? [lojaId] : []);

  return linhas.map((loja) => {
    const usoBytes = Number(loja.usoBytes || 0);
    const situacao = avaliarAssinatura(loja.assinaturaStatus, loja.assinaturaValidaAte);
    return {
      ...loja,
      id: String(loja.id),
      totalFuncionarios: Number(loja.totalFuncionarios),
      totalProdutos: Number(loja.totalProdutos),
      totalVendas: Number(loja.totalVendas),
      faturamentoTotal: Number(loja.faturamentoTotal || 0),
      usoBytes,
      usoGB: Number((usoBytes / BYTES_POR_GB).toFixed(6)),
      usoMB: Number((usoBytes / BYTES_POR_MB).toFixed(3)),
      assinaturaValidaAte: loja.assinaturaValidaAte ?? null,
      assinaturaAtrasada: situacao.atrasada,
      assinaturaRotulo: situacao.rotulo,
      assinaturaStatusExibicao: situacao.statusExibicao,
    };
  });
}

/**
 * Cria o admin do sistema ou troca nome/senha se o e-mail já existir.
 * @returns {Promise<{ email: string }>}
 */
export async function criarOuAtualizarAdminSistema({ nome, email, senha }) {
  const nomeLimpo = texto(nome);
  const emailLimpo = texto(email).toLowerCase();
  const senhaValida = validarTamanhoSenha(senha || '');
  if (tamanhoEmCaracteres(nomeLimpo) < 2) throw new ErroNegocio('Informe o nome do administrador.');
  if (!emailLimpo.includes('@')) throw new ErroNegocio('Informe um e-mail valido.');

  const salt = gerarSalt();
  const senhaHash = await gerarHashSenha(senhaValida, salt);
  await db.executar(
    `INSERT INTO administradores_sistema (id, nome, email, salt, senha_hash)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       nome = VALUES(nome),
       salt = VALUES(salt),
       senha_hash = VALUES(senha_hash)`,
    [randomUUID(), nomeLimpo, emailLimpo, salt, senhaHash],
  );
  return { email: emailLimpo };
}

/** Primeiro admin, ou reset se ADMIN_BOOTSTRAP_SECRET bater. */
export async function bootstrapAdminSistema({ nome, email, senha, secret = '' }) {
  const segredo = config.adminBootstrapSecret.trim();
  const existentes = await db.consultar('SELECT 1 FROM administradores_sistema LIMIT 1');
  const autorizado = Boolean(segredo) && compararEmTempoConstante(segredo, String(secret || ''));
  if (existentes.length > 0 && !autorizado) {
    throw new ErroNegocio('Bootstrap indisponivel: ja existe administrador.', 409);
  }
  return criarOuAtualizarAdminSistema({ nome, email, senha });
}

export function listarLojasComMetricas() {
  return metricasLojas();
}

export async function detalharLoja(lojaId) {
  const metricas = await metricasLojas(lojaId);
  if (metricas.length === 0) throw new ErroNegocio('Loja nao encontrada.', 404);

  const vendasPorDia = await db.consultar(
    `SELECT DATE(criado_em) AS dia, COUNT(*) AS vendas, SUM(total) AS faturamento
     FROM vendas
     WHERE loja_id = ? AND criado_em >= DATE_SUB(NOW(3), INTERVAL ${DIAS_HISTORICO_VENDAS} DAY)
     GROUP BY DATE(criado_em) ORDER BY DATE(criado_em)`,
    [lojaId],
  );

  const pagamentos = await db.consultar(
    `SELECT mp_payment_id AS mpPaymentId, status, valor, criado_em AS criadoEm
     FROM pagamentos WHERE loja_id = ? ORDER BY criado_em DESC LIMIT ${LIMITE_PAGAMENTOS_DETALHE}`,
    [lojaId],
  );

  return {
    loja: metricas[0],
    vendasPorDia: vendasPorDia.map((dia) => ({
      dia: dia.dia,
      vendas: Number(dia.vendas),
      faturamento: Number(dia.faturamento || 0),
    })),
    pagamentos: pagamentos.map((pagamento) => ({
      ...pagamento,
      valor: pagamento.valor === null ? null : Number(pagamento.valor),
    })),
  };
}

export async function definirLojaAtiva(lojaId, ativa) {
  const afetadas = await db.executar(
    'UPDATE lojas SET ativa = ?, atualizado_em = NOW(3) WHERE id = ?',
    [Boolean(ativa), lojaId],
  );
  if (afetadas === 0) throw new ErroNegocio('Loja nao encontrada.', 404);
}

/** Provisiona loja + admin já ativos, com chave de conexão pronta. */
export async function criarContaLoja({ loja, admin }) {
  const criada = await criarLojaComAdmin({ loja, admin, aguardarPagamento: false });
  return {
    lojaId: criada.lojaId,
    codigo: criada.codigo,
    nomeLoja: texto(objetoOuVazio(loja).nome),
    usuario: texto(objetoOuVazio(admin).usuario).toLowerCase(),
  };
}

export function regenerarChaveLoja(lojaId) {
  return regenerarCodigoLoja(lojaId);
}
