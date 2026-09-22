import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, "..");
const dist = path.join(raiz, "renderer", "dist");

const ofuscar =
  process.env.CYBHOR_OFUSCAR === "1" ||
  process.argv.includes("--ofuscar");

/**
 * html2canvas / canvg / dompurify só servem ao jsPDF.html().
 * O PDV gera PDF via autoTable + addImage — não precisa desses pacotes.
 * Mantê-los fora do bundle corta ~390KB sem mudar comportamento.
 */
const externosJspdfOpcionais = ["html2canvas", "canvg", "dompurify"];

/**
 * Compila o renderer em dois IIFE:
 * - bundle.js: app do caixa (carrega na abertura)
 * - relatorios.js: Dashboard + chart.js + jspdf (só ao abrir Relatórios)
 * target chrome108 = Electron 22 (ultimo com suporte oficial ao Windows 7).
 */
fs.mkdirSync(dist, { recursive: true });

const comum = {
  bundle: true,
  minify: true,
  treeShaking: true,
  format: "iife",
  target: ["chrome108", "es2020"],
  legalComments: "none",
  drop: ["console", "debugger"],
  external: externosJspdfOpcionais,
  logLevel: "info",
};

await build({
  ...comum,
  entryPoints: [path.join(raiz, "renderer/js/app.js")],
  outfile: path.join(dist, "bundle.js"),
});

await build({
  ...comum,
  entryPoints: [path.join(raiz, "renderer/js/lazy/relatorios-entry.js")],
  outfile: path.join(dist, "relatorios.js"),
});

async function ofuscarArquivo(caminho) {
  const { default: JavaScriptObfuscator } = await import(
    "javascript-obfuscator"
  );
  const codigo = fs.readFileSync(caminho, "utf8");
  // Ofuscacao leve: flattening agressivo quebra o Chromium do Electron 22/Win7.
  const ofuscado = JavaScriptObfuscator.obfuscate(codigo, {
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: true,
    identifierNamesGenerator: "hexadecimal",
    renameGlobals: false,
    rotateStringArray: true,
    selfDefending: false,
    stringArray: true,
    stringArrayEncoding: ["base64"],
    stringArrayThreshold: 0.5,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
  }).getObfuscatedCode();
  fs.writeFileSync(caminho, ofuscado, "utf8");
}

if (ofuscar) {
  await ofuscarArquivo(path.join(dist, "bundle.js"));
  await ofuscarArquivo(path.join(dist, "relatorios.js"));
  console.log(
    "Bundles ofuscados (leve) em renderer/dist/bundle.js e relatorios.js"
  );
} else {
  console.log(
    "Bundles de desenvolvimento em renderer/dist/ (use CYBHOR_OFUSCAR=1 para ofuscar)"
  );
}

for (const nome of ["bundle.js", "relatorios.js"]) {
  const bytes = fs.statSync(path.join(dist, nome)).size;
  console.log(`  ${nome}: ${(bytes / 1024).toFixed(1)} KiB`);
}
