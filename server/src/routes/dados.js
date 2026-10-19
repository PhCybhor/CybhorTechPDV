import { Router } from 'express';
import { autenticarLoja } from '../deps.js';
import * as dadosService from '../services/dadosService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ehVerdadeiro } from '../utils/valores.js';
import {
  corpoDe,
  exigirCorpoObjeto,
  exigirEscritaDados,
  exigirLoteDados,
  exigirRemocaoDados,
} from './guardas.js';

export function criarRotasDados() {
  const rotas = Router();

  // Registrada antes de /dados/* para "lote" não ser tratado como caminho.
  rotas.post(
    '/dados/lote',
    autenticarLoja,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      const { atualizacoes: bruto } = corpoDe(req);
      const atualizacoes = ehVerdadeiro(bruto) ? bruto : {};
      await exigirLoteDados(req.authLoja, atualizacoes);
      await dadosService.atualizarLote(req.authLoja.lojaId, atualizacoes);
      res.status(204).end();
    }),
  );

  rotas.get(
    '/dados/*',
    autenticarLoja,
    asyncHandler(async (req, res) => {
      const valor = await dadosService.obter(req.authLoja.lojaId, req.params[0]);
      res.json({ valor: valor ?? null });
    }),
  );

  rotas.put(
    '/dados/*',
    autenticarLoja,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      await exigirEscritaDados(req.authLoja, req.params[0]);
      await dadosService.definir(req.authLoja.lojaId, req.params[0], corpoDe(req).valor);
      res.status(204).end();
    }),
  );

  rotas.patch(
    '/dados/*',
    autenticarLoja,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      await exigirEscritaDados(req.authLoja, req.params[0]);
      const { patch } = corpoDe(req);
      await dadosService.mesclar(req.authLoja.lojaId, req.params[0], ehVerdadeiro(patch) ? patch : {});
      res.status(204).end();
    }),
  );

  rotas.delete(
    '/dados/*',
    autenticarLoja,
    asyncHandler(async (req, res) => {
      await exigirRemocaoDados(req.authLoja, req.params[0]);
      await dadosService.remover(req.authLoja.lojaId, req.params[0]);
      res.status(204).end();
    }),
  );

  return rotas;
}
