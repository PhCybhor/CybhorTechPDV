import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const saida = path.join(raiz, "dist-win7");
const destRelease = path.join(raiz, "dist");

/**
 * Build Windows 7 isolado (Electron 22), x64 e ia32 em passos separados.
 * Evita misturar com o pacote Win10 (Electron 31) em dist/win-unpacked.
 */
function limpar(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function rodar(arch) {
  console.log(`=== Win7 ${arch} (Electron 22.3.27) ===`);
  const resultado = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "electron-builder",
      "--config",
      "electron-builder.win7.json",
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

limpar(saida);
fs.mkdirSync(destRelease, { recursive: true });

rodar("x64");
rodar("ia32");

const esperados = [
  "CybhorPDV-Setup-win7-x64.exe",
  "CybhorPDV-Setup-win7-ia32.exe",
];

for (const nome of esperados) {
  const arquivo = path.join(saida, nome);
  if (!fs.existsSync(arquivo)) {
    console.error("Artefato ausente:", arquivo);
    console.error("Conteudo dist-win7:", fs.readdirSync(saida));
    process.exit(1);
  }
  fs.copyFileSync(arquivo, path.join(destRelease, nome));
  console.log("OK", nome, fs.statSync(arquivo).size, "bytes");
}
