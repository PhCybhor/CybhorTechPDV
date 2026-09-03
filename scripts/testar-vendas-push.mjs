/**
 * Testa o contrato do push() (chave síncrona) e o mapeamento de vendas.
 * Uso: node scripts/testar-vendas-push.mjs
 */
import assert from "node:assert/strict";
import { push, ref } from "../renderer/js/config/databaseClient.js";

// Isola apiRequest (push sem valor não chama a API).
function mapearVendas(valor) {
  if (!valor) return [];
  if (Array.isArray(valor.itens) && valor.criadoEm != null && !valor.id) {
    return [{ id: "legado", ...valor }];
  }
  return Object.entries(valor)
    .filter(([, dados]) => dados && typeof dados === "object" && !Array.isArray(dados))
    .filter(([, dados]) => dados.criadoEm != null || Array.isArray(dados.itens))
    .map(([id, dados]) => ({ id, ...dados }));
}

const a = push(ref({}, "lojas/x/vendas"));
const b = push(ref({}, "lojas/x/vendas"));

assert.equal(typeof a.key, "string");
assert.equal(a.key.length, 32);
assert.notEqual(a.key, "undefined");
assert.notEqual(a.key, b.key);
assert.match(a.caminho, new RegExp(`^vendas/${a.key}$`));

// Simula o bug antigo: Promise sem await → key undefined
const promise = Promise.resolve({ key: "real" });
assert.equal(promise.key, undefined);

const vendas = mapearVendas({
  [a.key]: { itens: [], total: 10, criadoEm: 1 },
  [b.key]: { itens: [], total: 20, criadoEm: 2 },
  lixo: "nao-e-venda",
});
assert.equal(vendas.length, 2);
assert.deepEqual(
  vendas.map((v) => v.total).sort((x, y) => x - y),
  [10, 20]
);

const legado = mapearVendas({
  itens: [{ nome: "X" }],
  total: 5,
  criadoEm: 99,
});
assert.equal(legado.length, 1);
assert.equal(legado[0].id, "legado");

console.log("OK testar-vendas-push:", {
  keys: [a.key, b.key],
  vendas: vendas.length,
});
