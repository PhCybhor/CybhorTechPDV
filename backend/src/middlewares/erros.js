"use strict";

/**
 * Erro de negocio: mensagem segura para mostrar ao cliente.
 */
class ErroNegocio extends Error {
  /**
   * @param {string} mensagem
   * @param {number} [status]
   */
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.status = status;
  }
}

/**
 * Handler final: loga o erro completo no servidor e devolve mensagem
 * amigavel — nunca stack trace — para o cliente.
 */
// eslint-disable-next-line no-unused-vars
function tratarErros(erro, req, res, next) {
  if (erro instanceof ErroNegocio) {
    return res.status(erro.status).json({ erro: erro.message });
  }

  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, erro);
  res.status(500).json({ erro: "Erro interno. Tente novamente em instantes." });
}

module.exports = { ErroNegocio, tratarErros };
