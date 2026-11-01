"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { criarRagStore } = require("../electron/ragStore");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cybhor-rag-"));
const rag = criarRagStore({ dir });

rag.indexarDocumentos([
  {
    id: "venda-cancelar",
    texto: "Para cancelar venda aberta, use cancelar venda no caixa antes do fechamento.",
    fonte: "docs-pdv",
  },
  {
    id: "sangria",
    texto: "Sangria retira dinheiro do caixa durante o expediente.",
    fonte: "docs-pdv",
    lojaId: "loja-a",
  },
]);

const hits = rag.buscar("cancelar venda", { k: 6 });
assert.ok(hits.length >= 1);
assert.ok(hits.some((h) => /cancelar venda/i.test(h.texto)));
assert.strictEqual(hits[0].id, "venda-cancelar");
assert.strictEqual(typeof hits[0].score, "number");
assert.strictEqual(hits[0].fonte, "docs-pdv");

const ctx = rag.montarContexto("cancelar venda");
assert.ok(/cancelar venda/i.test(ctx));
assert.ok(ctx.length <= 6000);

const curto = rag.montarContexto("cancelar venda", { maxChars: 24 });
assert.ok(curto.length <= 24);
assert.ok(curto.length > 0);

const soLoja = rag.buscar("sangria", { lojaId: "loja-b" });
assert.ok(!soLoja.some((h) => h.id === "sangria"));

rag.indexarChat({
  id: "chat-1",
  texto: "Operador perguntou como cancelar venda no PDV.",
  lojaId: "loja-a",
});
const recarregado = criarRagStore({ dir });
const deNovo = recarregado.buscar("cancelar venda", { k: 6 });
assert.ok(deNovo.some((h) => h.id === "venda-cancelar"));
assert.ok(deNovo.some((h) => h.id === "chat-1"));

const gravado = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
assert.ok(Array.isArray(gravado));
assert.ok(gravado.length >= 2);
assert.ok(gravado.every((c) => c.id && c.texto && c.fonte && c.ts));

fs.rmSync(dir, { recursive: true, force: true });
console.log("ok rag");
