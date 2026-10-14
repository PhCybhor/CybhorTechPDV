import { ErroNegocio } from "../erros.js";
import { logger } from "../logger.js";

// Erros do MySQL que são culpa da entrada (campo longo demais, CHECK violado), não do servidor.
const ERROS_BANCO_DE_ENTRADA = new Set([
  "ER_DATA_TOO_LONG",
  "ER_CHECK_CONSTRAINT_VIOLATED",
  "ER_CONSTRAINT_FAILED",
  "ER_TRUNCATED_WRONG_VALUE",
  "ER_WARN_DATA_OUT_OF_RANGE",
]);

/** Rota inexistente em /api (o site estático já respondeu antes, se existir). */
export function rotaNaoEncontrada(_req, res) {
  res.status(404).json({ erro: "Not Found" });
}

/**
 * Converte qualquer erro em {"erro": "..."} sem stack trace para o cliente.
 * Erros inesperados são registrados no log do servidor.
 * O Express só reconhece o handler de erro pela assinatura de 4 parâmetros.
 */
export function tratarErros(erro, req, res, _next) {
  if (erro instanceof ErroNegocio) return res.status(erro.status).json({ erro: erro.message });

  if (erro?.type === "entity.too.large") return res.status(413).json({ erro: "Requisicao grande demais." });
  if (erro?.type === "entity.parse.failed" || erro?.type === "encoding.unsupported" || erro?.type === "charset.unsupported") {
    return res.status(422).json({ erro: "Dados invalidos." });
  }
  if (ERROS_BANCO_DE_ENTRADA.has(erro?.code)) {
    return res.status(400).json({ erro: "Algum campo excede o tamanho ou formato permitido." });
  }

  logger.erro("erro_interno", erro, { metodo: req.method, caminho: req.path });
  if (res.headersSent) return res.end();
  return res.status(500).json({ erro: "Erro interno. Tente novamente em instantes." });
}
