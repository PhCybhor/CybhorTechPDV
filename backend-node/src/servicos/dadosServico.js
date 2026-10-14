import { randomUUID } from "node:crypto";
import * as db from "../db.js";
import { ErroNegocio } from "../erros.js";
import { ehObjetoSimples } from "../regras/entrada.js";

const TAMANHO_MAX_DOCUMENTO = 256 * 1024;
const TAMANHO_MAX_SEGMENTO = 128;
const LIMITE_LOTE = 500;
const CHAVES_QUEBRADAS = ["undefined", "null"];

/**
 * Lê a chave só se for própria do objeto. Caminhos vêm do cliente: "__proto__"
 * ou "constructor" não podem resolver para o protótipo.
 */
function lerChave(objeto, chave) {
  return Object.hasOwn(objeto, chave) ? objeto[chave] : undefined;
}

/** Grava como propriedade própria mesmo para "__proto__" (sem trocar o protótipo). */
function gravarChave(objeto, chave, valor) {
  Object.defineProperty(objeto, chave, { value: valor, enumerable: true, writable: true, configurable: true });
}

function normalizarCaminho(lojaId, caminho) {
  let partes = String(caminho ?? "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  if (partes.length >= 2 && partes[0] === "lojas") {
    if (partes[1] !== lojaId) throw new ErroNegocio("Acesso a outra loja nao permitido.", 403);
    partes = partes.slice(2);
  }
  if (!partes.length) throw new ErroNegocio("Caminho de dados invalido.");
  if (partes.some((parte) => parte.length > TAMANHO_MAX_SEGMENTO || parte === "." || parte === "..")) {
    throw new ErroNegocio("Caminho de dados invalido.");
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

/** Define (ou remove, se null) o valor no caminho, criando objetos intermediários. */
export function definirNoDocumento(documento, partes, valor) {
  let atual = documento;
  for (const parte of partes.slice(0, -1)) {
    let proximo = lerChave(atual, parte);
    if (!ehObjetoSimples(proximo)) {
      proximo = {};
      gravarChave(atual, parte, proximo);
    }
    atual = proximo;
  }
  const ultima = partes.at(-1);
  if (valor === null || valor === undefined) {
    if (Object.hasOwn(atual, ultima)) delete atual[ultima];
  } else {
    gravarChave(atual, ultima, valor);
  }
}

function mesclarNoDocumento(documento, partes, patch) {
  const existente = buscarNoDocumento(documento, partes);
  const base = ehObjetoSimples(existente) ? { ...existente } : {};
  for (const [chave, valor] of Object.entries(patch)) {
    if (valor === null) {
      if (Object.hasOwn(base, chave)) delete base[chave];
    } else {
      gravarChave(base, chave, valor);
    }
  }
  definirNoDocumento(documento, partes, base);
}

/** Detecta JSON gravado como um único registro na raiz (ex.: venda sem id filho). */
function pareceRegistroUnico(documento) {
  if (!Object.keys(documento).length) return false;
  if (!Object.hasOwn(documento, "itens") && !Object.hasOwn(documento, "criadoEm")) return false;
  const temFilhos = Object.values(documento).some(
    (valor) => ehObjetoSimples(valor) && ("itens" in valor || "criadoEm" in valor || "nome" in valor),
  );
  return !temFilhos;
}

function normalizarMapaRegistros(documento) {
  if (!ehObjetoSimples(documento)) return {};
  let dados = structuredClone(documento);
  if (pareceRegistroUnico(dados)) dados = { legado: dados };
  for (const chaveQuebrada of CHAVES_QUEBRADAS) {
    const legado = lerChave(dados, chaveQuebrada);
    delete dados[chaveQuebrada];
    if (ehObjetoSimples(legado) && !Object.hasOwn(dados, "legado")) dados.legado = legado;
  }
  return dados;
}

/**
 * Carrega o documento travando a linha (FOR UPDATE) até o fim da transação.
 * @returns {Promise<Record<string, any>>}
 */
export async function carregarRecurso(tx, lojaId, recurso) {
  const linhas = await tx.consultar("SELECT dados FROM documentos_loja WHERE loja_id = ? AND recurso = ? FOR UPDATE", [
    lojaId,
    recurso,
  ]);
  return linhas.length ? normalizarMapaRegistros(db.lerJson(linhas[0].dados)) : {};
}

/** Upsert do documento; recusa acima de 256 KB. */
export async function salvarRecurso(tx, lojaId, recurso, dados) {
  const serializado = JSON.stringify(dados);
  if (Buffer.byteLength(serializado, "utf8") > TAMANHO_MAX_DOCUMENTO) {
    throw new ErroNegocio("Documento grande demais.", 413);
  }
  await tx.executar(
    `INSERT INTO documentos_loja (loja_id, recurso, dados) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE dados = VALUES(dados), atualizado_em = CURRENT_TIMESTAMP(3)`,
    [lojaId, recurso, serializado],
  );
}

/** @returns {Promise<unknown>} documento inteiro ou o valor no subcaminho (null se ausente). */
export async function obterDados(lojaId, caminho) {
  const partes = normalizarCaminho(lojaId, caminho);
  const linhas = await db.consultar("SELECT dados FROM documentos_loja WHERE loja_id = ? AND recurso = ?", [
    lojaId,
    partes[0],
  ]);
  const documento = normalizarMapaRegistros(linhas.length ? db.lerJson(linhas[0].dados) : {});
  return partes.length === 1 ? documento : buscarNoDocumento(documento, partes.slice(1));
}

/** Substitui o valor no caminho (raiz não-objeto vira {"valor": ...}). */
export async function definirDados(lojaId, caminho, valor) {
  const partes = normalizarCaminho(lojaId, caminho);
  await db.transacao(async (tx) => {
    let documento;
    if (partes.length === 1) {
      documento = ehObjetoSimples(valor) ? valor : { valor };
    } else {
      documento = await carregarRecurso(tx, lojaId, partes[0]);
      definirNoDocumento(documento, partes.slice(1), valor);
    }
    await salvarRecurso(tx, lojaId, partes[0], documento);
  });
}

/** Mescla chaves no caminho; chave com null é removida. */
export async function mesclarDados(lojaId, caminho, patch) {
  if (!ehObjetoSimples(patch)) throw new ErroNegocio("Atualizacao de dados invalida.");
  const partes = normalizarCaminho(lojaId, caminho);
  await db.transacao(async (tx) => {
    const documento = await carregarRecurso(tx, lojaId, partes[0]);
    if (partes.length === 1) {
      for (const [chave, valor] of Object.entries(patch)) definirNoDocumento(documento, [chave], valor);
    } else {
      mesclarNoDocumento(documento, partes.slice(1), patch);
    }
    await salvarRecurso(tx, lojaId, partes[0], documento);
  });
}

/** Remove o recurso inteiro ou só o subcaminho. */
export async function removerDados(lojaId, caminho) {
  const partes = normalizarCaminho(lojaId, caminho);
  await db.transacao(async (tx) => {
    if (partes.length === 1) {
      await tx.executar("DELETE FROM documentos_loja WHERE loja_id = ? AND recurso = ?", [lojaId, partes[0]]);
      return;
    }
    const documento = await carregarRecurso(tx, lojaId, partes[0]);
    definirNoDocumento(documento, partes.slice(1), null);
    await salvarRecurso(tx, lojaId, partes[0], documento);
  });
}

/**
 * Aplica várias gravações (até 500) numa transação, agrupadas por recurso.
 * @param {string} lojaId
 * @param {Record<string, unknown>} atualizacoes caminho -> valor
 */
export async function atualizarLote(lojaId, atualizacoes) {
  if (!ehObjetoSimples(atualizacoes) || Object.keys(atualizacoes).length > LIMITE_LOTE) {
    throw new ErroNegocio("Lote de atualizacoes invalido.");
  }

  const operacoesPorRecurso = new Map();
  for (const [caminho, valor] of Object.entries(atualizacoes)) {
    const partes = normalizarCaminho(lojaId, caminho);
    if (!operacoesPorRecurso.has(partes[0])) operacoesPorRecurso.set(partes[0], []);
    operacoesPorRecurso.get(partes[0]).push([partes.slice(1), valor]);
  }

  await db.transacao(async (tx) => {
    for (const [recurso, operacoes] of operacoesPorRecurso) {
      let documento = await carregarRecurso(tx, lojaId, recurso);
      for (const [subpartes, valor] of operacoes) {
        if (!subpartes.length) {
          // Nunca substituir o mapa inteiro por um registro solto.
          if (ehObjetoSimples(valor) && !pareceRegistroUnico(valor)) documento = valor;
          continue;
        }
        const partesValidas = [...subpartes];
        if (["undefined", "null", ""].includes(partesValidas[0])) partesValidas[0] = randomUUID().replaceAll("-", "");
        definirNoDocumento(documento, partesValidas, valor);
      }
      await salvarRecurso(tx, lojaId, recurso, documento);
    }
  });
}
