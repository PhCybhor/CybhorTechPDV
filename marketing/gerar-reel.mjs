/**
 * Gera MP4 vertical (1080x1920) do Reels CybhorPDV com voz sincronizada.
 * Uso: node marketing/gerar-reel.mjs
 */
import { chromium } from "playwright";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, "instagram-reel.html");
const outDir = path.join(__dirname, "out");
const webmTempDir = path.join(outDir, "_grava");
const mp4Silent = path.join(outDir, "cybhor-instagram-reel-silent.mp4");
const mp4Path = path.join(outDir, "cybhor-instagram-reel.mp4");
const timingsPath = path.join(outDir, "timings.json");
const naracaoPath = path.join(outDir, "naracao.mp3");
const ffmpeg = ffmpegInstaller.path;

mkdirSync(outDir, { recursive: true });
mkdirSync(webmTempDir, { recursive: true });

console.log("1/3 Gerando voz (edge-tts)…");
const voz = spawnSync(
  "python",
  [path.join(__dirname, "gerar-voz.py"), ffmpeg],
  { stdio: "inherit", encoding: "utf-8" }
);
if (voz.status !== 0) {
  throw new Error("Falha ao gerar narração.");
}

const timings = JSON.parse(readFileSync(timingsPath, "utf-8"));
if (!existsSync(naracaoPath)) {
  throw new Error("Arquivo de narração não encontrado.");
}

console.log("2/3 Gravando vídeo sincronizado…");
const url =
  pathToFileURL(htmlPath).href +
  "?auto=0&t=" +
  Date.now(); /* cache-bust */

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1080, height: 1920 },
  deviceScaleFactor: 1,
  recordVideo: {
    dir: webmTempDir,
    size: { width: 1080, height: 1920 },
  },
});

const page = await context.newPage();
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.body.dataset.fonts === "1", null, {
  timeout: 20000,
});

const totalMs = await page.evaluate((tempos) => {
  return window.__cybhorReel.iniciar(tempos);
}, timings.temposMs);

console.log(
  `Slides: ${timings.temposMs.map((ms) => (ms / 1000).toFixed(1) + "s").join(" · ")}`
);
console.log(`Gravando ~${Math.round((totalMs + 450) / 1000)}s…`);

await page.waitForFunction(() => document.body.dataset.fim === "1", null, {
  timeout: totalMs + 12000,
});
await page.waitForTimeout(400);

await context.close();
await browser.close();

const webms = readdirSync(webmTempDir).filter((f) => f.endsWith(".webm"));
if (!webms.length) {
  throw new Error("Nenhum .webm gerado pela gravação.");
}

const webmPath = path.join(webmTempDir, webms[0]);
const webmFinal = path.join(outDir, "cybhor-instagram-reel.webm");
if (existsSync(webmFinal)) unlinkSync(webmFinal);
renameSync(webmPath, webmFinal);

console.log("3/3 Codificando MP4 + voz…");
execFileSync(
  ffmpeg,
  [
    "-y",
    "-i",
    webmFinal,
    "-i",
    naracaoPath,
    "-vf",
    "scale=1080:1920:flags=lanczos,fps=30,format=yuv420p",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-shortest",
    "-movflags",
    "+faststart",
    mp4Path,
  ],
  { stdio: "inherit" }
);

// Mantém cópia silenciosa opcional limpa se existir de runs antigos
if (existsSync(mp4Silent)) {
  try {
    unlinkSync(mp4Silent);
  } catch {
    /* ignore */
  }
}

try {
  for (const f of readdirSync(webmTempDir)) {
    unlinkSync(path.join(webmTempDir, f));
  }
} catch {
  /* ignore */
}

writeFileSync(
  path.join(outDir, "LEIA-ME.txt"),
  [
    "CybhorPDV — Reels Instagram",
    "",
    `Arquivo: ${path.basename(mp4Path)}`,
    "Formato: 1080x1920 com voz (pt-BR)",
    "Editar falas: marketing/roteiro-voz.json",
    "Regenerar: node marketing/gerar-reel.mjs",
    "",
  ].join("\n"),
  "utf-8"
);

console.log("\nPronto:");
console.log(`  ${mp4Path}`);
console.log("Formato: 1080×1920 · com voz · tempos alinhados à narração");
