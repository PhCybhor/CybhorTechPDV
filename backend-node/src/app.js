import { existsSync, statSync } from "node:fs";
import path from "node:path";
import express from "express";
import { config, PASTA_BACKEND } from "./config.js";
import { cabecalhosSeguranca, criarCors, limitarTamanhoRequisicao, TAMANHO_MAX_REQUISICAO } from "./middlewares/segurancaHttp.js";
import { rotaNaoEncontrada, tratarErros } from "./middlewares/tratamentoErros.js";
import { criarRotasApi } from "./rotas/api.js";

// Pasta própria (deploy isolado na hospedagem) ou a do monorepo (desenvolvimento).
const CANDIDATOS_ADMIN = [path.join(PASTA_BACKEND, "public", "admin"), path.join(PASTA_BACKEND, "..", "backend", "public", "admin")];
const CANDIDATOS_LANDING = [path.join(PASTA_BACKEND, "landing"), path.join(PASTA_BACKEND, "..", "landing")];

function primeiraPastaExistente(candidatos) {
  return candidatos.find((pasta) => existsSync(pasta) && statSync(pasta).isDirectory()) || null;
}

/**
 * Monta o app Express: segurança, CORS, API em /api, painel /admin e site em /.
 * @returns {import("express").Express}
 */
export function criarApp() {
  const app = express();
  app.disable("x-powered-by");
  // Quantos proxies reversos à frente da API (Hostinger/nginx) para o req.ip
  // ser o do cliente e não o do proxy; o primeiro hop do X-Forwarded-For é forjável.
  app.set("trust proxy", config.proxiesConfiaveis);

  app.use(cabecalhosSeguranca);
  app.use(criarCors());
  app.use(limitarTamanhoRequisicao);
  app.use(express.json({ limit: TAMANHO_MAX_REQUISICAO }));

  app.use("/api", criarRotasApi());
  app.use("/api", rotaNaoEncontrada);

  const pastaAdmin = primeiraPastaExistente(CANDIDATOS_ADMIN);
  if (pastaAdmin) app.use("/admin", express.static(pastaAdmin, { dotfiles: "ignore" }));
  const pastaLanding = primeiraPastaExistente(CANDIDATOS_LANDING);
  if (pastaLanding) app.use(express.static(pastaLanding, { dotfiles: "ignore" }));

  app.use(rotaNaoEncontrada);
  app.use(tratarErros);
  return app;
}
