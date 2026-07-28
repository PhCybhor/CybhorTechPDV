"use strict";

const adminService = require("../services/adminService");

async function login(req, res, next) {
  try {
    res.json(await adminService.loginAdminSistema(req.body || {}));
  } catch (erro) {
    next(erro);
  }
}

async function listarLojas(req, res, next) {
  try {
    res.json(await adminService.listarLojasComMetricas());
  } catch (erro) {
    next(erro);
  }
}

async function detalharLoja(req, res, next) {
  try {
    res.json(await adminService.detalharLoja(req.params.id));
  } catch (erro) {
    next(erro);
  }
}

async function definirAtiva(req, res, next) {
  try {
    await adminService.definirLojaAtiva(req.params.id, req.body?.ativa);
    res.status(204).end();
  } catch (erro) {
    next(erro);
  }
}

module.exports = { login, listarLojas, detalharLoja, definirAtiva };
