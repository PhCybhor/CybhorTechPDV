#!/usr/bin/env node
"use strict";

/**
 * Teste de impressão no Windows (CI): compara o modo antigo (um PowerShell por
 * cupom) com o servidor aquecido e confere byte a byte o que chegou à fila.
 *
 * Variáveis:
 *   IMPRESSORA_TESTE         impressora RAW de teste (porta gravando em arquivo)
 *   IMPRESSORA_TESTE_ACENTO  segunda impressora, nome com apóstrofo/acento (mesma porta)
 *   IMPRESSORA_TESTE_SAIDA   arquivo da porta local dessas impressoras
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const raiz = path.join(__dirname, "..");
const servidor = require(path.join(raiz, "electron/impressao/servidorImpressao.js"));
const { gerarBufferEscPos } = require(path.join(raiz, "electron/impressao/escpos.js"));
const { escolherImpressora } = require(path.join(raiz, "electron/impressao/deteccaoImpressora.js"));

const IMPRESSORA = process.env.IMPRESSORA_TESTE;
const IMPRESSORA_ACENTO = process.env.IMPRESSORA_TESTE_ACENTO;
const SAIDA = process.env.IMPRESSORA_TESTE_SAIDA;
const REPETICOES = 5;

const venda = {
  id: "teste-ci-impressao",
  itens: [
    { nome: "Pão de queijo", quantidade: 3, precoUnitario: 2.5, subtotal: 7.5 },
    { nome: "Café coado", quantidade: 1, precoUnitario: 4.9, subtotal: 4.9 },
  ],
  subtotal: 12.4,
  desconto: 0,
  total: 12.4,
  formaPagamento: "dinheiro",
  valorRecebido: 20,
  troco: 7.6,
};
const loja = { nome: "Loja Teste CI", cnpj: "", endereco: "", telefone: "" };

const falhas = [];
const verificar = (condicao, mensagem) => {
  if (!condicao) falhas.push(mensagem);
  console.log(`${condicao ? "ok  " : "FALHA"} ${mensagem}`);
};

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function cronometrar(acao) {
  const inicio = process.hrtime.bigint();
  const resultado = await acao();
  return { resultado, ms: Number(process.hrtime.bigint() - inicio) / 1e6 };
}

/** O spooler grava na porta depois que o job é aceito; espera o arquivo bater. */
async function aguardarSaida(esperado) {
  for (let tentativa = 0; tentativa < 100; tentativa += 1) {
    try {
      const conteudo = fs.readFileSync(SAIDA);
      if (conteudo.equals(esperado)) return true;
    } catch (_) {
      /* ainda nao gravado */
    }
    await dormir(100);
  }
  return false;
}

function limparSaida() {
  try {
    fs.unlinkSync(SAIDA);
  } catch (_) {
    /* nao existe */
  }
}

function imprimirModoAntigo(nome, buffer) {
  const arquivo = path.join(os.tmpdir(), `cybhor-ci-${Date.now()}.bin`);
  fs.writeFileSync(arquivo, buffer);
  return new Promise((resolve) => {
    const filho = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(raiz, "electron/impressao/RawPrint.ps1"),
        "-PrinterName",
        nome,
        "-FilePath",
        arquivo,
      ],
      { windowsHide: true }
    );
    let saida = "";
    filho.stdout.on("data", (dados) => {
      saida += dados.toString();
    });
    filho.on("close", (codigo) => {
      fs.unlinkSync(arquivo);
      resolve(codigo === 0 && saida.includes("OK:"));
    });
  });
}

const media = (lista) => lista.reduce((a, b) => a + b, 0) / lista.length;

