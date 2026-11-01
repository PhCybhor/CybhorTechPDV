"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  prepararPayloadTexto,
  limparOverflow,
  sanitizarMensagemCliente,
} = require("../electron/overflowTexto");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cybhor-ov-"));
const curto = prepararPayloadTexto({
  texto: "abc",
  limiteChars: 100,
  dirTemp: dir,
});
assert.strictEqual(curto.usouArquivo, false);
assert.strictEqual(curto.arquivoPath, null);

const longo = "x".repeat(500);
const prep = prepararPayloadTexto({
  texto: longo,
  limiteChars: 100,
  dirTemp: dir,
});
assert.strictEqual(prep.usouArquivo, true);
assert.ok(prep.arquivoPath);
assert.ok(fs.existsSync(prep.arquivoPath));
assert.ok(prep.textoInline.includes(prep.arquivoPath) || prep.textoInline.length <= 100);

limparOverflow(prep.arquivoPath);
assert.ok(!fs.existsSync(prep.arquivoPath));
fs.rmSync(dir, { recursive: true, force: true });
console.log("ok overflow");

const vazada =
  "EACCES: permission denied, open '/tmp/ov-rev/cybhor-ia-deadbeef.txt'";
assert.strictEqual(
  sanitizarMensagemCliente(vazada),
  "Não foi possível falar com a IA."
);
assert.strictEqual(
  sanitizarMensagemCliente("EACCES: permission denied, mkdir '/tmp/cybhor-ov'"),
  "Não foi possível falar com a IA."
);
assert.strictEqual(
  sanitizarMensagemCliente("open 'C:\\Temp\\cybhor-ia-abc.txt'"),
  "Não foi possível falar com a IA."
);
assert.strictEqual(
  sanitizarMensagemCliente("Falha na API Gemini (HTTP 503)."),
  "Falha na API Gemini (HTTP 503)."
);
assert.strictEqual(
  sanitizarMensagemCliente("timeout", "/tmp/cybhor-ia-abc.txt"),
  "timeout"
);
assert.strictEqual(
  sanitizarMensagemCliente(""),
  "Não foi possível falar com a IA."
);

const dirMkdir = fs.mkdtempSync(path.join(os.tmpdir(), "cybhor-ov-mkdir-"));
const arquivoComoDir = path.join(dirMkdir, "nao-dir");
fs.writeFileSync(arquivoComoDir, "x");
try {
  prepararPayloadTexto({
    texto: "q".repeat(20),
    limiteChars: 5,
    dirTemp: arquivoComoDir,
  });
  assert.fail("mkdir deveria falhar");
} catch (erro) {
  assert.strictEqual(erro.message, "Não foi possível preparar o texto.");
  assert.ok(!erro.message.includes(arquivoComoDir));
  assert.ok(!/cybhor-ia-/i.test(erro.message));
  assert.ok(!erro.arquivoOverflow);
}
fs.rmSync(dirMkdir, { recursive: true, force: true });

const dirFalha = fs.mkdtempSync(path.join(os.tmpdir(), "cybhor-ov-fail-"));
const escrever = fs.writeFileSync;
fs.writeFileSync = (alvo, dados, enc) => {
  if (String(alvo).includes("cybhor-ia-")) {
    escrever.call(fs, alvo, dados, enc);
    const falha = new Error(`ENOSPC: no space left on device, write '${alvo}'`);
    falha.code = "ENOSPC";
    falha.path = alvo;
    throw falha;
  }
  return escrever.call(fs, alvo, dados, enc);
};
try {
  prepararPayloadTexto({
    texto: "z".repeat(50),
    limiteChars: 10,
    dirTemp: dirFalha,
  });
  assert.fail("escrita deveria falhar");
} catch (erro) {
  assert.strictEqual(erro.message, "Não foi possível preparar o texto.");
  assert.ok(!/cybhor-ia-/i.test(erro.message));
  assert.ok(!erro.message.includes(dirFalha));
  assert.ok(erro.arquivoOverflow);
  assert.ok(String(erro.arquivoOverflow).includes("cybhor-ia-"));
  assert.ok(!fs.existsSync(erro.arquivoOverflow));
  assert.strictEqual(
    fs.readdirSync(dirFalha).filter((nome) => nome.startsWith("cybhor-ia-")).length,
    0
  );
} finally {
  fs.writeFileSync = escrever;
  fs.rmSync(dirFalha, { recursive: true, force: true });
}
console.log("ok sanitizacao");

async function testarClienteSemElectron() {
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "teste-local";
  const { consultarAssistente } = require("../electron/assistenteGemini");
  const ler = fs.readFileSync;
  let caminhoLido = null;
  fs.readFileSync = (alvo, enc) => {
    if (String(alvo).includes("cybhor-ia-")) {
      caminhoLido = alvo;
      const falha = new Error(`EACCES: permission denied, open '${alvo}'`);
      falha.code = "EACCES";
      falha.path = alvo;
      throw falha;
    }
    return ler.call(fs, alvo, enc);
  };
  try {
    const resposta = await consultarAssistente({
      modo: "livre",
      mensagem: "y".repeat(4500),
    });
    assert.strictEqual(resposta.ok, false);
    assert.strictEqual(resposta.mensagem, "Não foi possível falar com a IA.");
    assert.ok(caminhoLido);
    assert.ok(!resposta.mensagem.includes(caminhoLido));
    assert.ok(!/cybhor-ia-/i.test(resposta.mensagem));
    assert.ok(!fs.existsSync(caminhoLido));
  } finally {
    fs.readFileSync = ler;
  }

  let criado = null;
  fs.writeFileSync = (alvo, dados, enc) => {
    if (String(alvo).includes("cybhor-ia-")) {
      escrever.call(fs, alvo, dados, enc);
      criado = alvo;
      const falha = new Error(`ENOSPC: no space left on device, write '${alvo}'`);
      falha.code = "ENOSPC";
      falha.path = alvo;
      throw falha;
    }
    return escrever.call(fs, alvo, dados, enc);
  };
  try {
    const resposta = await consultarAssistente({
      modo: "livre",
      mensagem: "w".repeat(4500),
    });
    assert.strictEqual(resposta.ok, false);
    assert.strictEqual(resposta.mensagem, "Não foi possível preparar o texto.");
    assert.ok(criado);
    assert.ok(!/cybhor-ia-/i.test(resposta.mensagem));
    assert.ok(!resposta.mensagem.includes(criado));
    assert.ok(!fs.existsSync(criado));
  } finally {
    fs.writeFileSync = escrever;
  }
}

testarClienteSemElectron()
  .then(() => {
    console.log("ok cliente");
  })
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  });
