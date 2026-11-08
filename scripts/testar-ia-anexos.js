"use strict";

const assert = require("assert");
const {
  detectarTipo,
  reconhecerBackupCybhor,
  extrairTextoDeBuffer,
  montarChunksAnexo,
  MAX_DOC_BYTES,
  MAX_AUDIO_BYTES,
} = require("../electron/iaAnexos");

async function main() {
  assert.strictEqual(detectarTipo("a.txt"), "txt");
  assert.strictEqual(detectarTipo("b.JSON"), "json");
  assert.strictEqual(detectarTipo("c.wav"), "audio");
  assert.strictEqual(detectarTipo("d.bin"), "desconhecido");

  assert.strictEqual(reconhecerBackupCybhor({ app: "CybhorPDV", versao: 2 }).ok, true);
  assert.strictEqual(reconhecerBackupCybhor({ app: "Operar", versao: 2 }).ok, true);
  assert.strictEqual(reconhecerBackupCybhor({ app: "Outro" }).ok, false);
  assert.strictEqual(reconhecerBackupCybhor("{").ok, false);

  const txt = await extrairTextoDeBuffer({
    nomeArquivo: "nota.txt",
    buffer: Buffer.from("conteudo do documento de teste", "utf8"),
  });
  assert.strictEqual(txt.ok, true);
  assert.strictEqual(txt.tipo, "txt");
  assert.ok(txt.texto.includes("documento"));

  const backup = {
    app: "CybhorPDV",
    versao: 2,
    produtos: [{ nome: "Cafe", preco: 10, estoque: 2 }],
    vendas: [],
  };
  const json = await extrairTextoDeBuffer({
    nomeArquivo: "backup.json",
    buffer: Buffer.from(JSON.stringify(backup), "utf8"),
  });
  assert.strictEqual(json.ok, true);
  assert.strictEqual(json.tipo, "json");
  assert.ok(json.backupCybhor);
  assert.strictEqual(json.backupCybhor.produtos.length, 1);

  const binario = Buffer.alloc(4096, 0);
  binario.write("xxxx", 0);
  const cripto = await extrairTextoDeBuffer({
    nomeArquivo: "segredo.bin",
    buffer: binario,
  });
  assert.strictEqual(cripto.ok, false);
  assert.ok(/criptograf|descriptograf|não|nao/i.test(cripto.erro || ""));

  const grande = Buffer.alloc(MAX_DOC_BYTES + 1, 65);
  const estoura = await extrairTextoDeBuffer({
    nomeArquivo: "grande.txt",
    buffer: grande,
  });
  assert.strictEqual(estoura.ok, false);
  assert.ok(/grande/i.test(estoura.erro || ""));

  const audio = await extrairTextoDeBuffer({
    nomeArquivo: "voz.wav",
    buffer: Buffer.from("RIFF"),
  });
  assert.strictEqual(audio.ok, false);
  assert.strictEqual(audio.tipo, "audio");

  const chunks = montarChunksAnexo({
    texto: "a".repeat(2500),
    nomeArquivo: "x.txt",
    lojaId: "loja-1",
  });
  assert.ok(chunks.length >= 2);
  assert.strictEqual(chunks[0].fonte, "anexo");
  assert.strictEqual(chunks[0].lojaId, "loja-1");
  assert.ok(MAX_AUDIO_BYTES > MAX_DOC_BYTES);

  const { montarBackupLoja } = await import("../renderer/js/services/backupService.js");
  const gerado = montarBackupLoja({ lojaNome: "Loja", produtos: [] });
  const gravado = JSON.parse(await gerado.blob.text());
  assert.strictEqual(gravado.app, "Operar");
  assert.strictEqual(reconhecerBackupCybhor(gravado).ok, true);

  const { executarComandoLoja } = await import("../renderer/js/services/iaComandos.js");
  const legado = await executarComandoLoja(
    "backup.importar",
    { json: JSON.stringify({ app: "CybhorPDV", produtos: [] }) },
    {}
  );
  assert.strictEqual(legado.ok, true);
  const novo = await executarComandoLoja(
    "backup.importar",
    { json: JSON.stringify({ app: "Operar", produtos: [] }) },
    {}
  );
  assert.strictEqual(novo.ok, true);
  const outro = await executarComandoLoja(
    "backup.importar",
    { json: JSON.stringify({ app: "Outro", produtos: [] }) },
    {}
  );
  assert.strictEqual(outro.ok, false);

  console.log("ok anexos");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
