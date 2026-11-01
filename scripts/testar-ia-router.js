"use strict";
const assert = require("assert");
const { MODES_SYSTEM, consultarAssistente } = require("../electron/assistenteGemini");

async function testarClienteOllama() {
  const { consultarOllama } = require("../electron/assistenteLocal");
  const modeloAnterior = process.env.OLLAMA_MODEL;
  delete process.env.OLLAMA_MODEL;

  let chamada = null;
  const resposta = await consultarOllama({
    mensagem: "quanto vendi",
    system: "seja breve",
    requisitarJson: async (url, opcoes) => {
      chamada = { url, opcoes };
      return {
        ok: true,
        status: 200,
        dados: { message: { role: "assistant", content: "resposta local" } },
      };
    },
  });

  if (modeloAnterior === undefined) delete process.env.OLLAMA_MODEL;
  else process.env.OLLAMA_MODEL = modeloAnterior;

  assert.strictEqual(resposta.ok, true);
  assert.strictEqual(resposta.texto, "resposta local");
  assert.ok(chamada);
  assert.strictEqual(chamada.url, "http://127.0.0.1:11434/api/chat");
  assert.strictEqual(chamada.opcoes.method, "POST");
  const corpo = JSON.parse(chamada.opcoes.body);
  assert.strictEqual(corpo.model, "llama3.2:3b");
  assert.strictEqual(corpo.stream, false);
  assert.deepStrictEqual(corpo.messages, [
    { role: "system", content: "seja breve" },
    { role: "user", content: "quanto vendi" },
  ]);

  const falha = await consultarOllama({
    mensagem: "oi",
    baseUrl: "http://127.0.0.1:11434/",
    modelo: "llama3.2:1b",
    requisitarJson: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  assert.strictEqual(falha.ok, false);
  assert.ok(falha.mensagem);
  assert.ok(!falha.texto);
}

async function testarRouter() {
  const { consultarComRouter } = require("../electron/assistenteRouter");
  const payload = { modo: "livre", mensagem: "oi loja" };

  let ollama = 0;
  let gemini = 0;
  const semLocal = await consultarComRouter({
    payload,
    hardware: { localOk: false, motivo: "ollama_indisponivel" },
    providers: {
      consultarOllama: async () => {
        ollama += 1;
        return { ok: true, texto: "nao deveria" };
      },
      consultarGemini: async (entrada) => {
        gemini += 1;
        assert.strictEqual(entrada, payload);
        return { ok: true, texto: "nuvem" };
      },
    },
  });
  assert.strictEqual(ollama, 0);
  assert.strictEqual(gemini, 1);
  assert.deepStrictEqual(semLocal, { ok: true, texto: "nuvem" });

  ollama = 0;
  gemini = 0;
  const caiu = await consultarComRouter({
    payload,
    hardware: { localOk: true },
    providers: {
      consultarOllama: async (entrada) => {
        ollama += 1;
        assert.strictEqual(entrada.mensagem, payload.mensagem);
        assert.strictEqual(entrada.system, MODES_SYSTEM.livre);
        return { ok: false, mensagem: "caiu" };
      },
      consultarGemini: async (entrada) => {
        gemini += 1;
        assert.strictEqual(entrada, payload);
        return { ok: true, texto: "fallback" };
      },
    },
  });
  assert.strictEqual(ollama, 1);
  assert.strictEqual(gemini, 1);
  assert.deepStrictEqual(caiu, { ok: true, texto: "fallback" });

  ollama = 0;
  gemini = 0;
  const local = await consultarComRouter({
    payload,
    hardware: { localOk: true },
    providers: {
      consultarOllama: async () => {
        ollama += 1;
        return { ok: true, texto: "local ok" };
      },
      consultarGemini: async () => {
        gemini += 1;
        return { ok: true, texto: "nao" };
      },
    },
  });
  assert.strictEqual(ollama, 1);
  assert.strictEqual(gemini, 0);
  assert.deepStrictEqual(local, { ok: true, texto: "local ok" });

  gemini = 0;
  const estourou = await consultarComRouter({
    payload,
    hardware: { localOk: true, motivo: "ok" },
    providers: {
      consultarOllama: async () => {
        throw new Error("ram_livre_1.0gb");
      },
      consultarGemini: async () => {
        gemini += 1;
        return { ok: true, texto: "gemini apos throw" };
      },
    },
  });
  assert.strictEqual(gemini, 1);
  assert.strictEqual(estourou.texto, "gemini apos throw");
}

async function main() {
  assert.strictEqual(typeof consultarAssistente, "function");
  assert.ok(MODES_SYSTEM && typeof MODES_SYSTEM.livre === "string");
  await testarClienteOllama();
  await testarRouter();
  console.log("ok router");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
