#!/usr/bin/env node
"use strict";

/**
 * Migra os dados antigos da raiz (funcionarios/produtos/vendas) para o novo
 * formato multi-loja (lojas/{id}/...). Roda uma unica vez por banco.
 *
 * Uso:
 *   node scripts/migrar-para-loja.js "Nome da Loja"
 */

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const crypto = require("crypto");
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, get, update, push } = require("firebase/database");

const ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function gerarCodigo() {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes)
    .map((b) => ALFABETO[b % ALFABETO.length])
    .join("");
}

async function main() {
  const nomeLoja = (process.argv[2] || "").trim();
  if (nomeLoja.length < 2) {
    console.error('Uso: node scripts/migrar-para-loja.js "Nome da Loja"');
    process.exit(1);
  }

  const app = initializeApp({
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
  });
  const db = getDatabase(app);

  const [funcionarios, produtos, vendas] = await Promise.all([
    get(ref(db, "funcionarios")),
    get(ref(db, "produtos")),
    get(ref(db, "vendas")),
  ]);

  if (!funcionarios.exists() && !produtos.exists() && !vendas.exists()) {
    console.log("Nada para migrar: a raiz nao tem dados antigos.");
    process.exit(0);
  }

  const lojaId = push(ref(db, "lojas")).key;
  const codigo = gerarCodigo();

  const atualizacoes = {};
  atualizacoes[`lojas/${lojaId}/perfil`] = {
    nome: nomeLoja,
    cnpj: process.env.LOJA_CNPJ || "",
    endereco: process.env.LOJA_ENDERECO || "",
    telefone: process.env.LOJA_TELEFONE || "",
    codigo,
    criadoEm: Date.now(),
  };
  atualizacoes[`codigosLoja/${codigo}`] = lojaId;

  if (funcionarios.exists())
    atualizacoes[`lojas/${lojaId}/funcionarios`] = funcionarios.val();
  if (produtos.exists())
    atualizacoes[`lojas/${lojaId}/produtos`] = produtos.val();
  if (vendas.exists())
    atualizacoes[`lojas/${lojaId}/vendas`] = vendas.val();

  // Remove os dados antigos da raiz na mesma operacao atomica
  atualizacoes["funcionarios"] = null;
  atualizacoes["produtos"] = null;
  atualizacoes["vendas"] = null;

  await update(ref(db), atualizacoes);

  console.log("Migracao concluida.");
  console.log(`  Loja:   ${nomeLoja}`);
  console.log(`  ID:     ${lojaId}`);
  console.log(`  Codigo: ${codigo}  (use na tela "Ja tenho codigo" de cada caixa)`);
  process.exit(0);
}

main().catch((erro) => {
  console.error("Falha na migracao:", erro.message);
  process.exit(1);
});
