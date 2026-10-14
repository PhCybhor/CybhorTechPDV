import { randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import * as db from "../db.js";
import { ErroNegocio } from "../erros.js";
import { avaliarAssinatura } from "../regras/assinatura.js";
import { lerTextoLimpo } from "../regras/entrada.js";
import { gerarHashSenha, gerarSalt, validarTamanhoSenha, verificarSenha } from "../seguranca/senha.js";
import { emitirToken } from "../seguranca/token.js";
import { criarLojaComAdmin, regenerarCodigoLoja } from "./lojaServico.js";

const BYTES_POR_MB = 1024 ** 2;
const BYTES_POR_GB = 1024 ** 3;

// MySQL não tem pg_column_size: estima o uso somando os bytes das colunas variáveis
// mais um custo fixo por linha (ids, números e datas). Serve para comparar lojas.
const BYTES_FIXOS_POR_LINHA = 64;
const SQL_METRICAS_LOJAS = `
  SELECT
    l.id, l.nome, l.codigo, l.ativa, l.criado_em AS criadoEm,
    a.status AS assinaturaStatus, a.valida_ate AS assinaturaValidaAte,
    COALESCE(f.qtd, 0) AS totalFuncionarios,
    COALESCE(p.qtd, 0) AS totalProdutos,
    COALESCE(v.qtd, 0) AS totalVendas,
    COALESCE(v.faturamento, 0) AS faturamentoTotal,
    COALESCE(f.bytes, 0) + COALESCE(p.bytes, 0) + COALESCE(v.bytes, 0) + COALESCE(vi.bytes, 0) AS usoBytes
  FROM lojas l
  LEFT JOIN assinaturas a ON a.loja_id = l.id
  LEFT JOIN (
    SELECT loja_id, COUNT(*) AS qtd,
           SUM(${BYTES_FIXOS_POR_LINHA} + OCTET_LENGTH(nome) + OCTET_LENGTH(usuario) + OCTET_LENGTH(salt)
               + OCTET_LENGTH(senha_hash) + OCTET_LENGTH(cargo) + OCTET_LENGTH(dados)) AS bytes
    FROM funcionarios GROUP BY loja_id
  ) f ON f.loja_id = l.id
  LEFT JOIN (
    SELECT loja_id, COUNT(*) AS qtd,
           SUM(${BYTES_FIXOS_POR_LINHA} + OCTET_LENGTH(nome) + OCTET_LENGTH(codigo_barras) + OCTET_LENGTH(categoria)) AS bytes
    FROM produtos GROUP BY loja_id
  ) p ON p.loja_id = l.id
  LEFT JOIN (
    SELECT loja_id, COUNT(*) AS qtd, SUM(total) AS faturamento,
           SUM(${BYTES_FIXOS_POR_LINHA} + OCTET_LENGTH(funcionario_nome) + OCTET_LENGTH(forma_pagamento)) AS bytes
    FROM vendas GROUP BY loja_id
  ) v ON v.loja_id = l.id
  LEFT JOIN (
    SELECT vd.loja_id, SUM(${BYTES_FIXOS_POR_LINHA} + OCTET_LENGTH(vi.nome)) AS bytes
    FROM venda_itens vi JOIN vendas vd ON vd.id = vi.venda_id
    GROUP BY vd.loja_id
  ) vi ON vi.loja_id = l.id`;

/**
 * Login do dono do sistema (painel /admin).
 * @returns {Promise<{ token: string, admin: object }>}
 */
export async function loginAdminSistema({ email, senha }) {
  const emailLimpo = lerTextoLimpo(email).toLowerCase();
  const [admin] = await db.consultar(
    "SELECT id, nome, email, salt, senha_hash FROM administradores_sistema WHERE email = ?",
    [emailLimpo],
  );
  if (!admin) throw new ErroNegocio("Credenciais invalidas.", 401);
  if (!(await verificarSenha(typeof senha === "string" ? senha : "", admin.salt, admin.senha_hash))) {
    throw new ErroNegocio("Credenciais invalidas.", 401);
  }

  const token = emitirToken({ tipo: "admin-sistema", adminId: admin.id, email: admin.email });
  return { token, admin: { id: admin.id, nome: admin.nome, email: admin.email } };
}

async function metricasLojas(lojaId = null) {
  const linhas = lojaId
    ? await db.consultar(`${SQL_METRICAS_LOJAS} WHERE l.id = ? ORDER BY l.criado_em DESC`, [lojaId])
    : await db.consultar(`${SQL_METRICAS_LOJAS} ORDER BY l.criado_em DESC`);

  return linhas.map((loja) => {
    const usoBytes = Number(loja.usoBytes || 0);
    const situacao = avaliarAssinatura(loja.assinaturaStatus, loja.assinaturaValidaAte);
    return {
      ...loja,
      ativa: Boolean(loja.ativa),
      totalFuncionarios: Number(loja.totalFuncionarios),
      totalProdutos: Number(loja.totalProdutos),
      totalVendas: Number(loja.totalVendas),
      faturamentoTotal: Number(loja.faturamentoTotal || 0),
      usoBytes,
      usoGB: Number((usoBytes / BYTES_POR_GB).toFixed(6)),
      usoMB: Number((usoBytes / BYTES_POR_MB).toFixed(3)),
      assinaturaAtrasada: situacao.atrasada,
      assinaturaRotulo: situacao.rotulo,
      assinaturaStatusExibicao: situacao.statusExibicao,
    };
  });
}

/**
 * Cria o admin do sistema ou atualiza nome/senha se o e-mail já existir.
 * @returns {Promise<{ email: string }>}
 */
export async function criarOuAtualizarAdminSistema({ nome, email, senha }) {
  const nomeLimpo = lerTextoLimpo(nome);
  const emailLimpo = lerTextoLimpo(email).toLowerCase();
  const senhaValida = validarTamanhoSenha(senha || "");
  if (nomeLimpo.length < 2) throw new ErroNegocio("Informe o nome do administrador.");
  if (!emailLimpo.includes("@")) throw new ErroNegocio("Informe um e-mail valido.");

  const salt = gerarSalt();
  const senhaHash = await gerarHashSenha(senhaValida, salt);
  await db.executar(
    `INSERT INTO administradores_sistema (id, nome, email, salt, senha_hash) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE nome = VALUES(nome), salt = VALUES(salt), senha_hash = VALUES(senha_hash)`,
    [randomUUID(), nomeLimpo, emailLimpo, salt, senhaHash],
  );
  return { email: emailLimpo };
}

function segredoBootstrapConfere(recebido) {
  const segredo = config.adminBootstrapSecret.trim();
  if (!segredo || typeof recebido !== "string") return false;
  const bufferRecebido = Buffer.from(recebido, "utf8");
  const bufferSegredo = Buffer.from(segredo, "utf8");
  return bufferRecebido.length === bufferSegredo.length && timingSafeEqual(bufferRecebido, bufferSegredo);
}

/** Primeiro admin, ou reset se ADMIN_BOOTSTRAP_SECRET bater. */
export async function bootstrapAdminSistema({ nome, email, senha, segredo = "" }) {
  const existentes = await db.consultar("SELECT 1 FROM administradores_sistema LIMIT 1");
  if (existentes.length && !segredoBootstrapConfere(segredo)) {
    throw new ErroNegocio("Bootstrap indisponivel: ja existe administrador.", 409);
  }
  return criarOuAtualizarAdminSistema({ nome, email, senha });
}

export function listarLojasComMetricas() {
  return metricasLojas();
}

/** Métricas da loja, vendas por dia (30 dias) e últimos 20 pagamentos. */
export async function detalharLoja(lojaId) {
  const [loja] = await metricasLojas(lojaId);
  if (!loja) throw new ErroNegocio("Loja nao encontrada.", 404);

  const vendasPorDia = await db.consultar(
    `SELECT DATE(criado_em) AS dia, COUNT(*) AS vendas, SUM(total) AS faturamento
     FROM vendas
     WHERE loja_id = ? AND criado_em >= CURRENT_TIMESTAMP(3) - INTERVAL 30 DAY
     GROUP BY DATE(criado_em) ORDER BY dia`,
    [lojaId],
  );
  const pagamentos = await db.consultar(
    `SELECT mp_payment_id AS mpPaymentId, status, valor, criado_em AS criadoEm
     FROM pagamentos WHERE loja_id = ? ORDER BY criado_em DESC LIMIT 20`,
    [lojaId],
  );

  return {
    loja,
    vendasPorDia: vendasPorDia.map((dia) => ({
      dia: dia.dia,
      vendas: Number(dia.vendas),
      faturamento: Number(dia.faturamento || 0),
    })),
    pagamentos,
  };
}

/** @throws {ErroNegocio} 404 se a loja não existir. */
export async function definirLojaAtiva(lojaId, ativa) {
  const afetadas = await db.executar("UPDATE lojas SET ativa = ?, atualizado_em = CURRENT_TIMESTAMP(3) WHERE id = ?", [
    Boolean(ativa),
    lojaId,
  ]);
  if (afetadas === 0) throw new ErroNegocio("Loja nao encontrada.", 404);
}

/** Provisiona loja + admin já ativos, com chave de conexão pronta. */
export async function criarContaLoja({ loja, admin }) {
  const criada = await criarLojaComAdmin({ loja, admin, aguardarPagamento: false });
  return {
    lojaId: criada.lojaId,
    codigo: criada.codigo,
    nomeLoja: lerTextoLimpo(loja.nome),
    usuario: lerTextoLimpo(admin.usuario).toLowerCase(),
  };
}

export function regenerarChaveLoja(lojaId) {
  return regenerarCodigoLoja(lojaId);
}
