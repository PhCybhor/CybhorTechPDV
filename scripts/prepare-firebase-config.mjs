import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, "..");
const caminhoEnv = path.join(raiz, ".env");
const caminhoSaida = path.join(raiz, "build", "firebase.config.json");

const CHAVES = [
  "FIREBASE_API_KEY",
  "FIREBASE_AUTH_DOMAIN",
  "FIREBASE_DATABASE_URL",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_MESSAGING_SENDER_ID",
  "FIREBASE_APP_ID",
  "FIREBASE_MEASUREMENT_ID",
];

/**
 * Le o arquivo .env e gera build/firebase.config.json para ser empacotado
 * dentro do instalador. O usuario final nunca precisa ver ou configurar o .env.
 */
function lerEnv(caminho) {
  const conteudo = readFileSync(caminho, "utf8");
  const valores = {};

  for (const linha of conteudo.split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith("#")) continue;
    const indice = limpa.indexOf("=");
    if (indice === -1) continue;
    const chave = limpa.slice(0, indice).trim();
    const valor = limpa.slice(indice + 1).trim();
    valores[chave] = valor;
  }

  return valores;
}

let origem = process.env;

try {
  origem = lerEnv(caminhoEnv);
} catch {
  const faltando = CHAVES.filter((chave) => !process.env[chave]);
  if (faltando.length > 0) {
    console.error(
      "Configure o arquivo .env na raiz do projeto (ou as variaveis de ambiente) antes de gerar o instalador."
    );
    process.exit(1);
  }
}

const config = {
  apiKey: origem.FIREBASE_API_KEY || "",
  authDomain: origem.FIREBASE_AUTH_DOMAIN || "",
  databaseURL: origem.FIREBASE_DATABASE_URL || "",
  projectId: origem.FIREBASE_PROJECT_ID || "",
  storageBucket: origem.FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: origem.FIREBASE_MESSAGING_SENDER_ID || "",
  appId: origem.FIREBASE_APP_ID || "",
  measurementId: origem.FIREBASE_MEASUREMENT_ID || "",
};

if (!config.databaseURL) {
  console.error("FIREBASE_DATABASE_URL ausente. Verifique o arquivo .env.");
  process.exit(1);
}

mkdirSync(path.dirname(caminhoSaida), { recursive: true });
writeFileSync(caminhoSaida, JSON.stringify(config, null, 2), "utf8");
console.log("Configuracao do Firebase gerada em build/firebase.config.json");
