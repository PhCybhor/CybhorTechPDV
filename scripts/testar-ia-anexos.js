"use strict";

const assert = require("assert");
const { reconhecerBackupCybhor } = require("../electron/iaAnexos");

async function main() {
  assert.strictEqual(reconhecerBackupCybhor({ app: "CybhorPDV", versao: 2 }).ok, true);
  assert.strictEqual(reconhecerBackupCybhor({ app: "Operar", versao: 2 }).ok, true);
  assert.strictEqual(reconhecerBackupCybhor({ app: "Outro" }).ok, false);
  assert.strictEqual(reconhecerBackupCybhor("Operar").ok, false);
  assert.strictEqual(reconhecerBackupCybhor("{").ok, false);
  assert.strictEqual(reconhecerBackupCybhor(null).ok, false);
  assert.strictEqual(reconhecerBackupCybhor(1).ok, false);
  assert.strictEqual(reconhecerBackupCybhor([]).ok, false);

  const { montarBackupLoja } = await import("../renderer/js/services/backupService.js");
  const gerado = montarBackupLoja({ lojaNome: "Loja", produtos: [] });
  const gravado = JSON.parse(await gerado.blob.text());
  assert.strictEqual(gravado.app, "Operar");
  assert.strictEqual(reconhecerBackupCybhor(gravado).ok, true);
  assert.strictEqual(reconhecerBackupCybhor(JSON.stringify(gravado)).ok, true);

  console.log("ok anexos");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
