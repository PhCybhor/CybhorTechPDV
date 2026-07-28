"use strict";

const produtoService = require("../services/produtoService");

async function listar(req, res, next) {
  try {
    res.json(await produtoService.listar(req.auth.lojaId));
  } catch (erro) {
    next(erro);
  }
}

async function criar(req, res, next) {
  try {
    const criado = await produtoService.criar(req.auth.lojaId, req.body || {});
    res.status(201).json(criado);
  } catch (erro) {
    next(erro);
  }
}

async function atualizar(req, res, next) {
  try {
    await produtoService.atualizar(req.auth.lojaId, req.params.id, req.body || {});
    res.status(204).end();
  } catch (erro) {
    next(erro);
  }
}

async function remover(req, res, next) {
  try {
    await produtoService.remover(req.auth.lojaId, req.params.id);
    res.status(204).end();
  } catch (erro) {
    next(erro);
  }
}

module.exports = { listar, criar, atualizar, remover };
