"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { BrowserWindow } = require("electron");
const { gerarHtmlCupom } = require("./cupomHtml");
const { gerarBufferEscPos } = require("./escpos");

/**
 * Nomes/trechos usados para localizar a impressora Jetway no Windows.
 * Driver oficial cria "Jetway JP-800" (Driver_Utilitarios_JP-800).
 */
const PALAVRAS_JETWAY = [
  "jetway",
  "jp-800",
  "jp800",
  "jp-500",
  "jp500",
  "jp-700",
  "jp700",
  "tanca",
];

function obterDadosLoja() {
  return {
    nome: process.env.LOJA_NOME || "CybhorPDV",
    cnpj: process.env.LOJA_CNPJ || "",
    endereco: process.env.LOJA_ENDERECO || "",
    telefone: process.env.LOJA_TELEFONE || "",
  };
}

/**
 * @param {Array<{name: string, isDefault?: boolean}>} impressoras
 * @returns {string | null}
 */
function escolherImpressora(impressoras) {
  if (!Array.isArray(impressoras) || impressoras.length === 0) {
    const forçada = (process.env.IMPRESSORA_NOME || "").trim();
    return forçada || null;
  }

  const configurada = (process.env.IMPRESSORA_NOME || "").trim().toLowerCase();
  if (configurada) {
    const exata = impressoras.find(
      (p) => String(p.name || "").toLowerCase() === configurada
    );
    if (exata) return exata.name;

    const parcial = impressoras.find((p) =>
      String(p.name || "").toLowerCase().includes(configurada)
    );
    if (parcial) return parcial.name;

    return (process.env.IMPRESSORA_NOME || "").trim();
  }

  const jetway = impressoras.find((p) => {
    const nome = String(p.name || "").toLowerCase();
    return PALAVRAS_JETWAY.some((trecho) => nome.includes(trecho));
  });
  if (jetway) return jetway.name;

  const padrao = impressoras.find((p) => p.isDefault);
  return padrao?.name || impressoras[0]?.name || null;
}

async function listarImpressoras() {
  const janela =
    BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!janela) return [];
  return janela.webContents.getPrintersAsync();
}

/**
 * @param {string} comando
 * @param {string[]} args
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function executar(comando, args) {
  return new Promise((resolve) => {
    const filho = spawn(comando, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    filho.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    filho.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    filho.on("error", (erro) => {
      resolve({ code: 1, stdout, stderr: erro.message });
    });
    filho.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Envia bytes RAW pela porta serial/COM (formaEnvio=0 do exemplo Delphi).
 * @param {string} porta ex: COM3 ou /dev/ttyUSB0
 * @param {Buffer} buffer
 */
async function enviarViaPorta(porta, buffer) {
  await fs.promises.writeFile(porta, buffer);
  return { ok: true, impressora: porta, modo: "COM" };
}

/**
 * Caminho do RawPrint.ps1 (fora do asar quando empacotado).
 * @returns {string}
 */
function caminhoScriptRaw() {
  const base = __dirname.includes(`${path.sep}app.asar${path.sep}`)
    ? __dirname.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    : __dirname;
  return path.join(base, "RawPrint.ps1");
}

/**
 * Envia bytes RAW via Winspool WritePrinter (formaEnvio=1 do exemplo Delphi).
 * @param {string} nomeImpressora
 * @param {Buffer} buffer
 */
async function enviarViaWritePrinter(nomeImpressora, buffer) {
  const tmp = path.join(
    os.tmpdir(),
    `cybhor-cupom-${Date.now()}-${process.pid}.bin`
  );
  const script = caminhoScriptRaw();

  if (!fs.existsSync(script)) {
    throw new Error(`Script RAW nao encontrado: ${script}`);
  }

  await fs.promises.writeFile(tmp, buffer);

  try {
    const resultado = await executar("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-PrinterName",
      nomeImpressora,
      "-FilePath",
      tmp,
    ]);

    if (resultado.code !== 0 || !resultado.stdout.includes("OK:")) {
      const detalhe =
        (resultado.stderr || resultado.stdout || "Falha no WritePrinter RAW").trim();
      throw new Error(detalhe);
    }

    return { ok: true, impressora: nomeImpressora, modo: "RAW" };
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}

/**
 * Fallback GDI/HTML (quando RAW nao estiver disponivel).
 * @param {object} dadosVenda
 * @param {string} deviceName
 */
