import { randomUUID } from 'node:crypto';
import * as db from '../db.js';
import { ErroNegocio } from '../errors.js';
import { ehObjetoSimples, lerJson } from '../utils/valores.js';

export const TAMANHO_MAX_DOCUMENTO_BYTES = 256 * 1024;
const MAXIMO_ATUALIZACOES_LOTE = 500;
const TAMANHO_MAX_SEGMENTO = 128;
const SEGMENTOS_PROIBIDOS = new Set(['.', '..', '__proto__']);
const CHAVES_QUEBRADAS_PELO_CLIENTE = ['undefined', 'null'];

// Os caminhos vêm do usuário e viram chaves de objeto: nunca use `obj[chave] = valor`
// direto, pois "__proto__" alteraria o protótipo em vez de criar uma propriedade.
function lerPropriedade(objeto, chave) {
  return Object.hasOwn(objeto, chave) ? objeto[chave] : undefined;
}

function gravarPropriedade(objeto, chave, valor) {
  Object.defineProperty(objeto, chave, {
    value: valor,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function normalizarCaminho(lojaId, caminho) {
  let partes = String(caminho ?? '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);
  if (partes.length >= 2 && partes[0] === 'lojas') {
    if (partes[1] !== lojaId) throw new ErroNegocio('Acesso a outra loja nao permitido.', 403);
    partes = partes.slice(2);
  }
  if (partes.length === 0) throw new ErroNegocio('Caminho de dados invalido.');
  if (partes.some((parte) => parte.length > TAMANHO_MAX_SEGMENTO || SEGMENTOS_PROIBIDOS.has(parte))) {
    throw new ErroNegocio('Caminho de dados invalido.');
  }
  return partes;
}

function buscarNoDocumento(documento, partes) {
  let atual = documento;
  for (const parte of partes) {
    if (!ehObjetoSimples(atual) || !Object.hasOwn(atual, parte)) return null;
    atual = atual[parte];
  }
  return atual;
}

/** Define (ou remove, quando `valor` é nulo) o valor em `partes`, criando objetos intermediários. */
function definirNoDocumento(documento, partes, valor) {
  let atual = documento;
  for (const parte of partes.slice(0, -1)) {
    let proximo = lerPropriedade(atual, parte);
    if (!ehObjetoSimples(proximo)) {
      proximo = {};
      gravarPropriedade(atual, parte, proximo);
    }
    atual = proximo;
  }
  const ultima = partes[partes.length - 1];
  if (valor === null || valor === undefined) {
    delete atual[ultima];
  } else {
    gravarPropriedade(atual, ultima, valor);
  }
}

function mesclarNoDocumento(documento, partes, patch) {
  const existente = buscarNoDocumento(documento, partes);
  const base = ehObjetoSimples(existente) ? { ...existente } : {};
  for (const [chave, valor] of Object.entries(patch)) {
    if (valor === null || valor === undefined) {
      delete base[chave];
    } else {
      gravarPropriedade(base, chave, valor);
    }
  }
  definirNoDocumento(documento, partes, base);
}

/** Detecta JSON gravado como um único registro na raiz (ex.: venda sem id filho). */
export function parecerRegistroUnico(documento) {
  if (!ehObjetoSimples(documento) || Object.keys(documento).length === 0) return false;
  if (!Object.hasOwn(documento, 'itens') && !Object.hasOwn(documento, 'criadoEm')) return false;
  const temFilhos = Object.values(documento).some(
    (valor) =>
      ehObjetoSimples(valor) &&
      (Object.hasOwn(valor, 'itens') || Object.hasOwn(valor, 'criadoEm') || Object.hasOwn(valor, 'nome')),
  );
  return !temFilhos;
}

function normalizarMapaRegistros(documento) {
  if (!ehObjetoSimples(documento)) return {};
  let dados = documento;
  if (parecerRegistroUnico(dados)) dados = { legado: dados };
  for (const chaveQuebrada of CHAVES_QUEBRADAS_PELO_CLIENTE) {
    if (!Object.hasOwn(dados, chaveQuebrada)) continue;
    const legado = dados[chaveQuebrada];
    delete dados[chaveQuebrada];
    if (ehObjetoSimples(legado) && !Object.hasOwn(dados, 'legado')) dados.legado = legado;
  }
  return dados;
}

/**
 * Lê o documento do recurso travando a linha (FOR UPDATE) até o fim da transação.
 * Chame sempre na mesma ordem (vendas -> produtos) para evitar deadlock.
 * @param {import('../db.js').ContextoTransacao} cx
 */
export async function carregarRecurso(cx, lojaId, recurso) {
  const linhas = await cx.consultar(
    'SELECT dados FROM documentos_loja WHERE loja_id = ? AND recurso = ? FOR UPDATE',
    [lojaId, recurso],
  );
  if (linhas.length === 0) return {};
  return normalizarMapaRegistros(lerJson(linhas[0].dados));
}

/** @param {import('../db.js').ContextoTransacao} cx */
export async function salvarRecurso(cx, lojaId, recurso, dados) {
  const serializado = JSON.stringify(dados);
  if (Buffer.byteLength(serializado, 'utf8') > TAMANHO_MAX_DOCUMENTO_BYTES) {
    throw new ErroNegocio('Documento grande demais.', 413);
  }
  // VALUES() é o upsert compatível com MariaDB (Hostinger) e MySQL 5.7/8.
  // A forma `AS novo` só existe no MySQL ≥ 8.0.19 e quebra o troco/caixa.
  await cx.executar(
    `INSERT INTO documentos_loja (loja_id, recurso, dados)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE dados = VALUES(dados), atualizado_em = NOW(3)`,
    [lojaId, recurso, serializado],
  );
}

export async function obter(lojaId, caminho) {
  const partes = normalizarCaminho(lojaId, caminho);
  const linhas = await db.consultar(
    'SELECT dados FROM documentos_loja WHERE loja_id = ? AND recurso = ?',
    [lojaId, partes[0]],
  );
  const documento = normalizarMapaRegistros(linhas.length > 0 ? lerJson(linhas[0].dados) : {});
  if (partes.length === 1) return documento;
  return buscarNoDocumento(documento, partes.slice(1));
}

export async function definir(lojaId, caminho, valor) {
  const partes = normalizarCaminho(lojaId, caminho);
  await db.transacao(async (cx) => {
    let documento;
    if (partes.length === 1) {
      documento = ehObjetoSimples(valor) ? valor : { valor: valor ?? null };
    } else {
      documento = await carregarRecurso(cx, lojaId, partes[0]);
      definirNoDocumento(documento, partes.slice(1), valor);
    }
    await salvarRecurso(cx, lojaId, partes[0], documento);
  });
}

/** Merge raso do `patch` no nó do caminho; valores nulos removem a chave. */
export async function mesclar(lojaId, caminho, patch) {
  if (!ehObjetoSimples(patch)) throw new ErroNegocio('Atualizacao de dados invalida.');
  const partes = normalizarCaminho(lojaId, caminho);
  await db.transacao(async (cx) => {
    const documento = await carregarRecurso(cx, lojaId, partes[0]);
    if (partes.length === 1) {
      for (const [chave, valor] of Object.entries(patch)) {
        definirNoDocumento(documento, [chave], valor);
      }
    } else {
      mesclarNoDocumento(documento, partes.slice(1), patch);
    }
    await salvarRecurso(cx, lojaId, partes[0], documento);
  });
}

export async function remover(lojaId, caminho) {
  const partes = normalizarCaminho(lojaId, caminho);
  await db.transacao(async (cx) => {
    if (partes.length === 1) {
      await cx.executar('DELETE FROM documentos_loja WHERE loja_id = ? AND recurso = ?', [
        lojaId,
        partes[0],
      ]);
      return;
    }
    const documento = await carregarRecurso(cx, lojaId, partes[0]);
    definirNoDocumento(documento, partes.slice(1), null);
    await salvarRecurso(cx, lojaId, partes[0], documento);
  });
}

/** Aplica várias escritas de uma vez, agrupadas por recurso (um lock por documento). */
export async function atualizarLote(lojaId, atualizacoes) {
  if (!ehObjetoSimples(atualizacoes) || Object.keys(atualizacoes).length > MAXIMO_ATUALIZACOES_LOTE) {
    throw new ErroNegocio('Lote de atualizacoes invalido.');
  }

  const porRecurso = new Map();
  for (const [caminho, valor] of Object.entries(atualizacoes)) {
    const partes = normalizarCaminho(lojaId, caminho);
    const operacoes = porRecurso.get(partes[0]) ?? [];
    operacoes.push({ subpartes: partes.slice(1), valor });
    porRecurso.set(partes[0], operacoes);
  }

  await db.transacao(async (cx) => {
    for (const [recurso, operacoes] of porRecurso) {
      let documento = await carregarRecurso(cx, lojaId, recurso);
      for (const { subpartes, valor } of operacoes) {
        if (subpartes.length === 0) {
          // Nunca substituir o mapa inteiro por um registro solto.
          if (ehObjetoSimples(valor) && !parecerRegistroUnico(valor)) documento = valor;
          continue;
        }
        const partesValidas = [...subpartes];
        if (['undefined', 'null', ''].includes(partesValidas[0])) {
          partesValidas[0] = randomUUID().replaceAll('-', '');
        }
        definirNoDocumento(documento, partesValidas, valor);
      }
      await salvarRecurso(cx, lojaId, recurso, documento);
    }
  });
}
