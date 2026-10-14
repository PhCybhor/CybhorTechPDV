import { rateLimit } from "express-rate-limit";

const MINUTO_MS = 60 * 1000;

/**
 * Limitador por IP (req.ip, resolvido pelo `trust proxy`) com resposta no formato da API.
 * Cada rota cria o seu, como o slowapi fazia (contadores independentes).
 * @param {number} limite requisições permitidas na janela.
 * @param {number} janelaMs tamanho da janela em milissegundos.
 */
export function criarLimitador(limite, janelaMs) {
  return rateLimit({
    windowMs: janelaMs,
    limit: limite,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler(_req, res) {
      res.status(429).json({ erro: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
    },
  });
}

export const limites = {
  vintePor15Min: () => criarLimitador(20, 15 * MINUTO_MS),
  dezPor15Min: () => criarLimitador(10, 15 * MINUTO_MS),
  cincoPor15Min: () => criarLimitador(5, 15 * MINUTO_MS),
  trintaPorHora: () => criarLimitador(30, 60 * MINUTO_MS),
  sessentaPorMinuto: () => criarLimitador(60, MINUTO_MS),
};
