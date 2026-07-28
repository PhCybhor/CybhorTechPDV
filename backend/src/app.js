"use strict";

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const { env } = require("./config/env");
const rotas = require("./routes");
const { tratarErros } = require("./middlewares/erros");

const app = express();

// Atras do nginx na VPS o IP real chega via X-Forwarded-For.
app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "https://sdk.mercadopago.com",
          "https://http2.mlstatic.com",
          "https://*.mlstatic.com",
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://http2.mlstatic.com",
          "https://*.mlstatic.com",
          "https://*.mercadopago.com",
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://http2.mlstatic.com", "data:"],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://http2.mlstatic.com",
          "https://*.mlstatic.com",
          "https://*.mercadopago.com",
          "https://*.mercadolibre.com",
        ],
        connectSrc: [
          "'self'",
          "https://api.mercadopago.com",
          "https://api.mercadolibre.com",
          "https://*.mercadopago.com",
          "https://*.mercadolibre.com",
          "https://http2.mlstatic.com",
          "https://*.mlstatic.com",
        ],
        frameSrc: [
          "'self'",
          "https://*.mercadopago.com",
          "https://*.mercadolibre.com",
          "https://www.mercadolibre.com",
          "https://http2.mlstatic.com",
        ],
        workerSrc: ["'self'", "blob:"],
        childSrc: ["'self'", "blob:", "https://*.mercadopago.com", "https://*.mercadolibre.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  })
);
app.use(
  cors({
    origin:
      env.corsOrigens.length > 0
        ? env.corsOrigens
        : env.emProducao
          ? false
          : true,
  })
);
app.use(express.json({ limit: "200kb" }));

// Limite global generoso; os limites finos ficam nas rotas de login.
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: "Muitas requisicoes. Aguarde um instante." },
  })
);

app.use("/api", rotas);

// Painel do administrador do sistema
app.use("/admin", express.static(path.join(__dirname, "..", "public", "admin")));

// Landing page de venda (site publico)
app.use(express.static(path.join(__dirname, "..", "..", "landing")));

app.use((req, res) => res.status(404).json({ erro: "Rota nao encontrada." }));
app.use(tratarErros);

module.exports = app;
