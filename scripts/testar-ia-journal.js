"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { criarJournal } = require("../electron/agentJournal");

const arquivo = path.join(os.tmpdir(), `cybhor-j-${Date.now()}.jsonl`);
const j = criarJournal(arquivo);
const e = j.registrar({
  modo: "autonomo",
  tool: "produto.atualizar",
  resumo: "preço X",
  before: { preco: 1 },
  after: { preco: 2 },
  reversivel: true,
});
assert.ok(e.id);
const lista = j.listar(10);
assert.strictEqual(lista[0].id, e.id);
assert.strictEqual(lista[0].before.preco, 1);
j.marcarDesfeito(e.id);
assert.strictEqual(j.obter(e.id).desfeito, true);
fs.unlinkSync(arquivo);
console.log("ok journal");
