import * as db from "../db.js";
import { ErroNegocio } from "../erros.js";
import { avaliarAssinatura } from "../regras/assinatura.js";
import { decodificarToken } from "../seguranca/token.js";

const MENSAGEM_SESSAO_INVALIDA = "Sessao invalida ou expirada.";

function extrairBearer(req) {
  const cabecalho = req.get("authorization");
  if (!cabecalho) throw new ErroNegocio("Token ausente.", 401);
  const separador = cabecalho.indexOf(" ");
  const esquema = separador === -1 ? cabecalho : cabecalho.slice(0, separador);
  const token = separador === -1 ? "" : cabecalho.slice(separador + 1);
  if (esquema !== "Bearer" || !token) throw new ErroNegocio("Token ausente.", 401);
  return token;
}

function decodificarOuFalhar(req, tipoEsperado) {
  const conteudo = decodificarToken(extrairBearer(req));
  if (!conteudo || conteudo.tipo !== tipoEsperado) throw new ErroNegocio(MENSAGEM_SESSAO_INVALIDA, 401);
  return conteudo;
}

/**
 * Valida o JWT da loja e confere no banco: funcionário existe, loja ativa e
 * assinatura não bloqueada. Preenche `req.auth` = { lojaId, funcionarioId, cargo, nome }.
 */
export async function autenticarLoja(req, _res, next) {
  const conteudo = decodificarOuFalhar(req, "loja");
  if (!conteudo.lojaId || !conteudo.funcionarioId) throw new ErroNegocio(MENSAGEM_SESSAO_INVALIDA, 401);

  const [conta] = await db.consultar(
    `SELECT f.id, f.nome, f.cargo, l.id AS loja_id, l.ativa, a.status AS assinatura_status, a.valida_ate
     FROM funcionarios f
     JOIN lojas l ON l.id = f.loja_id
     LEFT JOIN assinaturas a ON a.loja_id = l.id
     WHERE f.id = ? AND l.id = ?`,
    [String(conteudo.funcionarioId), String(conteudo.lojaId)],
  );
  if (!conta) throw new ErroNegocio(MENSAGEM_SESSAO_INVALIDA, 401);
  if (!conta.ativa) throw new ErroNegocio("Loja desativada.", 403);

  // Atraso/inadimplente/vencida: libera com aviso. Bloqueia só pendente/cancelada/ausente.
  const situacao = avaliarAssinatura(conta.assinatura_status, conta.valida_ate);
  if (situacao.bloqueada) throw new ErroNegocio(situacao.mensagem, 403);

  req.auth = { lojaId: conta.loja_id, funcionarioId: conta.id, cargo: String(conta.cargo), nome: String(conta.nome || "") };
  next();
}

/** Depois de `autenticarLoja`: só o administrador da loja passa. */
export function exigirAdminLoja(req, _res, next) {
  if (req.auth?.cargo !== "admin") throw new ErroNegocio("Apenas o administrador da loja pode fazer isso.", 403);
  next();
}

/** Valida o JWT do dono do sistema. Preenche `req.adminSistema` = { id, email }. */
export async function autenticarAdminSistema(req, _res, next) {
  const conteudo = decodificarOuFalhar(req, "admin-sistema");
  if (!conteudo.adminId) throw new ErroNegocio(MENSAGEM_SESSAO_INVALIDA, 401);

  const [admin] = await db.consultar("SELECT id, email FROM administradores_sistema WHERE id = ?", [
    String(conteudo.adminId),
  ]);
  if (!admin) throw new ErroNegocio(MENSAGEM_SESSAO_INVALIDA, 401);
  req.adminSistema = { id: admin.id, email: admin.email };
  next();
}
