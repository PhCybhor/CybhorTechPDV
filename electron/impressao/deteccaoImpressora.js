"use strict";

/**
 * Detecção automática da impressora térmica pronta para imprimir.
 *
 * Recebe listas de origens diferentes (WMI no Windows, Electron/CUPS no
 * Linux/macOS) e decide qual usar. Não faz I/O, para poder ser testada isolada.
 */

/** Trechos de nome/driver de impressoras térmicas de cupom comuns no Brasil. */
const PALAVRAS_IMPRESSORA_TERMICA = [
  "jetway",
  "jp-800",
  "jp800",
  "jp-500",
  "jp500",
  "jp-700",
  "jp700",
  "tanca",
  "bematech",
  "elgin",
  "daruma",
  "sweda",
  "epson tm",
  "tm-t20",
  "tm-t88",
  "pos-58",
  "pos-80",
  "pos58",
  "pos80",
  "58mm",
  "80mm",
  "receipt",
  "thermal",
  "termica",
  "térmica",
  "cupom",
  // Driver genérico que a maioria das lojas usa para térmicas sem driver próprio.
  "text only",
  "text-only",
];

/** Impressoras que geram arquivo/PDF/fax: ESC/POS nelas nunca sai no papel. */
const PALAVRAS_IMPRESSORA_VIRTUAL = [
  "pdf",
  "xps",
  "onenote",
  "fax",
  "document writer",
  "anydesk",
];
const PORTA_VIRTUAL = /^(portprompt:|file:|nul:?$|xpsport:|shrfax:)/i;

/**
 * Bits de PRINTER_STATUS do Winspool que impedem a impressão:
 * pausada, erro, offline e não disponível.
 */
const BITS_WINSPOOL_INDISPONIVEL = 0x1 | 0x2 | 0x80 | 0x1000;
/** Win32_Printer.PrinterStatus: 1 = Other (driver em erro), 7 = Offline. */
const PRINTER_STATUS_INDISPONIVEL = new Set([1, 7]);
/** Win32_Printer.ExtendedPrinterStatus: 7 Offline, 8 Paused, 9 Error, 11 Not Available. */
const EXTENDED_STATUS_INDISPONIVEL = new Set([7, 8, 9, 11]);
/** printer-state do CUPS (IPP): 3 idle, 4 processing, 5 stopped. */
const CUPS_PARADA = 5;

/**
 * @typedef {object} EstadoWindows
 * @property {number} [printerStatus]
 * @property {boolean} [workOffline]
 * @property {number} [printerState]
 * @property {number} [extendedStatus]
 */

/**
 * Regra única para o status vindo do WMI (listagem e diagnóstico).
 * @param {EstadoWindows} estado
 * @returns {boolean}
 */
function estadoWindowsIndisponivel(estado) {
  const { printerStatus, workOffline, printerState, extendedStatus } = estado || {};
  if (workOffline) return true;
  if (PRINTER_STATUS_INDISPONIVEL.has(Number(printerStatus))) return true;
  if (EXTENDED_STATUS_INDISPONIVEL.has(Number(extendedStatus))) return true;
  return (Number(printerState) & BITS_WINSPOOL_INDISPONIVEL) !== 0;
}

/**
 * @param {object} bruta
 * @param {Record<string, string>} opcoes
 * @param {string} plataforma
 * @returns {boolean | null} null quando o sistema não informa o estado
 */
function avaliarDisponibilidade(bruta, opcoes, plataforma) {
  if (bruta.origem === "wmi") return !estadoWindowsIndisponivel(bruta);

  if (plataforma === "win32") {
    const status = Number(bruta.status);
    if (!Number.isFinite(status)) return null;
    return (status & BITS_WINSPOOL_INDISPONIVEL) === 0;
  }

  const estado = Number(opcoes["printer-state"] ?? bruta.status);
  const motivos = String(opcoes["printer-state-reasons"] || "").toLowerCase();
  const aceitaTrabalhos =
    String(opcoes["printer-is-accepting-jobs"] ?? "true").toLowerCase() !== "false";
  if (estado === CUPS_PARADA || !aceitaTrabalhos) return false;
  if (motivos.includes("offline") || motivos.includes("paused")) return false;
  if (estado === 3 || estado === 4) return true;
  return null;
}

const contemAlguma = (texto, palavras) => palavras.some((palavra) => texto.includes(palavra));

