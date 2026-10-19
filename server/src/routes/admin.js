import { Router } from 'express';
import { config } from '../config.js';
import { autenticarAdminSistema } from '../deps.js';
import { ErroNegocio } from '../errors.js';
import { criarLimitador } from '../httpSeguranca.js';
import * as adminService from '../services/adminService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ehVerdadeiro, objetoOuVazio } from '../utils/valores.js';
import { corpoDe, exigirCorpoObjeto } from './guardas.js';

export function criarRotasAdmin() {
  const rotas = Router();
  const limitarBootstrap = criarLimitador(5, 15);
  const limitarLogin = criarLimitador(10, 15);

  rotas.post(
    '/admin/bootstrap',
    limitarBootstrap,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      if (config.emProducao) throw new ErroNegocio('Bootstrap indisponivel em producao.', 403);
      const corpo = corpoDe(req);
      const criado = await adminService.bootstrapAdminSistema({
        nome: corpo.nome,
        email: corpo.email,
        senha: corpo.senha,
        secret: corpo.secret,
      });
      res.status(201).json(criado);
    }),
  );

  rotas.post(
    '/admin/login',
    limitarLogin,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      const corpo = corpoDe(req);
      res.json(await adminService.loginAdminSistema({ email: corpo.email, senha: corpo.senha }));
    }),
  );

  rotas.get(
    '/admin/lojas',
    autenticarAdminSistema,
    asyncHandler(async (_req, res) => {
      res.json(await adminService.listarLojasComMetricas());
    }),
  );

  rotas.get(
    '/admin/lojas/:lojaId',
    autenticarAdminSistema,
    asyncHandler(async (req, res) => {
      res.json(await adminService.detalharLoja(req.params.lojaId));
    }),
  );

  rotas.patch(
    '/admin/lojas/:lojaId/ativa',
    autenticarAdminSistema,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      const corpo = corpoDe(req);
      if (!Object.hasOwn(corpo, 'ativa')) throw new ErroNegocio('Informe o campo ativa.');
      await adminService.definirLojaAtiva(req.params.lojaId, ehVerdadeiro(corpo.ativa));
      res.status(204).end();
    }),
  );

  rotas.post(
    '/admin/lojas',
    autenticarAdminSistema,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      const corpo = corpoDe(req);
      const criada = await adminService.criarContaLoja({
        loja: objetoOuVazio(corpo.loja),
        admin: objetoOuVazio(corpo.admin),
      });
      res.status(201).json(criada);
    }),
  );

  rotas.post(
    '/admin/lojas/:lojaId/regenerar-chave',
    autenticarAdminSistema,
    asyncHandler(async (req, res) => {
      res.json(await adminService.regenerarChaveLoja(req.params.lojaId));
    }),
  );

  return rotas;
}
