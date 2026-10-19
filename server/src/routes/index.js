import { Router } from 'express';
import * as db from '../db.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { criarRotasAdmin } from './admin.js';
import { criarRotasAuth } from './auth.js';
import { criarRotasDados } from './dados.js';
import { criarRotasLojas } from './lojas.js';
import { criarRotasPagamentos } from './pagamentos.js';
import { criarRotasProdutos } from './produtos.js';
import { criarRotasSite } from './site.js';
import { criarRotasVendas } from './vendas.js';

/** Todas as rotas da API; o app as monta sob /api. */
export function criarRotasApi() {
  const api = Router();

  // Liveness + ping barato no MySQL. Sem detalhes internos no corpo.
  api.get(
    '/saude',
    asyncHandler(async (_req, res) => {
      const dbOk = await db.ping();
      res.status(dbOk ? 200 : 503).json({ ok: dbOk, db: dbOk });
    }),
  );

  api.use(criarRotasSite());
  api.use(criarRotasLojas());
  api.use(criarRotasAuth());
  api.use(criarRotasProdutos());
  api.use(criarRotasVendas());
  api.use(criarRotasDados());
  api.use(criarRotasPagamentos());
  api.use(criarRotasAdmin());

  return api;
}
