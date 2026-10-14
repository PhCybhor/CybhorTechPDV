"use strict";

const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

/**
 * Mantém um PowerShell aberto (ServidorImpressao.ps1) para imprimir no Windows.
 *
 * Abrir um PowerShell e compilar o helper Win32 a cada cupom levava segundos
 * (bem mais no Windows 7). O processo é aquecido na abertura do app e cada
 * cupom vira só uma linha no stdin dele.
 *
 * Códigos de erro (erro.codigo):
 * - INDISPONIVEL: o servidor não subiu; quem chama pode usar o caminho antigo.
 * - TIMEOUT / ENCERRADO: o pedido pode ter chegado ao spooler; não reenviar
 *   automaticamente para não imprimir cupom duplicado.
 * - ERRO: o servidor respondeu com falha (ex.: impressora inexistente).
 */

const TIMEOUT_INICIO_MS = 30000;
const TIMEOUT_PEDIDO_MS = 15000;

let processoAtual = null;
let inicioEmAndamento = null;
let proximoId = 1;
const pendentes = new Map();

function criarErro(mensagem, codigo) {
  const erro = new Error(mensagem);
  erro.codigo = codigo;
  return erro;
}

function caminhoScriptServidor() {
  // Fora do asar quando empacotado (asarUnpack de electron/impressao).
  const base = __dirname.includes(`${path.sep}app.asar${path.sep}`)
    ? __dirname.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
    : __dirname;
  return path.join(base, "ServidorImpressao.ps1");
}

const para64 = (texto) => Buffer.from(String(texto ?? ""), "utf8").toString("base64");
const de64 = (texto) => Buffer.from(String(texto || ""), "base64").toString("utf8");

function rejeitarPendentes(erro) {
  for (const [id, pedido] of pendentes) {
    clearTimeout(pedido.timer);
    pedido.reject(erro);
    pendentes.delete(id);
  }
}

function tratarResposta(linha) {
  const [idTexto, status, corpo] = linha.split("\t");
  const pedido = pendentes.get(Number(idTexto));
  if (!pedido) return;
  clearTimeout(pedido.timer);
  pendentes.delete(Number(idTexto));
  const texto = de64(corpo);
  if (status === "OK") {
    pedido.resolve(texto);
  } else {
    pedido.reject(criarErro(texto || "Falha no servidor de impressão.", "ERRO"));
  }
}

/** Encerra o processo (fim do app ou processo travado). */
function encerrar() {
  const filho = processoAtual;
  processoAtual = null;
  inicioEmAndamento = null;
  if (filho) {
    try {
      filho.kill();
    } catch (_) {
      /* processo já terminou */
    }
  }
  rejeitarPendentes(criarErro("Servidor de impressão encerrado.", "ENCERRADO"));
}

/**
 * Sobe o servidor (idempotente). Resolve quando o helper Win32 está compilado.
 * @returns {Promise<void>}
 */
function iniciar() {
  if (process.platform !== "win32") {
    return Promise.reject(criarErro("Servidor de impressão só existe no Windows.", "INDISPONIVEL"));
  }
  if (inicioEmAndamento) return inicioEmAndamento;

  inicioEmAndamento = new Promise((resolve, reject) => {
    let pronto = false;
    let stderrRecente = "";
    const filho = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        caminhoScriptServidor(),
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
    processoAtual = filho;

    const falharInicio = (motivo) => {
      if (pronto) return;
      pronto = true;
      clearTimeout(timerInicio);
      if (processoAtual === filho) encerrar();
      reject(criarErro(`Servidor de impressão indisponível: ${motivo}`, "INDISPONIVEL"));
    };
    const timerInicio = setTimeout(
      () => falharInicio(`não iniciou em ${TIMEOUT_INICIO_MS / 1000}s`),
      TIMEOUT_INICIO_MS
    );

    readline.createInterface({ input: filho.stdout }).on("line", (linha) => {
      if (!pronto) {
        if (linha.trim() === "PRONTO") {
          pronto = true;
          clearTimeout(timerInicio);
          resolve();
        }
        return;
      }
      tratarResposta(linha);
    });
    filho.stderr.on("data", (dados) => {
      stderrRecente = (stderrRecente + dados.toString()).slice(-500);
    });
    // Sem este handler um EPIPE no stdin derrubaria o processo principal.
    filho.stdin.on("error", () => {});
    filho.on("error", (erro) => falharInicio(erro.message));
    filho.on("exit", (codigo) => {
      falharInicio(`saiu com código ${codigo}. ${stderrRecente.trim()}`.trim());
      if (processoAtual === filho) encerrar();
    });
  });

  return inicioEmAndamento;
}

