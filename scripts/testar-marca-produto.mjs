import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  NOME_PRODUTO,
  NOME_PRODUTO_COMPLETO,
  TAGLINE,
  APP_BACKUP_ATUAL,
  APP_BACKUP_LEGADOS,
  appBackupValido,
} from "../renderer/js/config/marcaProduto.js";

const require = createRequire(import.meta.url);
const marcaCjs = require("../electron/marcaProduto.cjs");

assert.equal(NOME_PRODUTO, "Operar");
assert.equal(NOME_PRODUTO_COMPLETO, "Operar by Cybhor");
assert.match(TAGLINE, /loja inteira/i);
assert.equal(APP_BACKUP_ATUAL, "Operar");
assert.equal(appBackupValido("Operar"), true);
assert.equal(appBackupValido("CybhorPDV"), true);
assert.equal(appBackupValido("Outro"), false);

assert.equal(marcaCjs.NOME_PRODUTO, NOME_PRODUTO);
assert.equal(marcaCjs.NOME_PRODUTO_COMPLETO, NOME_PRODUTO_COMPLETO);
assert.equal(marcaCjs.TAGLINE, TAGLINE);
assert.equal(marcaCjs.APP_BACKUP_ATUAL, APP_BACKUP_ATUAL);
assert.deepEqual([...marcaCjs.APP_BACKUP_LEGADOS], [...APP_BACKUP_LEGADOS]);
for (const amostra of ["Operar", "CybhorPDV", "Outro", 1, null]) {
  assert.equal(marcaCjs.appBackupValido(amostra), appBackupValido(amostra));
}

console.log("ok: marcaProduto");
