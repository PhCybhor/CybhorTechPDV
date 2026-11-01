"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { criarJournal } = require("../electron/agentJournal");
const { listarTools, executarTool } = require("../electron/agentTools");
const { criarRuntime } = require("../electron/agentRuntime");

const arquivo = path.join(os.tmpdir(), `cybhor-rt-${Date.now()}.jsonl`);
const journal = criarJournal(arquivo);
const tools = { listarTools, executarTool };

const services = {
  atualizar: 0,
  cancelar: 0,
  async atualizarProduto(args) {
    this.atualizar += 1;
    return {
      before: { preco: 10 },
      after: { preco: args.preco },
      resumo: "preco atualizado",
    };
  },
  async cancelarVenda() {
    this.cancelar += 1;
    return {
      resumo: "venda cancelada",
      before: { status: "aberta" },
      after: { status: "cancelada" },
    };
  },
};

const pedidoAtualizar = {
  texto: "Vou atualizar o preço.",
  tool_calls: [{ nome: "produto.atualizar", args: { produtoId: "p1", preco: 12 } }],
  provider: "mock",
};

function llmAtualizar() {
  return async (entrada) => {
    assert.strictEqual(typeof entrada.prompt, "string");
    assert.ok(entrada.prompt.includes("autorizacao") || entrada.prompt.includes("autonomo") || entrada.prompt.length > 0);
    assert.ok(Array.isArray(entrada.tools));
    return pedidoAtualizar;
  };
}

async function main() {
  const runtime = criarRuntime({
    journal,
    tools,
    rag: {
      montarContexto(mensagem) {
        return `rag:${mensagem}`;
      },
    },
    chamarLlm: async (entrada) => {
      assert.ok(entrada.prompt.includes("rag:atualiza o cafe"));
      assert.ok(/autoriza/i.test(entrada.prompt));
      return pedidoAtualizar;
    },
  });

  const negado = await runtime.processarPedido({
    mensagem: "atualiza o cafe",
    modo: "autorizacao",
    contextoLoja: { lojaId: "loja-1" },
    confirmarEscrita: async (proposta) => {
      assert.strictEqual(proposta.tool, "produto.atualizar");
      assert.strictEqual(proposta.args.produtoId, "p1");
      return false;
    },
    ctxTools: { lojaId: "loja-1", services },
  });

  assert.strictEqual(services.atualizar, 0);
  assert.strictEqual(
    journal.listar(20).filter((e) => e.tool === "produto.atualizar").length,
    0
  );
  assert.deepStrictEqual(negado.acoes, []);
  assert.strictEqual(negado.provider, "mock");
  assert.strictEqual(negado.ok, true);

  for (const modo of [undefined, "autorização"]) {
    let consultado = false;
    const pedido = {
      mensagem: "atualiza o cafe",
      contextoLoja: { lojaId: "loja-1" },
      confirmarEscrita: async () => {
        consultado = true;
        return false;
      },
      ctxTools: { lojaId: "loja-1", services },
    };
    if (modo !== undefined) pedido.modo = modo;
    const recusado = await runtime.processarPedido(pedido);
    assert.strictEqual(consultado, true);
    assert.strictEqual(services.atualizar, 0);
    assert.ok(recusado.texto.includes("ação não confirmada"));
    assert.strictEqual(
      journal.listar(20).filter((e) => e.tool === "produto.atualizar").length,
      0
    );
  }

  const autonomo = criarRuntime({
    journal,
    tools,
    chamarLlm: llmAtualizar(),
  });
  let confirmouAutonomo = false;
  const feito = await autonomo.processarPedido({
    mensagem: "atualiza o cafe",
    modo: "autonomo",
    contextoLoja: { lojaId: "loja-1" },
    confirmarEscrita: async () => {
      confirmouAutonomo = true;
      return false;
    },
    ctxTools: { lojaId: "loja-1", services },
  });

  assert.strictEqual(confirmouAutonomo, false);
  assert.strictEqual(services.atualizar, 1);
  const linhas = journal.listar(20).filter((e) => e.tool === "produto.atualizar");
  assert.strictEqual(linhas.length, 1);
  assert.strictEqual(linhas[0].modo, "autonomo");
  assert.strictEqual(linhas[0].resumo, "preco atualizado");
  assert.strictEqual(linhas[0].before.preco, 10);
  assert.strictEqual(linhas[0].after.preco, 12);
  assert.strictEqual(feito.acoes.length, 1);
  assert.strictEqual(feito.acoes[0].id, linhas[0].id);
  assert.ok(feito.texto.includes("preco atualizado"));
  assert.strictEqual(feito.provider, "mock");

  const limitado = criarRuntime({
    journal,
    tools,
    rateLimitAltoPorMin: 5,
    chamarLlm: async () => ({
      texto: "Cancelando a venda.",
      tool_calls: [{ nome: "venda.cancelar", args: { vendaId: "v1" } }],
      provider: "mock",
    }),
  });

  let sexto;
  for (let i = 0; i < 6; i++) {
    sexto = await limitado.processarPedido({
      mensagem: "cancela a venda",
      modo: "autonomo",
      contextoLoja: { lojaId: "loja-1" },
      ctxTools: { lojaId: "loja-1", services },
    });
  }

  assert.strictEqual(services.cancelar, 5);
  assert.strictEqual(sexto.ok, true);
  assert.strictEqual(sexto.acoes.length, 1);
  assert.ok(/minuto|limite|rate/i.test(sexto.acoes[0].resumo));
  assert.ok(/minuto|limite|rate/i.test(sexto.texto));
  assert.strictEqual(sexto.acoes[0].tool, "venda.cancelar");
  const altas = journal.listar(20).filter((e) => e.tool === "venda.cancelar");
  assert.strictEqual(altas.length, 6);

  fs.unlinkSync(arquivo);
  console.log("ok runtime");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
