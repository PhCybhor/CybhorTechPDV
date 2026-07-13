#!/usr/bin/env node
"use strict";

/**
 * Simula a impressao JP-800 no Linux (como o Exemplo Delphi faria no Windows),
 * gerando o mesmo buffer ESC/POS RAW e validando comandos do TP650.pas.
 *
 * Uso:
 *   node scripts/testar-impressao-jp800.mjs
 *   IMPRESSORA_MODO=teste node scripts/testar-impressao-jp800.mjs
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const raiz = path.join(__dirname, "..");
const { gerarBufferEscPos, cortarPapel, inicializar } = require(
  path.join(raiz, "electron/impressao/escpos.js")
);

const vendaFake = {
  id: "testeJP800abc123",
  itens: [
    {
      nome: "Produto Teste A",
      quantidade: 2,
      precoUnitario: 10.5,
      subtotal: 21,
    },
    {
      nome: "Produto Teste B com nome bem longo para quebrar linha",
      quantidade: 1,
      precoUnitario: 3.99,
      subtotal: 3.99,
    },
  ],
  subtotal: 24.99,
  desconto: 1,
  total: 23.99,
  formaPagamento: "dinheiro",
  funcionarioNome: "Operador Teste",
  criadoEm: Date.now(),
  valorRecebido: 50,
  troco: 26.01,
};

const loja = {
  nome: process.env.LOJA_NOME || "Loja Teste Cybhor",
  cnpj: process.env.LOJA_CNPJ || "00.000.000/0001-00",
  endereco: process.env.LOJA_ENDERECO || "Rua Exemplo, 100",
  telefone: process.env.LOJA_TELEFONE || "(11) 99999-0000",
};

const buffer = gerarBufferEscPos(vendaFake, loja);
const pasta = path.join(os.tmpdir(), "cybhor-jp800-teste");
fs.mkdirSync(pasta, { recursive: true });

const stamp = Date.now();
const arquivoBin = path.join(pasta, `cupom-teste-${stamp}.bin`);
const arquivoTxt = path.join(pasta, `cupom-teste-${stamp}.txt`);
fs.writeFileSync(arquivoBin, buffer);
fs.writeFileSync(
  arquivoTxt,
  buffer
    .toString("latin1")
    .replace(/\x1b/g, "<ESC>")
    .replace(/\x1d/g, "<GS>"),
  "utf8"
);

const corte = cortarPapel();
const init = inicializar();
const temInit = buffer.includes(init);
const temCorte = buffer.includes(corte);
const temTotal = buffer.toString("latin1").includes("TOTAL");

console.log("=== Teste ESC/POS JP-800 (protocolo Exemplo Delphi / TP650) ===");
console.log(`Bytes gerados: ${buffer.length}`);
console.log(`Init ESC @:   ${temInit ? "OK" : "FALHOU"}`);
console.log(`Corte ESC m:  ${temCorte ? "OK" : "FALHOU"}`);
console.log(`Texto TOTAL:  ${temTotal ? "OK" : "FALHOU"}`);
console.log(`BIN:  ${arquivoBin}`);
console.log(`TXT:  ${arquivoTxt}`);
console.log("");
console.log("--- Previa (primeiros 500 chars legiveis) ---");
console.log(fs.readFileSync(arquivoTxt, "utf8").slice(0, 500));
console.log("");

const vendor = path.join(raiz, "vendor/jp800");
const driver = path.join(vendor, "Driver_Utilitarios_JP-800");
const exemplo = path.join(vendor, "Exemplo_JP800_Delphi");
console.log("Materiais JP-800:");
console.log(
  `  Driver/Utilitarios: ${fs.existsSync(driver) ? "OK -> " + driver : "AUSENTE"}`
);
console.log(
  `  Exemplo Delphi:     ${fs.existsSync(exemplo) ? "OK -> " + exemplo : "AUSENTE"}`
);
console.log("");
console.log("No Windows real:");
console.log("  1) Rode vendor/jp800/Driver_Utilitarios_JP-800/JetwayPrinterDriverJP-800.exe");
console.log("  2) Confirme impressora 'Jetway JP-800' em Dispositivos e impressoras");
console.log("  3) (Opcional) Abra JetwayPrinterTool/PrinterTool.exe para teste USB");
console.log("  4) (Opcional) Win32/Release/ExemploJP800.exe do exemplo Delphi");
console.log("  5) No .env: IMPRESSORA_NOME=Jetway JP-800");
console.log("  6) npm start e finalize uma venda");

if (!temInit || !temCorte || !temTotal) {
  process.exit(1);
}