/**
 * @param {string} acao
 * @param {string[]} argumentos já em base64
 * @param {number} [timeoutMs]
 * @returns {Promise<string>}
 */
async function requisitar(acao, argumentos = [], timeoutMs = TIMEOUT_PEDIDO_MS) {
  await iniciar();
  const filho = processoAtual;
  if (!filho) throw criarErro("Servidor de impressão encerrado.", "ENCERRADO");

  const id = proximoId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendentes.delete(id);
      // Processo preso (ex.: driver travado no WritePrinter): descarta e recria no próximo pedido.
      encerrar();
      reject(criarErro(`A impressora não respondeu em ${timeoutMs / 1000}s.`, "TIMEOUT"));
    }, timeoutMs);
    pendentes.set(id, { resolve, reject, timer });
    filho.stdin.write(`${[id, acao, ...argumentos].join("\t")}\n`);
  });
}

/**
 * @typedef {object} ImpressoraWmi
 * @property {"wmi"} origem
 * @property {string} name
 * @property {boolean} isDefault
 * @property {number} status PrinterStatus
 * @property {number} printerStatus
 * @property {boolean} workOffline
 * @property {number} printerState
 * @property {number} extendedStatus
 * @property {string} port
 * @property {string} driver
 */

/**
 * Interpreta a listagem do WMI (uma impressora por linha, campos por TAB).
 * Compartilhada com o modo antigo (um PowerShell por chamada).
 * @param {string} texto
 * @returns {ImpressoraWmi[]}
 */
function interpretarListagemWmi(texto) {
  return String(texto || "")
    .split(/\r?\n/)
    .map((linha) => linha.replace(/\r$/, ""))
    .filter((linha) => linha.trim())
    .map((linha) => {
      const [nome, padrao, status, offline, estado, estendido, porta, driver] = linha.split("\t");
      return {
        origem: "wmi",
        name: String(nome || "").trim(),
        isDefault: padrao === "1",
        status: Number(status) || 0,
        printerStatus: Number(status) || 0,
        workOffline: offline === "1",
        printerState: Number(estado) || 0,
        extendedStatus: Number(estendido) || 0,
        port: String(porta || "").trim(),
        driver: String(driver || "").trim(),
      };
    })
    .filter((impressora) => impressora.name);
}

/**
 * @returns {Promise<ImpressoraWmi[]>}
 */
async function listar() {
  return interpretarListagemWmi(await requisitar("listar"));
}

/**
 * @param {string} nomeImpressora
 * @returns {Promise<string>} "MISSING" ou "STATUS=..;PORT=..;WORKOFFLINE=..;STATE=..;EXT=.."
 */
function diagnosticar(nomeImpressora) {
  return requisitar("diagnosticar", [para64(nomeImpressora)]);
}

/**
 * @param {string} nomeImpressora
 * @param {Buffer} buffer bytes ESC/POS
 * @returns {Promise<string>} "OK:<bytes escritos>"
 */
function imprimirRaw(nomeImpressora, buffer) {
  return requisitar("imprimir", [para64(nomeImpressora), Buffer.from(buffer).toString("base64")]);
}

module.exports = {
  iniciar,
  encerrar,
  listar,
  diagnosticar,
  imprimirRaw,
  interpretarListagemWmi,
};
