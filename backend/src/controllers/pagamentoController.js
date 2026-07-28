"use strict";

const pagamentoService = require("../services/pagamentoService");

async function criarCheckout(req, res, next) {
  try {
    res.json(await pagamentoService.criarCheckoutAssinatura(req.auth.lojaId));
  } catch (erro) {
    next(erro);
  }
}

async function webhook(req, res, next) {
  try {
    await pagamentoService.processarWebhook(req.body || {});
    // O MP reenvia a notificacao se nao receber 200 rapidamente.
    res.status(200).json({ ok: true });
  } catch (erro) {
    next(erro);
  }
}

async function assinatura(req, res, next) {
  try {
    res.json(await pagamentoService.obterAssinatura(req.auth.lojaId));
  } catch (erro) {
    next(erro);
  }
}

module.exports = { criarCheckout, webhook, assinatura };
