"use strict";
const assert = require("assert");
const {
  COMANDOS_SERVICO,
  servicoDoComando,
  despacharComando,
  montarReversao,
  argsComandoSeguros,
  CHAVES_PRODUTO_ATUALIZAR,
  documentosDeSnapshotLoja,
} = require("../electron/iaComandoMapa");

assert.deepStrictEqual(Object.keys(COMANDOS_SERVICO), [
  "produto.buscar",
  "produto.atualizar",
  "venda.cancelar",
  "caixa.sangria",
  "caixa.fechar",
  "navegacao.abrirRota",
]);
assert.strictEqual(servicoDoComando("produto.buscar"), "buscarProduto");
assert.strictEqual(servicoDoComando("caixa.fechar"), "fecharCaixa");
assert.strictEqual(servicoDoComando("navegacao.abrirRota"), "abrirRota");
assert.strictEqual(servicoDoComando("sistema.ajuda"), null);

const chamadas = [];
const handlers = {
  async buscarProduto(args) {
    chamadas.push(["buscar", args.termo]);
    return { ok: true, resumo: "achei", reversivel: false };
  },
  async atualizarProduto(args) {
    chamadas.push(["atualizar", args.produtoId, args.preco]);
    return {
      ok: true,
      resumo: "produto atualizado",
      before: { id: args.produtoId, nome: "Cafe", preco: 10, estoque: 4 },
      after: { id: args.produtoId, nome: "Cafe", preco: args.preco, estoque: 4 },
      reversivel: true,
    };
  },
};

async function main() {
  const busca = await despacharComando("produto.buscar", { termo: "Cafe" }, handlers);
  assert.strictEqual(busca.ok, true);
  assert.deepStrictEqual(chamadas[0], ["buscar", "Cafe"]);

  const upd = await despacharComando(
    "produto.atualizar",
    { produtoId: "p1", preco: 12 },
    handlers
  );
  assert.strictEqual(upd.reversivel, true);
  assert.strictEqual(upd.before.preco, 10);

  const sumiu = await despacharComando("venda.cancelar", { vendaId: "v1" }, handlers);
  assert.strictEqual(sumiu.ok, false);
  assert.strictEqual(sumiu.resumo, "comando sem handler");

  const estranho = await despacharComando("loja.apagar", {}, handlers);
  assert.strictEqual(estranho.ok, false);
  assert.ok(estranho.resumo.startsWith("comando desconhecido"));

  const reversao = montarReversao({
    tool: "produto.atualizar",
    reversivel: true,
    before: { id: "p1", nome: "Cafe", preco: 10, estoque: 4, senha: "nao" },
  });
  assert.strictEqual(reversao.comando, "produto.atualizar");
  assert.strictEqual(reversao.args.produtoId, "p1");
  assert.strictEqual(reversao.args.preco, 10);
  assert.strictEqual(reversao.args.senha, undefined);

  assert.strictEqual(
    montarReversao({ tool: "caixa.sangria", reversivel: true, before: { valor: 10 } }),
    null
  );
  assert.strictEqual(
    montarReversao({ tool: "produto.atualizar", reversivel: false, before: { id: "p1" } }),
    null
  );

  const seguros = argsComandoSeguros({
    produtoId: "p1",
    preco: 12,
    senha: "segredo",
    email: "a@b.c",
  });
  assert.strictEqual(seguros.produtoId, "p1");
  assert.strictEqual(seguros.preco, 12);
  assert.strictEqual(seguros.senha, undefined);
  assert.strictEqual(seguros.email, undefined);

  assert.deepStrictEqual([...CHAVES_PRODUTO_ATUALIZAR], [
    "produtoId",
    "nome",
    "preco",
    "estoque",
  ]);
  const atualizar = argsComandoSeguros(
    {
      produtoId: "p1",
      nome: "Cafe",
      preco: 12,
      estoque: 3,
      custo: 4.5,
      codigoBarras: "789",
      codigoInterno: "INT",
      categoria: "bebida",
      precoPromocao: 9,
      promoInicio: "2026-01-01",
      promoFim: "2026-02-01",
      unidade: "un",
      senha: "segredo",
    },
    "produto.atualizar"
  );
  assert.deepStrictEqual(atualizar, {
    produtoId: "p1",
    nome: "Cafe",
    preco: 12,
    estoque: 3,
  });

  const docs = documentosDeSnapshotLoja({
    lojaId: "loja-1",
    email: "secreto@loja.test",
    senha: "x",
    produtos: [
      { nome: "Cafe", preco: 10, estoque: 2, categoria: "bebida", telefone: "11999999999" },
    ],
    estoqueBaixo: [{ nome: "Cafe", estoque: 2, whatsapp: "11888888888" }],
  });
  assert.strictEqual(docs.length, 2);
  assert.strictEqual(docs[0].id, "loja-loja-1-produtos");
  assert.strictEqual(docs[0].fonte, "loja");
  assert.strictEqual(docs[0].lojaId, "loja-1");
  assert.ok(docs[0].texto.includes("Cafe"));
  assert.strictEqual(docs[1].id, "loja-loja-1-estoque-baixo");
  const texto = JSON.stringify(docs);
  assert.ok(!texto.includes("secreto@loja.test"));
  assert.ok(!texto.includes("11999999999"));
  assert.ok(!texto.includes("11888888888"));
  assert.deepStrictEqual(documentosDeSnapshotLoja({}), []);

  console.log("ok comandos");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
