"use strict";

const lojaService = require("../services/lojaService");

async function criar(req, res, next) {
  try {
    const criada = await lojaService.criarLojaComAdmin(req.body || {});
    res.status(201).json(criada);
  } catch (erro) {
    next(erro);
  }
}

async function conectar(req, res, next) {
  try {
    res.json(await lojaService.buscarLojaPorCodigo(req.body?.codigo));
  } catch (erro) {
    next(erro);
  }
}

async function perfil(req, res, next) {
  try {
    res.json(await lojaService.obterPerfil(req.auth.lojaId));
  } catch (erro) {
    next(erro);
  }
}

module.exports = { criar, conectar, perfil };
