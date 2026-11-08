"use strict";

/** Comando do barramento → método em ctx.services. Sem Electron. */
const COMANDOS_SERVICO = Object.freeze({
  "produto.buscar": "buscarProduto",
  "produto.atualizar": "atualizarProduto",
  "venda.cancelar": "cancelarVenda",
  "caixa.sangria": "sangria",
  "caixa.fechar": "fecharCaixa",
  "navegacao.abrirRota": "abrirRota",
});

const CAMPOS_PRODUTO = Object.freeze([
  "nome",
  "preco",
  "estoque",
  "codigoBarras",
  "codigoInterno",
  "categoria",
  "custo",
  "unidade",
  "unidadesPorCaixa",
  "validade",
  "precoPromocao",
  "promoInicio",
  "promoFim",
]);

/** Write allow-list for produto.atualizar. Matches the agentTools schema, not CAMPOS_PRODUTO. */
const CAMPOS_PATCH_PRODUTO_AGENTE = Object.freeze(["nome", "preco", "estoque"]);
const CHAVES_PRODUTO_ATUALIZAR = Object.freeze([
  "produtoId",
  ...CAMPOS_PATCH_PRODUTO_AGENTE,
]);

const CHAVE_SENSIVEL =
  /senha|password|token|secret|api.?key|authorization|cpf|email|telefone|whatsapp|chave/i;

function servicoDoComando(comando) {
  return COMANDOS_SERVICO[comando] || null;
}

/**
 * @param {string} comando
 * @param {object} args
 * @param {Record<string, Function>} handlers
 */
async function despacharComando(comando, args, handlers) {
  const nome = servicoDoComando(comando);
  if (!nome) {
    return {
      ok: false,
      resumo: `comando desconhecido: ${String(comando || "")}`,
      reversivel: false,
    };
  }
  const fn = handlers && handlers[nome];
  if (typeof fn !== "function") {
    return { ok: false, resumo: "comando sem handler", reversivel: false };
  }
  try {
    const saida = await fn(args && typeof args === "object" ? args : {});
    if (!saida || typeof saida !== "object") {
      return { ok: false, resumo: "resposta vazia do comando", reversivel: false };
    }
    return saida;
  } catch (erro) {
    const msg = erro && erro.message ? String(erro.message) : "falha ao executar";
    return { ok: false, resumo: msg.slice(0, 300), reversivel: false };
  }
}

/**
 * Só produto.atualizar com snapshot `before` volta pelo mesmo comando.
 * @param {object | null | undefined} entrada
 * @returns {{ comando: string, args: object } | null}
 */
function montarReversao(entrada) {
  if (!entrada || !entrada.reversivel || entrada.before == null) return null;
  if (entrada.tool !== "produto.atualizar") return null;
  const before = entrada.before;
  if (!before || typeof before !== "object" || Array.isArray(before)) return null;
  const produtoId = before.id || before.produtoId;
  if (!produtoId) return null;
  const args = { produtoId: String(produtoId) };
  for (const campo of CAMPOS_PRODUTO) {
    if (Object.prototype.hasOwnProperty.call(before, campo) && before[campo] != null) {
      args[campo] = before[campo];
    }
  }
  return { comando: "produto.atualizar", args };
}

function argsComandoSeguros(args, comando) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const out = {};
  for (const [chave, valor] of Object.entries(args)) {
    if (CHAVE_SENSIVEL.test(chave)) continue;
    if (typeof valor === "string") out[chave] = valor.slice(0, 500);
    else if (typeof valor === "number" && Number.isFinite(valor)) out[chave] = valor;
    else if (typeof valor === "boolean") out[chave] = valor;
    else if (valor === null) out[chave] = null;
  }
  if (comando !== "produto.atualizar") return out;
  const permitido = {};
  for (const chave of CHAVES_PRODUTO_ATUALIZAR) {
    if (Object.prototype.hasOwnProperty.call(out, chave)) permitido[chave] = out[chave];
  }
  return permitido;
}

function limparSnapshot(valor, profundidade) {
  if (profundidade > 4 || valor == null) return valor;
  if (typeof valor === "string") return valor.slice(0, 240);
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : undefined;
  if (typeof valor === "boolean") return valor;
  if (Array.isArray(valor)) {
    return valor
      .slice(0, 80)
      .map((item) => limparSnapshot(item, profundidade + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof valor === "object") {
    const out = {};
    for (const [chave, item] of Object.entries(valor)) {
      if (CHAVE_SENSIVEL.test(chave)) continue;
      const limpo = limparSnapshot(item, profundidade + 1);
      if (limpo !== undefined) out[chave] = limpo;
    }
    return out;
  }
  return undefined;
}

function idLojaSeguro(lojaId) {
  return String(lojaId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}

/**
 * Snapshot da loja → documentos com id estável para o ragStore.
 * @param {object} snapshot
 * @returns {Array<{ id: string, texto: string, fonte: string, lojaId?: string }>}
 */
function documentosDeSnapshotLoja(snapshot) {
  const limpo = limparSnapshot(snapshot, 0);
  if (!limpo || typeof limpo !== "object" || Array.isArray(limpo)) return [];
  const lojaId = idLojaSeguro(limpo.lojaId);
  const docs = [];
  const produtos = Array.isArray(limpo.produtos) ? limpo.produtos : [];
  const linhasProduto = produtos
    .slice(0, 80)
    .map((p) => {
      const nome = String((p && p.nome) || "").trim();
      if (!nome) return "";
      const preco = Number(p.preco);
      const estoque = Number(p.estoque);
      const cat = p.categoria ? ` [${p.categoria}]` : "";
      const precoTxt = Number.isFinite(preco) ? ` R$ ${preco}` : "";
      const estTxt = Number.isFinite(estoque) ? ` estoque ${estoque}` : "";
      return `${nome}${cat}${precoTxt}${estTxt}`;
    })
    .filter(Boolean);
  if (linhasProduto.length) {
    const row = {
      id: lojaId ? `loja-${lojaId}-produtos` : "loja-produtos",
      fonte: "loja",
      texto: `Produtos da loja: ${linhasProduto.join("; ")}`.slice(0, 6000),
    };
    if (lojaId) row.lojaId = lojaId;
    docs.push(row);
  }
  const baixo = Array.isArray(limpo.estoqueBaixo) ? limpo.estoqueBaixo : [];
  const linhasBaixo = baixo
    .slice(0, 20)
    .map((p) => {
      const nome = String((p && p.nome) || "").trim();
      if (!nome) return "";
      return `${nome} (${Number(p.estoque) || 0})`;
    })
    .filter(Boolean);
  if (linhasBaixo.length) {
    const row = {
      id: lojaId ? `loja-${lojaId}-estoque-baixo` : "loja-estoque-baixo",
      fonte: "loja",
      texto: `Estoque baixo: ${linhasBaixo.join("; ")}`.slice(0, 2000),
    };
    if (lojaId) row.lojaId = lojaId;
    docs.push(row);
  }
  return docs;
}

module.exports = {
  COMANDOS_SERVICO,
  CAMPOS_PRODUTO,
  CAMPOS_PATCH_PRODUTO_AGENTE,
  CHAVES_PRODUTO_ATUALIZAR,
  servicoDoComando,
  despacharComando,
  montarReversao,
  argsComandoSeguros,
  documentosDeSnapshotLoja,
};
