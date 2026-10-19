import { Router } from 'express';
import { autenticarLoja } from '../deps.js';
import { ErroNegocio } from '../errors.js';
import * as caixaService from '../services/caixaService.js';
import * as vendaService from '../services/vendaService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { converterParaInteiro, texto } from '../utils/valores.js';
import { corpoDe, exigirCorpoObjeto, exigirDescontoEFiado, exigirPerm } from './guardas.js';

const LIMITE_PADRAO_LISTAGEM = 100;

function lerLimite(req) {
  const bruto = req.query.limite;
  if (bruto === undefined) return LIMITE_PADRAO_LISTAGEM;
  const limite = converterParaInteiro(Array.isArray(bruto) ? bruto[bruto.length - 1] : bruto);
  if (limite === null) throw new ErroNegocio('Dados invalidos.', 422);
  return limite;
}

function funcionarioDaSessao(auth) {
  return { id: auth.funcionarioId, nome: auth.nome };
}

export function criarRotasVendas() {
  const rotas = Router();

  rotas.post(
    '/vendas',
    autenticarLoja,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      const payload = corpoDe(req);
      await exigirDescontoEFiado(req.authLoja, payload);
      const venda = await vendaService.registrarVenda(
        req.authLoja.lojaId,
        funcionarioDaSessao(req.authLoja),
        payload,
      );
      res.status(201).json(venda);
    }),
  );

  rotas.get(
    '/vendas',
    autenticarLoja,
    asyncHandler(async (req, res) => {
      res.json(await vendaService.listarVendas(req.authLoja.lojaId, lerLimite(req)));
    }),
  );

  // Caixa (documentos_loja): baixa de estoque atômica.
  rotas.post(
    '/caixa/venda',
    autenticarLoja,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      const payload = corpoDe(req);
      await exigirDescontoEFiado(req.authLoja, payload);
      const venda = await caixaService.finalizarVenda(
        req.authLoja.lojaId,
        funcionarioDaSessao(req.authLoja),
        payload,
      );
      res.status(201).json(venda);
    }),
  );

  rotas.post(
    '/caixa/cancelar-venda',
    autenticarLoja,
    exigirCorpoObjeto,
    asyncHandler(async (req, res) => {
      const auth = req.authLoja;
      const corpo = corpoDe(req);
      // Cancelamento no caixa exige admin (senha validada no cliente) OU permissão.
      if (auth.cargo !== 'admin') {
        await exigirPerm(auth, 'cancelarVenda', 'Sem permissao para cancelar venda.');
      }
      res.json(
        await caixaService.cancelarVenda(auth.lojaId, {
          vendaId: texto(corpo.vendaId),
          motivo: texto(corpo.motivo),
          canceladoPorNome: texto(corpo.canceladoPorNome) || auth.nome || '',
        }),
      );
    }),
  );

  return rotas;
}
