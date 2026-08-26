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
 * target chrome108 = Electron 22 (ultimo com suporte oficial ao Windows 7).
 */
await build({
  entryPoints: [path.join(raiz, "renderer/js/app.js")],
  bundle: true,
  minify: true,
  treeShaking: true,
  format: "iife",
  target: ["chrome108", "es2020"],
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
  fs.writeFileSync(saida, ofuscado, "utf8");
  console.log("Bundle ofuscado (leve) gerado em renderer/dist/bundle.js");
} else {
  console.log(
    "Bundle de desenvolvimento gerado em renderer/dist/bundle.js (use CYBHOR_OFUSCAR=1 para ofuscar)"
  );
}
