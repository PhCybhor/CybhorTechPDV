import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const saida = path.join(raiz, "dist");

/**
 * Instalador único para Windows 7, 8, 10 e 11 (Electron 22, o último que roda
 * no Windows 7). x64 e ia32 em passos separados: com as duas arquiteturas no
 * mesmo comando o electron-builder gera um instalador só, com o dobro do tamanho.
 */
function rodar(arch) {
  console.log(`=== Windows ${arch} ===`);
  const resultado = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "electron-builder",
      "--win",
      "nsis",
      `--${arch}`,
      "--publish",
      "never",
      "-c.win.signAndEditExecutable=false",
    ],
    {
      cwd: raiz,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
    }
  );
  if (resultado.status !== 0) {
    process.exit(resultado.status || 1);
  }
}

fs.rmSync(saida, { recursive: true, force: true });

rodar("x64");
rodar("ia32");

const esperados = ["CybhorPDV-Setup-x64.exe", "CybhorPDV-Setup-ia32.exe"];

for (const nome of esperados) {
  const arquivo = path.join(saida, nome);
  if (!fs.existsSync(arquivo)) {
    console.error("Artefato ausente:", arquivo);
    console.error("Conteudo dist:", fs.readdirSync(saida));
    process.exit(1);
  }
  console.log("OK", nome, fs.statSync(arquivo).size, "bytes");
}
