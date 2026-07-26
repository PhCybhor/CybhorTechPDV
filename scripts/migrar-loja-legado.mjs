/**
 * Migra dados da raiz legada (funcionarios/produtos/vendas)
 * para lojas/{lojaId}/… sem apagar a origem.
 *
 * Uso:
 *   node scripts/migrar-loja-legado.mjs --lojaId=<uuid>
 *   node scripts/migrar-loja-legado.mjs --lojaId=auto --nome="Minha Loja"
 *
 * Requer .env com FIREBASE_DATABASE_URL e um dos:
 *   FIREBASE_SERVICE_ACCOUNT_FILE=./serviceAccount.json
 *   FIREBASE_SERVICE_ACCOUNT_JSON='{...}'
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = resolve(__dirname, "..");

function carregarEnv() {
  const envPath = resolve(raiz, ".env");
  if (!existsSync(envPath)) return;
  require("dotenv").config({ path: envPath });
}

function arg(nome, padrao = null) {
  const prefixo = `--${nome}=`;
  const hit = process.argv.find((a) => a.startsWith(prefixo));
  return hit ? hit.slice(prefixo.length) : padrao;
}

carregarEnv();

const admin = require("firebase-admin");
const databaseURL = process.env.FIREBASE_DATABASE_URL;
if (!databaseURL) {
  console.error("FIREBASE_DATABASE_URL ausente no .env");
  process.exit(1);
}

let credential;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  credential = admin.credential.cert(
    JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  );
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_FILE) {
  credential = admin.credential.cert(
    require(resolve(process.env.FIREBASE_SERVICE_ACCOUNT_FILE))
  );
} else {
  const local = resolve(raiz, "serviceAccount.json");
  if (existsSync(local)) {
    credential = admin.credential.cert(require(local));
  } else {
    console.error(
      "Configure FIREBASE_SERVICE_ACCOUNT_FILE ou serviceAccount.json na raiz."
    );
    process.exit(1);
  }
}

admin.initializeApp({ credential, databaseURL });
const db = admin.database();

const nomeLoja = arg("nome", "Loja migrada");
let lojaId = arg("lojaId");
if (!lojaId || lojaId === "auto") {
  lojaId = randomUUID();
}

async function copiarNo(origem, destino) {
  const snap = await db.ref(origem).get();
  if (!snap.exists()) {
    console.log(`(vazio) ${origem}`);
    return 0;
  }
  const valor = snap.val();
  await db.ref(destino).set(valor);
  const qtd = typeof valor === "object" ? Object.keys(valor).length : 1;
  console.log(`OK ${origem} → ${destino} (${qtd} itens)`);
  return qtd;
}

const agora = Date.now();
await db.ref(`lojas/${lojaId}/meta`).set({
  nome: nomeLoja,
  email: arg("email", ""),
  plano: "vitalicio",
  status: "ativa",
  criadaEm: agora,
  migradoDeLegado: true,
});

let total = 0;
total += await copiarNo("funcionarios", `lojas/${lojaId}/funcionarios`);
total += await copiarNo("produtos", `lojas/${lojaId}/produtos`);
total += await copiarNo("vendas", `lojas/${lojaId}/vendas`);

const chaveDev = `DEV-MIG-${createHash("sha256")
  .update(lojaId)
  .digest("hex")
  .slice(0, 8)
  .toUpperCase()}`;

console.log("\nMigração concluída.");
console.log(`lojaId: ${lojaId}`);
console.log(`Registros copiados (aprox.): ${total}`);
console.log(
  `\nNo .env do app (dev):\nCYBHOR_MODO_DEV=1\nCYBHOR_DEV_LOJA_ID=${lojaId}`
);
console.log(
  `Ative com a chave DEV-LOCAL após definir CYBHOR_DEV_LOJA_ID, ou use o servidor para emitir licença real.`
);
console.log(`(sugestão chave local) ${chaveDev}`);
process.exit(0);
