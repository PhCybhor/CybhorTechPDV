import assert from "node:assert/strict";
import {
  NOME_PRODUTO,
  NOME_PRODUTO_COMPLETO,
  TAGLINE,
  APP_BACKUP_ATUAL,
  appBackupValido,
} from "../renderer/js/config/marcaProduto.js";

assert.equal(NOME_PRODUTO, "Operar");
assert.equal(NOME_PRODUTO_COMPLETO, "Operar by Cybhor");
assert.match(TAGLINE, /loja inteira/i);
assert.equal(APP_BACKUP_ATUAL, "Operar");
assert.equal(appBackupValido("Operar"), true);
assert.equal(appBackupValido("CybhorPDV"), true);
assert.equal(appBackupValido("Outro"), false);
console.log("ok: marcaProduto");
