"use strict";

const authService = require("../services/authService");

async function login(req, res, next) {
  try {
    const sessao = await authService.loginLoja(req.body || {});
    res.json(sessao);
  } catch (erro) {
    next(erro);
  }
}

async function criarFuncionario(req, res, next) {
  try {
    const criado = await authService.criarFuncionario(req.auth.lojaId, req.body || {});
    res.status(201).json(criado);
  } catch (erro) {
    next(erro);
  }
}

async function listarFuncionarios(req, res, next) {
  try {
    res.json(await authService.listarFuncionarios(req.auth.lojaId));
  } catch (erro) {
    next(erro);
  }
}

module.exports = { login, criarFuncionario, listarFuncionarios };
