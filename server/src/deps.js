import jwt from 'jsonwebtoken';
import { avaliarAssinatura } from './assinatura.js';
import { config } from './config.js';
import * as db from './db.js';
import { ErroNegocio } from './errors.js';
import { asyncHandler } from './utils/asyncHandler.js';

const MENSAGEM_SESSAO_INVALIDA = 'Sessao invalida ou expirada.';

/**
 * Assina um JWT HS256 com iat/exp.
 * @param {Record<string, any>} payload claims do token (tipo, lojaId, ...).
 * @returns {string}
 */
export function emitirToken(payload) {
  return jwt.sign(payload, config.jwtSegredo, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiracaoSegundos,
  });
}

function extrairBearer(authorization) {
  if (!authorization) throw new ErroNegocio('Token ausente.', 401);
  const indice = authorization.indexOf(' ');
  const esquema = indice === -1 ? authorization : authorization.slice(0, indice);
  const token = indice === -1 ? '' : authorization.slice(indice + 1);
  if (esquema !== 'Bearer' || !token) throw new ErroNegocio('Token ausente.', 401);
  return token;
}

function decodificar(token) {
  try {
    return jwt.verify(token, config.jwtSegredo, { algorithms: ['HS256'] });
  } catch {
    throw new ErroNegocio(MENSAGEM_SESSAO_INVALIDA, 401);
  }
}

/**
 * Autentica o funcionário da loja. Revalida no banco a cada requisição para que
 * loja desativada ou assinatura bloqueada derrube sessões já emitidas.
 * Preenche `req.authLoja = { lojaId, funcionarioId, cargo, nome }`.
 */
export const autenticarLoja = asyncHandler(async (req, _res, next) => {
  const payload = decodificar(extrairBearer(req.headers.authorization));
  const { tipo, lojaId, funcionarioId } = payload;
  if (tipo !== 'loja' || !lojaId || !funcionarioId) {
    throw new ErroNegocio(MENSAGEM_SESSAO_INVALIDA, 401);
  }

  const linhas = await db.consultar(
    `SELECT f.id, f.nome, f.cargo, l.id AS loja_id, l.ativa,
            a.status AS assinatura_status, a.valida_ate
     FROM funcionarios f
     JOIN lojas l ON l.id = f.loja_id
     LEFT JOIN assinaturas a ON a.loja_id = l.id
     WHERE f.id = ? AND l.id = ?`,
    [String(funcionarioId), String(lojaId)],
  );
  if (linhas.length === 0) throw new ErroNegocio(MENSAGEM_SESSAO_INVALIDA, 401);

  const conta = linhas[0];
  if (!conta.ativa) throw new ErroNegocio('Loja desativada.', 403);

  // Atraso/inadimplente/vencida: libera com aviso (banner na loja + selo no admin).
  // Bloqueia só pendente/cancelada/ausente.
  const situacao = avaliarAssinatura(conta.assinatura_status, conta.valida_ate);
  if (situacao.bloqueada) throw new ErroNegocio(situacao.mensagem, 403);

  req.authLoja = {
    lojaId: String(conta.loja_id),
    funcionarioId: String(conta.id),
    cargo: String(conta.cargo),
    nome: String(conta.nome || ''),
  };
  next();
});

/** Exige que o funcionário autenticado seja admin da loja. Use após autenticarLoja. */
export function exigirAdminLoja(req, _res, next) {
  if (req.authLoja?.cargo !== 'admin') {
    next(new ErroNegocio('Apenas o administrador da loja pode fazer isso.', 403));
    return;
  }
  next();
}

/** Autentica o administrador do SISTEMA. Preenche `req.authAdmin = { id, email }`. */
export const autenticarAdminSistema = asyncHandler(async (req, _res, next) => {
  const payload = decodificar(extrairBearer(req.headers.authorization));
  if (payload.tipo !== 'admin-sistema' || !payload.adminId) {
    throw new ErroNegocio(MENSAGEM_SESSAO_INVALIDA, 401);
  }
  const linhas = await db.consultar(
    'SELECT id, email FROM administradores_sistema WHERE id = ?',
    [String(payload.adminId)],
  );
  if (linhas.length === 0) throw new ErroNegocio(MENSAGEM_SESSAO_INVALIDA, 401);

  req.authAdmin = { id: String(linhas[0].id), email: String(linhas[0].email) };
  next();
});
