import { Router } from 'express';
import { config } from '../config.js';
import { autenticarLoja } from '../deps.js';
import { ErroNegocio } from '../errors.js';
import { criarLimitador } from '../httpSeguranca.js';
import * as authService from '../services/authService.js';
import * as lojaService from '../services/lojaService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ehVerdadeiro, objetoOuVazio, texto } from '../utils/valores.js';
import { corpoDe, exigirCorpoObjeto } from './guardas.js';

const AMBIENTES_CADASTRO_PUBLICO = ['development', 'dev', 'test'];
const CHAVE_DESENVOLVIMENTO = 'DEV-LOCAL';

export function criarRotasLojas() {
  const rotas = Router();
  const limitarLojas = criarLimitador(20, 15);
  const limitarAdminInicial = criarLimitador(10, 15);

  rotas.post(
    '/lojas',
    limitarLojas,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      // Público sem CPF/trial: só em development/test. Site e admin cobrem o resto.
      const ambiente = config.nodeEnv.trim().toLowerCase();
      if (!AMBIENTES_CADASTRO_PUBLICO.includes(ambiente)) {
        throw new ErroNegocio('Cadastro de loja apenas pelo site ou pelo admin.', 403);
      }
      const corpo = corpoDe(req);
      const criada = await lojaService.criarLojaComAdmin({
        loja: objetoOuVazio(corpo.loja),
        admin: objetoOuVazio(corpo.admin),
        aguardarPagamento: ehVerdadeiro(corpo.aguardarPagamento),
      });
      res.status(201).json(criada);
    }),
  );

  rotas.post(
    '/lojas/conectar',
    limitarLojas,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      res.json(await lojaService.buscarLojaPorCodigo(texto(corpoDe(req).codigo)));
    }),
  );

  rotas.post(
    '/ativar',
    limitarLojas,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      const chave = texto(corpoDe(req).chave).toUpperCase();
      if (chave === CHAVE_DESENVOLVIMENTO) {
        if (config.emProducao) throw new ErroNegocio('Chave de desenvolvimento indisponivel.', 403);
        res.json(await lojaService.obterOuCriarLojaDesenvolvimento());
        return;
      }
      res.json(await lojaService.ativarPorCodigo(chave));
    }),
  );

  rotas.get(
    '/lojas/perfil',
    autenticarLoja,
    asyncHandler(async (req, res) => {
      res.json(await lojaService.obterPerfil(req.authLoja.lojaId));
    }),
  );

  rotas.get(
    '/lojas/:lojaId/bootstrap',
    asyncHandler(async (req, res) => {
      res.json({ temAdmin: await authService.existeAdministrador(req.params.lojaId) });
    }),
  );

  rotas.post(
    '/lojas/:lojaId/admin-inicial',
    limitarAdminInicial,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      res.status(201).json(await authService.criarAdminInicial(req.params.lojaId, corpoDe(req)));
    }),
  );

  return rotas;
}
