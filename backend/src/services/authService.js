"use strict";

const jwt = require("jsonwebtoken");
const { consultar } = require("../config/db");
const { env } = require("../config/env");
const { ErroNegocio } = require("../middlewares/erros");
const { gerarSalt, gerarHashSenha, verificarSenha } = require("../utils/senha");

/**
 * Login de funcionario do PDV: codigo da loja + usuario + senha → JWT.
 * @param {{codigoLoja: string, usuario: string, senha: string}} credenciais
 */
async function loginLoja({ codigoLoja, usuario, senha }) {
  const codigo = (codigoLoja || "").trim().toUpperCase();
  const usuarioLimpo = (usuario || "").trim().toLowerCase();

  const resultado = await consultar(
    `SELECT f.id, f.nome, f.cargo, f.salt, f.senha_hash, f.loja_id, l.ativa, l.nome AS loja_nome
     FROM funcionarios f
     JOIN lojas l ON l.id = f.loja_id
     WHERE l.codigo = $1 AND f.usuario = $2`,
    [codigo, usuarioLimpo]
  );

  if (resultado.rowCount === 0)
    throw new ErroNegocio("Usuario ou senha invalidos.", 401);

  const conta = resultado.rows[0];
  if (!conta.ativa) throw new ErroNegocio("Loja desativada. Fale com o suporte.", 403);

  const senhaOk = await verificarSenha(senha || "", conta.salt, conta.senha_hash);
  if (!senhaOk) throw new ErroNegocio("Usuario ou senha invalidos.", 401);

  const token = jwt.sign(
    {
      tipo: "loja",
      lojaId: conta.loja_id,
      funcionarioId: conta.id,
      cargo: conta.cargo,
      nome: conta.nome,
    },
    env.jwtSegredo,
    { expiresIn: env.jwtExpiracao }
  );

  return {
    token,
    funcionario: { id: conta.id, nome: conta.nome, cargo: conta.cargo },
    loja: { id: conta.loja_id, nome: conta.loja_nome },
  };
}

/**
 * Cria funcionario na loja (somente admin da loja, via rota protegida).
 * @param {string} lojaId
 * @param {{nome: string, usuario: string, senha: string, cargo: string}} dados
 */
async function criarFuncionario(lojaId, { nome, usuario, senha, cargo }) {
  const nomeLimpo = (nome || "").trim();
  const usuarioLimpo = (usuario || "").trim().toLowerCase();

  if (nomeLimpo.length < 2) throw new ErroNegocio("Informe o nome do funcionario.");
  if (usuarioLimpo.length < 3)
    throw new ErroNegocio("O usuario deve ter ao menos 3 caracteres.");
  if ((senha || "").length < 4)
    throw new ErroNegocio("A senha deve ter ao menos 4 caracteres.");
  if (!["admin", "operador"].includes(cargo)) throw new ErroNegocio("Cargo invalido.");

  const existente = await consultar(
    "SELECT 1 FROM funcionarios WHERE loja_id = $1 AND usuario = $2",
    [lojaId, usuarioLimpo]
  );
  if (existente.rowCount > 0)
    throw new ErroNegocio("Ja existe um funcionario com esse usuario.");

  const salt = gerarSalt();
  const senhaHash = await gerarHashSenha(senha, salt);

  const criado = await consultar(
    `INSERT INTO funcionarios (loja_id, nome, usuario, salt, senha_hash, cargo)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [lojaId, nomeLimpo, usuarioLimpo, salt, senhaHash, cargo]
  );
  return { id: criado.rows[0].id };
}

/**
 * Lista a equipe da loja (sem hashes).
 * @param {string} lojaId
 */
async function listarFuncionarios(lojaId) {
  const resultado = await consultar(
    `SELECT id, nome, usuario, cargo, criado_em
     FROM funcionarios WHERE loja_id = $1 ORDER BY nome`,
    [lojaId]
  );
  return resultado.rows;
}

module.exports = { loginLoja, criarFuncionario, listarFuncionarios };