/**
 * @typedef {object} ImpressoraDetectada
 * @property {string} nome
 * @property {boolean} padrao
 * @property {boolean | null} disponivel null = sistema não informou o estado
 * @property {boolean} termica
 * @property {boolean} virtual
 * @property {boolean} usb
 * @property {boolean} duplicada cópia "(1)", "(2)" criada por reinstalação do driver
 */

/**
 * @param {object} bruta item do WMI ({origem: "wmi", ...}) ou do Electron getPrinters
 * @param {string} [plataforma]
 * @returns {ImpressoraDetectada}
 */
function normalizarImpressora(bruta, plataforma = process.platform) {
  const item = bruta && typeof bruta === "object" ? bruta : {};
  const opcoes = item.options && typeof item.options === "object" ? item.options : {};
  const nome = String(item.name || "").trim();
  const driver = String(item.driver || opcoes["printer-make-and-model"] || "");
  const porta = String(item.port || opcoes["device-uri"] || "").trim();
  const descricao = `${nome} ${item.displayName || ""} ${driver}`.toLowerCase();

  return {
    nome,
    padrao: Boolean(item.isDefault),
    disponivel: avaliarDisponibilidade(item, opcoes, plataforma),
    termica: contemAlguma(descricao, PALAVRAS_IMPRESSORA_TERMICA),
    virtual: PORTA_VIRTUAL.test(porta) || contemAlguma(descricao, PALAVRAS_IMPRESSORA_VIRTUAL),
    usb: /^usb/i.test(porta),
    duplicada: /\(\d+\)$/.test(nome),
  };
}

/**
 * Mais confiável primeiro: confirmada pronta, USB, original (não duplicada), padrão.
 * @param {ImpressoraDetectada} a
 * @param {ImpressoraDetectada} b
 */
function compararPreferencia(a, b) {
  const peso = (p) =>
    (p.disponivel === true ? 8 : 0) + (p.usb ? 4 : 0) + (p.duplicada ? 0 : 2) + (p.padrao ? 1 : 0);
  return peso(b) - peso(a);
}

/**
 * @param {ImpressoraDetectada[]} lista
 * @param {string} configurado
 * @returns {ImpressoraDetectada | null}
 */
function acharConfigurada(lista, configurado) {
  const alvo = configurado.toLowerCase();
  if (!alvo) return null;
  const exata = lista.find((p) => p.nome.toLowerCase() === alvo);
  if (exata) return exata;
  const parecidas = lista.filter((p) => p.nome.toLowerCase().includes(alvo));
  return parecidas.sort(compararPreferencia)[0] || null;
}

/**
 * Escolhe a impressora do cupom, priorizando a que está pronta para imprimir:
 * 1) a configurada, se estiver pronta;
 * 2) uma térmica pronta (a configurada pode estar desligada ou ter sido trocada);
 * 3) a configurada mesmo offline (o diagnóstico explica o problema ao operador);
 * 4) sem configuração, a padrão do sistema.
 *
 * Nome configurado que não aparece na lista nunca cai na impressora padrão:
 * ESC/POS enviado a uma impressora comum imprime páginas de lixo.
 *
 * @param {object[]} impressorasBrutas
 * @param {string} [nomeConfigurado]
 * @param {string} [plataforma]
 * @returns {string | null}
 */
function escolherImpressora(
  impressorasBrutas,
  nomeConfigurado = process.env.IMPRESSORA_NOME,
  plataforma = process.platform
) {
  const configurado = String(nomeConfigurado || "").trim();
  const todas = (Array.isArray(impressorasBrutas) ? impressorasBrutas : [])
    .map((bruta) => normalizarImpressora(bruta, plataforma))
    .filter((p) => p.nome);
  if (todas.length === 0) return configurado || null;

  const daConfiguracao = acharConfigurada(todas, configurado);
  if (daConfiguracao && daConfiguracao.disponivel !== false) return daConfiguracao.nome;

  const reais = todas.filter((p) => !p.virtual);
  const termicas = reais.filter((p) => p.termica).sort(compararPreferencia);
  const termicaPronta = termicas.find((p) => p.disponivel !== false);
  if (termicaPronta) return termicaPronta.nome;
  if (daConfiguracao) return daConfiguracao.nome;
  if (termicas[0]) return termicas[0].nome;
  if (configurado) return configurado;

  const candidatas = reais.filter((p) => p.disponivel !== false);
  const escolhida =
    candidatas.find((p) => p.padrao) || candidatas[0] || reais.find((p) => p.padrao) || reais[0];
  return escolhida ? escolhida.nome : null;
}

module.exports = {
  escolherImpressora,
  normalizarImpressora,
  estadoWindowsIndisponivel,
};
