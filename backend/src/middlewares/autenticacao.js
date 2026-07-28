"use strict";

const jwt = require("jsonwebtoken");
const { env } = require("../config/env");

/**
 * Autentica requisicoes do PDV (token de funcionario, escopo = loja).
 */
function autenticarLoja(req, res, next) {
  const token = extrairToken(req);
  if (!token) return res.status(401).json({ erro: "Token ausente." });

  try {
    const payload = jwt.verify(token, env.jwtSegredo);
    if (payload.tipo !== "loja") throw new Error("tipo invalido");
    req.auth = {
      lojaId: payload.lojaId,
      funcionarioId: payload.funcionarioId,
      cargo: payload.cargo,
      nome: payload.nome,
    };
    next();
  } catch {
    res.status(401).json({ erro: "Sessao invalida ou expirada." });
  }
}

/**
 * Exige cargo admin da loja (gestao de produtos/equipe).
 */
function exigirAdminLoja(req, res, next) {
  if (req.auth?.cargo !== "admin") {
    return res.status(403).json({ erro: "Apenas o administrador da loja pode fazer isso." });
  }
  next();
}

/**
 * Autentica o administrador do SISTEMA (dono do produto).
 * So ele acessa o painel de controle das lojas.
 */
function autenticarAdminSistema(req, res, next) {
  const token = extrairToken(req);
  if (!token) return res.status(401).json({ erro: "Token ausente." });

  try {
    const payload = jwt.verify(token, env.jwtSegredo);
    if (payload.tipo !== "admin-sistema") throw new Error("tipo invalido");
    req.adminSistema = { id: payload.adminId, email: payload.email };
    next();
  } catch {
    res.status(401).json({ erro: "Sessao invalida ou expirada." });
  }
}

/**
 * @param {import("express").Request} req
 * @returns {string | null}
 */
function extrairToken(req) {
  const cabecalho = req.headers.authorization || "";
  const [esquema, token] = cabecalho.split(" ");
  return esquema === "Bearer" && token ? token : null;
}

module.exports = { autenticarLoja, exigirAdminLoja, autenticarAdminSistema };
