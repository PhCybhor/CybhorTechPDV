import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, "..");
const saida = path.join(raiz, "renderer", "dist", "bundle.js");

const ofuscar =
  process.env.CYBHOR_OFUSCAR === "1" ||
  process.argv.includes("--ofuscar");

/**
 * Compila o renderer.
 * Em desenvolvimento: só minify (rápido).
 * Em produção (`CYBHOR_OFUSCAR=1` ou `--ofuscar`): ofuscação forte.
 */
await build({
  entryPoints: [path.join(raiz, "renderer/js/app.js")],
  bundle: true,
  minify: true,
  treeShaking: true,
  format: "iife",
  target: "chrome108",
  legalComments: "none",
  drop: ["console", "debugger"],
  outfile: saida,
  logLevel: "info",
});

if (ofuscar) {
  const { default: JavaScriptObfuscator } = await import(
    "javascript-obfuscator"
  );
  const codigo = fs.readFileSync(saida, "utf8");
  const ofuscado = JavaScriptObfuscator.obfuscate(codigo, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.4,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: true,
    identifierNamesGenerator: "hexadecimal",
    renameGlobals: false,
    rotateStringArray: true,
    selfDefending: false,
    stringArray: true,
    stringArrayEncoding: ["base64"],
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
  }).getObfuscatedCode();
  fs.writeFileSync(saida, ofuscado, "utf8");
  console.log("Bundle ofuscado gerado em renderer/dist/bundle.js");
} else {
  console.log(
    "Bundle de desenvolvimento gerado em renderer/dist/bundle.js (use CYBHOR_OFUSCAR=1 para ofuscar)"
  );
}
