import { basename, extname, dirname } from 'node:path';
import { Router } from 'express';
import { criarLimitador, chaveRateLimit } from '../httpSeguranca.js';
import { catalogoPlanos, obterPlano } from '../planos.js';
import * as instaladoresService from '../services/instaladoresService.js';
import * as siteService from '../services/siteService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { texto } from '../utils/valores.js';
import { corpoDe, exigirCorpoObjeto, lerQueryObrigatoria } from './guardas.js';

const TIPO_DOWNLOAD = 'application/octet-stream';

/** Envia o instalador como download; `root` evita o bloqueio de dotfiles no caminho absoluto. */
function enviarInstalador(res, next, caminho, nomeDownload) {
  res.attachment(nomeDownload);
  res.type(TIPO_DOWNLOAD);
  res.sendFile(basename(caminho), { root: dirname(caminho) }, (erro) => {
    if (erro) next(erro);
  });
}

export function criarRotasSite() {
  const rotas = Router();
  const limitarCompra = criarLimitador(20, 15);
  const limitarPagamento = criarLimitador(20, 15);
  const limitarDownload = criarLimitador(30, 60);

  rotas.get('/site/preco', (_req, res) => {
    res.json({
      ok: true,
      preco: obterPlano('mensal').valor,
      planos: catalogoPlanos(),
    });
  });

  rotas.post(
    '/site/comprar',
    limitarCompra,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      const corpo = corpoDe(req);
      const resultado = await siteService.comprarPeloSite({
        loja: corpo.loja,
        admin: corpo.admin,
        plano: texto(corpo.plano) || 'mensal',
        aceiteDiretrizes: corpo.aceiteDiretrizes,
        ip: chaveRateLimit(req),
        navegador: req.headers['user-agent'] || '',
      });
      res.status(201).json({
        tokenAtivacao: resultado.tokenAtivacao,
        checkoutUrl: resultado.checkoutUrl || '',
        publicKey: resultado.publicKey || '',
        trial: Boolean(resultado.trial),
        redirectUrl: resultado.redirectUrl || '',
      });
    }),
  );

  rotas.get(
    '/site/downloads',
    asyncHandler(async (_req, res) => {
      res.json(await instaladoresService.listarInstaladores());
    }),
  );

  rotas.get(
    '/site/baixar/:arquivo',
    limitarDownload,
    asyncHandler(async (req, res, next) => {
      const caminho = await instaladoresService.caminhoInstalador(req.params.arquivo);
      enviarInstalador(res, next, caminho, basename(caminho));
    }),
  );

  rotas.get(
    '/site/baixar/:versao/:arquivo',
    limitarDownload,
    asyncHandler(async (req, res, next) => {
      const { versao, arquivo } = req.params;
      const caminho = await instaladoresService.caminhoInstalador(arquivo, versao);
      // Nome com a versão para o cliente distinguir setups antigos na pasta Downloads.
      const extensao = extname(caminho);
      const nomeDownload = `${basename(caminho, extensao)}-v${versao}${extensao}`;
      enviarInstalador(res, next, caminho, nomeDownload);
    }),
  );

  rotas.get(
    '/site/pagamento',
    asyncHandler(async (req, res) => {
      res.json(await siteService.obterDadosPagamento(lerQueryObrigatoria(req, 'token')));
    }),
  );

  rotas.post(
    '/site/pagar',
    limitarPagamento,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      const corpo = corpoDe(req);
      res.json(
        await siteService.processarPagamentoSite(texto(corpo.tokenAtivacao), corpo.formData || {}),
      );
    }),
  );

  rotas.get(
    '/site/ativacao',
    asyncHandler(async (req, res) => {
      res.json(await siteService.consultarAtivacao(lerQueryObrigatoria(req, 'token')));
    }),
  );

  return rotas;
}
