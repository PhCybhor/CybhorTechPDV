import { Router } from 'express';
import { autenticarLoja, exigirAdminLoja } from '../deps.js';
import { criarLimitador } from '../httpSeguranca.js';
import * as authService from '../services/authService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { corpoDe, exigirCorpoObjeto } from './guardas.js';

export function criarRotasAuth() {
  const rotas = Router();
  const limitarLogin = criarLimitador(10, 15);

  rotas.post(
    '/auth/login',
    limitarLogin,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      const corpo = corpoDe(req);
      res.json(
        await authService.loginLoja({
          codigoLoja: corpo.codigoLoja,
          lojaId: corpo.lojaId,
          usuario: corpo.usuario,
          senha: corpo.senha,
          email: corpo.email,
        }),
      );
    }),
  );

  rotas.get(
    '/funcionarios',
    autenticarLoja,
    exigirAdminLoja,
    asyncHandler(async (req, res) => {
      res.json(await authService.listarFuncionarios(req.authLoja.lojaId));
    }),
  );

  rotas.post(
    '/funcionarios',
    autenticarLoja,
    exigirAdminLoja,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      res.status(201).json(await authService.criarFuncionario(req.authLoja.lojaId, corpoDe(req)));
    }),
  );

  rotas.patch(
    '/funcionarios/:funcionarioId',
    autenticarLoja,
    exigirAdminLoja,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      await authService.atualizarFuncionario(
        req.authLoja.lojaId,
        req.params.funcionarioId,
        corpoDe(req),
      );
      res.status(204).end();
    }),
  );

  return rotas;
}
