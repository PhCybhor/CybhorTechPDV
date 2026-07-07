import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, "..");

/**
 * Compila e ofusca (via minify) o código do renderer em um único arquivo.
 * O bundle final é o que vai empacotado no .exe; o código-fonte legível
 * (renderer/js) é excluído do pacote pelo electron-builder.
 */
await build({
  entryPoints: [path.join(raiz, "renderer/js/app.js")],
  bundle: true,
  minify: true,
  treeShaking: true,
  format: "iife",
  target: "chrome120",
  legalComments: "none",
  drop: ["console", "debugger"],
  outfile: path.join(raiz, "renderer/dist/bundle.js"),
  logLevel: "info",
});

console.log("Bundle do renderer gerado em renderer/dist/bundle.js");
