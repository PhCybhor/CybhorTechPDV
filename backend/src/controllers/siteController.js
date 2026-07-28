"use strict";

const siteService = require("../services/siteService");

async function comprar(req, res, next) {
  try {
    const { loja, admin } = req.body || {};
    const resultado = await siteService.comprarPeloSite({ loja, admin });
    res.status(201).json({ tokenAtivacao: resultado.tokenAtivacao });
  } catch (erro) {
    next(erro);
  }
}

async function pagamento(req, res, next) {
  try {
    res.json(await siteService.obterDadosPagamento(req.query.token));
  } catch (erro) {
    next(erro);
  }
}

async function pagar(req, res, next) {
  try {
    const { tokenAtivacao, formData } = req.body || {};
    res.json(await siteService.processarPagamentoSite(tokenAtivacao, formData));
  } catch (erro) {
    next(erro);
  }
}

async function ativacao(req, res, next) {
  try {
    res.json(await siteService.consultarAtivacao(req.query.token));
  } catch (erro) {
    next(erro);
  }
}

module.exports = { comprar, pagamento, pagar, ativacao };