async function imprimirViaHtml(dadosVenda, deviceName) {
  const html = gerarHtmlCupom(dadosVenda, obterDadosLoja());
  const janela = new BrowserWindow({
    show: false,
    width: 302,
    height: 800,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await janela.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    );

    await new Promise((resolve) => {
      if (janela.webContents.isLoading()) {
        janela.webContents.once("did-finish-load", resolve);
      } else {
        resolve();
      }
    });

    await new Promise((resolve, reject) => {
      janela.webContents.print(
        {
          silent: true,
          printBackground: false,
          deviceName,
          copies: 1,
          margins: { marginType: "none" },
          pagesPerSheet: 1,
          collate: false,
          scaleFactor: 100,
        },
        (sucesso, motivoFalha) => {
          if (sucesso) resolve();
          else
            reject(
              new Error(motivoFalha || "Falha ao enviar para a impressora.")
            );
        }
      );
    });

    return { ok: true, impressora: deviceName, modo: "HTML" };
  } finally {
    if (!janela.isDestroyed()) janela.close();
  }
}

/**
 * Modo de desenvolvimento/teste: grava o binario ESC/POS em disco.
 * @param {Buffer} buffer
 */
async function gravarCupomTeste(buffer) {
  const pasta =
    process.env.IMPRESSORA_TESTE_DIR ||
    path.join(os.tmpdir(), "cybhor-jp800-teste");
  await fs.promises.mkdir(pasta, { recursive: true });
  const arquivo = path.join(pasta, `cupom-${Date.now()}.bin`);
  await fs.promises.writeFile(arquivo, buffer);
  const texto = path.join(pasta, `cupom-${Date.now()}.txt`);
  // Representacao legivel (substitui ESC/GS por marcadores)
  const legivel = buffer
    .toString("latin1")
    .replace(/\x1b/g, "<ESC>")
    .replace(/\x1d/g, "<GS>")
    .replace(/\n/g, "\n");
  await fs.promises.writeFile(texto, legivel, "utf8");
  return { ok: true, impressora: arquivo, modo: "TESTE", arquivo, texto };
}

/**
 * Imprime o comprovante na JP-800 no mesmo modelo do exemplo Delphi:
 * 1) Porta COM/serial se IMPRESSORA_PORTA estiver definida
 * 2) WritePrinter RAW no Windows (driver Jetway JP-800)
 * 3) Fallback HTML silencioso
 * 4) Em Linux/dev: grava arquivo de teste se IMPRESSORA_MODO=teste
 *
 * @param {object} dadosVenda
 * @returns {Promise<{ok: boolean, impressora?: string, mensagem?: string, modo?: string}>}
 */
async function imprimirCupomVenda(dadosVenda) {
  const loja = obterDadosLoja();
  const buffer = gerarBufferEscPos(dadosVenda, loja);
  const modoForcado = (process.env.IMPRESSORA_MODO || "").trim().toLowerCase();

  if (modoForcado === "teste" || modoForcado === "test") {
    return gravarCupomTeste(buffer);
  }

  const porta = (process.env.IMPRESSORA_PORTA || "").trim();
  if (porta) {
    try {
      return await enviarViaPorta(porta, buffer);
    } catch (erro) {
      return {
        ok: false,
        mensagem: `Falha ao enviar pela porta ${porta}: ${erro.message}`,
      };
    }
  }

  const impressoras = await listarImpressoras();
  const deviceName =
    escolherImpressora(impressoras) ||
    (process.env.IMPRESSORA_NOME || "").trim() ||
    "Jetway JP-800";

  if (process.platform === "win32" && modoForcado !== "html") {
    try {
      return await enviarViaWritePrinter(deviceName, buffer);
    } catch (erroRaw) {
      console.warn("RAW WritePrinter falhou, tentando HTML:", erroRaw.message);
      try {
        return await imprimirViaHtml(dadosVenda, deviceName);
      } catch (erroHtml) {
        return {
          ok: false,
          mensagem: `RAW: ${erroRaw.message} | HTML: ${erroHtml.message}`,
        };
      }
    }
  }

  if (modoForcado === "html") {
    try {
      return await imprimirViaHtml(dadosVenda, deviceName);
    } catch (erro) {
      return { ok: false, mensagem: erro.message };
    }
  }

  // Fora do Windows sem porta: gera arquivo para inspecao (simula impressao).
  const teste = await gravarCupomTeste(buffer);
  return {
    ...teste,
    mensagem:
      "Ambiente nao-Windows: cupom ESC/POS gravado em arquivo de teste. No Windows use o driver Jetway JP-800.",
  };
}

module.exports = {
  imprimirCupomVenda,
  escolherImpressora,
  listarImpressoras,
  obterDadosLoja,
  gerarBufferEscPos,
};
