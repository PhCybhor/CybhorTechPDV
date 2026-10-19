import { Router } from 'express';
import { autenticarLoja, exigirAdminLoja } from '../deps.js';
import * as produtoService from '../services/produtoService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { corpoDe, exigirCorpoObjeto } from './guardas.js';

export function criarRotasProdutos() {
  const rotas = Router();

  rotas.get(
    '/produtos',
    autenticarLoja,
    asyncHandler(async (req, res) => {
      res.json(await produtoService.listar(req.authLoja.lojaId));
    }),
  );

  rotas.post(
    '/produtos',
    autenticarLoja,
    exigirAdminLoja,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      res.status(201).json(await produtoService.criar(req.authLoja.lojaId, corpoDe(req)));
    }),
  );

  rotas.put(
    '/produtos/:produtoId',
    autenticarLoja,
    exigirAdminLoja,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      await produtoService.atualizar(req.authLoja.lojaId, req.params.produtoId, corpoDe(req));
      res.status(204).end();
    }),
  );

  rotas.delete(
    '/produtos/:produtoId',
    autenticarLoja,
    exigirAdminLoja,
    asyncHandler(async (req, res) => {
      await produtoService.remover(req.authLoja.lojaId, req.params.produtoId);
      res.status(204).end();
    }),
  );

  return rotas;
}
