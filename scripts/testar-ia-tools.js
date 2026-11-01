"use strict";
const assert = require("assert");
const { listarTools, executarTool } = require("../electron/agentTools");

const ESPERADOS = {
  "sistema.ajuda": "baixo",
  "produto.buscar": "baixo",
  "produto.atualizar": "medio",
  "venda.cancelar": "alto",
  "caixa.sangria": "alto",
  "caixa.fechar": "alto",
};

const schemas = listarTools();
assert.strictEqual(schemas.length, Object.keys(ESPERADOS).length);
for (const schema of schemas) {
  assert.strictEqual(schema.risco, ESPERADOS[schema.nome]);
  assert.strictEqual(typeof schema.descricao, "string");
  assert.ok(schema.descricao.length > 0);
  assert.strictEqual(typeof schema.args, "object");
}

const db = {
  produtos: { p1: { id: "p1", nome: "Cafe", preco: 10 } },
};
const chamadas = [];
const services = {
  async buscarProduto(args) {
    chamadas.push(["buscar", args]);
    return db.produtos.p1;
  },
  async atualizarProduto(args) {
    chamadas.push(["atualizar", args]);
    const before = { ...db.produtos[args.produtoId] };
    const after = { ...before, preco: args.preco };
    db.produtos[args.produtoId] = after;
    return { before, after, resumo: "preco atualizado" };
  },
  async cancelarVenda(args) {
    chamadas.push(["cancelar", args]);
    return { resumo: "venda cancelada", before: { status: "aberta" }, after: { status: "cancelada" } };
  },
  async sangria(args) {
    chamadas.push(["sangria", args]);
    return { resumo: "sangria registrada", after: { valor: args.valor } };
  },
  async fecharCaixa(args) {
    chamadas.push(["fechar", args]);
    return { resumo: "caixa fechado" };
  },
};
const ctx = { lojaId: "loja-1", modo: "autonomo", services };

async function main() {
  const ajuda = await executarTool("sistema.ajuda", {}, ctx);
  assert.strictEqual(ajuda.ok, true);
  assert.ok(ajuda.resumo.length > 0);
  assert.strictEqual(ajuda.reversivel, false);

  const eco = await executarTool("sistema.ajuda", { pergunta: "como sangrar" }, ctx);
  assert.strictEqual(eco.ok, true);
  assert.ok(eco.resumo.includes("como sangrar"));

  const busca = await executarTool("produto.buscar", { termo: "Cafe" }, ctx);
  assert.strictEqual(busca.ok, true);
  assert.deepStrictEqual(chamadas.at(-1), ["buscar", { termo: "Cafe" }]);

  const upd = await executarTool(
    "produto.atualizar",
    { produtoId: "p1", preco: 12 },
    ctx
  );
  assert.strictEqual(upd.ok, true);
  assert.strictEqual(upd.before.preco, 10);
  assert.strictEqual(upd.after.preco, 12);
  assert.strictEqual(upd.reversivel, true);
  assert.strictEqual(db.produtos.p1.preco, 12);

  const extra = await executarTool(
    "produto.atualizar",
    {
      produtoId: "p1",
      preco: 15,
      custo: 4.5,
      codigoBarras: "789",
      precoPromocao: 9,
      promoInicio: "2026-01-01",
      promoFim: "2026-02-01",
    },
    ctx
  );
  assert.strictEqual(extra.ok, true);
  assert.deepStrictEqual(chamadas.at(-1), [
    "atualizar",
    { produtoId: "p1", preco: 15 },
  ]);

  const semBefore = await executarTool("caixa.sangria", { valor: 20 }, ctx);
  assert.strictEqual(semBefore.ok, true);
  assert.strictEqual(semBefore.reversivel, false);
  assert.strictEqual(semBefore.after.valor, 20);

  const canc = await executarTool("venda.cancelar", { vendaId: "v1" }, ctx);
  assert.strictEqual(canc.ok, true);
  assert.strictEqual(canc.reversivel, true);

  const fecha = await executarTool("caixa.fechar", {}, ctx);
  assert.strictEqual(fecha.ok, true);
  assert.strictEqual(fecha.resumo, "caixa fechado");

  const desconhecida = await executarTool("nao.existe", {}, ctx);
  assert.deepStrictEqual(desconhecida, { ok: false, resumo: "tool_desconhecida" });

  const falta = await executarTool("produto.atualizar", {}, ctx);
  assert.strictEqual(falta.ok, false);
  assert.ok(!chamadas.some((c) => c[0] === "atualizar" && c[1].produtoId == null));

  console.log("ok tools");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