async function main() {
  if (process.platform !== "win32" || !IMPRESSORA || !SAIDA) {
    console.error("Rode no Windows com IMPRESSORA_TESTE e IMPRESSORA_TESTE_SAIDA definidos.");
    process.exit(2);
  }
  const buffer = gerarBufferEscPos(venda, loja);
  console.log(`Cupom de teste: ${buffer.length} bytes\n`);

  const temposAntigo = [];
  for (let i = 0; i < 2; i += 1) {
    limparSaida();
    const { resultado, ms } = await cronometrar(() => imprimirModoAntigo(IMPRESSORA, buffer));
    temposAntigo.push(ms);
    verificar(resultado && (await aguardarSaida(buffer)), `modo antigo imprimiu (${ms.toFixed(0)} ms)`);
  }

  const inicio = await cronometrar(() => servidor.iniciar());
  console.log(`\nservidor iniciado em ${inicio.ms.toFixed(0)} ms (acontece na abertura do app)`);

  const lista = await servidor.listar();
  const daLista = lista.find((p) => p.name === IMPRESSORA);
  verificar(Boolean(daLista), "listar encontra a impressora de teste");
  verificar(
    daLista?.driver === "Generic / Text Only" && daLista?.workOffline === false,
    `listar traz driver e estado: ${JSON.stringify(daLista)}`
  );
  verificar(
    escolherImpressora(lista, "") === IMPRESSORA || escolherImpressora(lista, "") === IMPRESSORA_ACENTO,
    `deteccao automatica escolhe uma impressora termica de teste: ${escolherImpressora(lista, "")}`
  );

  const diagnostico = await cronometrar(() => servidor.diagnosticar(IMPRESSORA));
  verificar(
    /^STATUS=\d+;PORT=.+;WORKOFFLINE=False;STATE=\d+;EXT=\d+$/i.test(diagnostico.resultado),
    `diagnostico da impressora: ${diagnostico.resultado} (${diagnostico.ms.toFixed(0)} ms)`
  );
  verificar(
    (await servidor.diagnosticar("Impressora Que Nao Existe")) === "MISSING",
    "diagnostico de impressora inexistente devolve MISSING"
  );

  const temposServidor = [];
  for (let i = 0; i < REPETICOES; i += 1) {
    limparSaida();
    const { resultado, ms } = await cronometrar(() => servidor.imprimirRaw(IMPRESSORA, buffer));
    temposServidor.push(ms);
    verificar(
      resultado === `OK:${buffer.length}` && (await aguardarSaida(buffer)),
      `servidor imprimiu cupom ${i + 1} identico (${ms.toFixed(0)} ms)`
    );
  }

  if (IMPRESSORA_ACENTO) {
    verificar(
      /^STATUS=/.test(await servidor.diagnosticar(IMPRESSORA_ACENTO)),
      `diagnostico com apostrofo/acento: "${IMPRESSORA_ACENTO}"`
    );
    limparSaida();
    await servidor.imprimirRaw(IMPRESSORA_ACENTO, buffer);
    verificar(await aguardarSaida(buffer), "impressao com apostrofo/acento no nome");
  }

  try {
    await servidor.imprimirRaw("Impressora Que Nao Existe", buffer);
    verificar(false, "impressora inexistente deveria falhar");
  } catch (erro) {
    verificar(erro.codigo === "ERRO", `impressora inexistente falha com erro claro: ${erro.message}`);
  }
  verificar(
    (await servidor.diagnosticar(IMPRESSORA)).startsWith("STATUS="),
    "servidor continua respondendo depois de um erro"
  );

  servidor.encerrar();

  const antigo = media(temposAntigo);
  const novo = media(temposServidor) + diagnostico.ms;
  console.log("\n=== Tempo por cupom (diagnostico + envio) ===");
  console.log(`modo antigo : ${antigo.toFixed(0)} ms (sem contar o diagnostico, que era outro PowerShell)`);
  console.log(`servidor    : ${novo.toFixed(0)} ms`);
  console.log(`ganho       : ${(antigo / novo).toFixed(1)}x mais rapido`);
  verificar(novo < antigo, "servidor mais rapido que o modo antigo");

  if (falhas.length) {
    console.error(`\n${falhas.length} falha(s).`);
    process.exit(1);
  }
}

main().catch((erro) => {
  console.error(erro);
  servidor.encerrar();
  process.exit(1);
});
