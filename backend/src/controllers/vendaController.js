"use strict";

const vendaService = require("../services/vendaService");

async function registrar(req, res, next) {
  try {
    const funcionario = { id: req.auth.funcionarioId, nome: req.auth.nome };
    const venda = await vendaService.registrarVenda(
      req.auth.lojaId,
      funcionario,
      req.body || {}
    );
    res.status(201).json(venda);
  } catch (erro) {
    next(erro);
  }
}

async function listar(req, res, next) {
  try {
    res.json(
      await vendaService.listarVendas(req.auth.lojaId, { limite: req.query.limite })
    );
  } catch (erro) {
    next(erro);
  }
}

module.exports = { registrar, listar };
