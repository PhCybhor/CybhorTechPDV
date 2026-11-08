"use strict";

const AJUDA_FIXA =
  "Posso buscar produto, atualizar produto, cancelar venda, registrar sangria e fechar o caixa.";

const TOOLS = [
  {
    nome: "sistema.ajuda",
    descricao: "Explica funções do PDV. Se vier pergunta, devolve esse texto na resposta.",
    risco: "baixo",
    args: {
      pergunta: { tipo: "string", obrigatorio: false },
    },
    async executar(args) {
      const pergunta = typeof args.pergunta === "string" ? args.pergunta.trim() : "";
      return {
        ok: true,
        resumo: pergunta ? `Ajuda: ${pergunta}` : AJUDA_FIXA,
        reversivel: false,
      };
    },
  },
  {
    nome: "produto.buscar",
    descricao: "Busca produto pelo termo.",
    risco: "baixo",
    args: {
      termo: { tipo: "string", obrigatorio: true },
    },
    async executar(args, ctx) {
      return embrulhar(await ctx.services.buscarProduto(args), "produto encontrado");
    },
  },
  {
    nome: "produto.atualizar",
    descricao: "Atualiza um produto. O service devolve before e after.",
    risco: "medio",
    args: {
      produtoId: { tipo: "string", obrigatorio: true },
      preco: { tipo: "number", obrigatorio: false },
      nome: { tipo: "string", obrigatorio: false },
      estoque: { tipo: "number", obrigatorio: false },
    },
    async executar(args, ctx) {
      return embrulhar(await ctx.services.atualizarProduto(args), "produto atualizado");
    },
  },
  {
    nome: "venda.cancelar",
    descricao: "Cancela uma venda do caixa.",
    risco: "alto",
    args: {
      vendaId: { tipo: "string", obrigatorio: true },
      motivo: { tipo: "string", obrigatorio: false },
    },
    async executar(args, ctx) {
      return embrulhar(await ctx.services.cancelarVenda(args), "venda cancelada");
    },
  },
  {
    nome: "caixa.sangria",
    descricao: "Registra sangria de dinheiro do caixa.",
    risco: "alto",
    args: {
      valor: { tipo: "number", obrigatorio: true },
      motivo: { tipo: "string", obrigatorio: false },
    },
    async executar(args, ctx) {
      return embrulhar(await ctx.services.sangria(args), "sangria registrada");
    },
  },
  {
    nome: "caixa.fechar",
    descricao: "Fecha o caixa da loja.",
    risco: "alto",
    args: {},
    async executar(args, ctx) {
      return embrulhar(await ctx.services.fecharCaixa(args), "caixa fechado");
    },
  },
];

function listarTools() {
  return TOOLS.map(({ nome, descricao, risco, args }) => ({
    nome,
    descricao,
    risco,
    args,
  }));
}

function argsDeclarados(spec, args) {
  const recebidos = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const out = {};
  for (const chave of Object.keys(spec || {})) {
    if (Object.prototype.hasOwnProperty.call(recebidos, chave)) out[chave] = recebidos[chave];
  }
  return out;
}

function argsInvalidos(spec, args) {
  const recebidos = args && typeof args === "object" ? args : {};
  for (const [chave, meta] of Object.entries(spec)) {
    const valor = recebidos[chave];
    const ausente = valor === undefined || valor === null || valor === "";
    if (meta.obrigatorio && ausente) return true;
    if (ausente) continue;
    if (meta.tipo === "string" && typeof valor !== "string") return true;
    if (meta.tipo === "number" && (typeof valor !== "number" || !Number.isFinite(valor))) {
      return true;
    }
  }
  return false;
}

function embrulhar(result, padrao) {
  if (result && result.ok === false) {
    return {
      ok: false,
      resumo: String(result.resumo || "falha"),
      reversivel: false,
    };
  }
  const saida = {
    ok: true,
    resumo: (result && typeof result.resumo === "string" && result.resumo) || padrao,
    reversivel: result != null && result.before != null,
  };
  if (result && Object.prototype.hasOwnProperty.call(result, "before")) {
    saida.before = result.before;
  }
  if (result && Object.prototype.hasOwnProperty.call(result, "after")) {
    saida.after = result.after;
  }
  return saida;
}

async function executarTool(nome, args, ctx) {
  const tool = TOOLS.find((item) => item.nome === nome);
  if (!tool) return { ok: false, resumo: "tool_desconhecida" };
  if (argsInvalidos(tool.args, args)) {
    return { ok: false, resumo: "args_invalidos" };
  }
  return tool.executar(argsDeclarados(tool.args, args), ctx || {});
}

module.exports = { listarTools, executarTool };
