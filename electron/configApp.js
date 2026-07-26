"use strict";

const fs = require("fs");
const path = require("path");
const { app } = require("electron");

/**
 * Configuração da loja/impressora persistida em userData.
 * Sobrescreve valores do .env em tempo de execução (sem alterar o arquivo .env).
 */

const CAMPOS = [
  "lojaNome",
  "lojaCnpj",
  "lojaEndereco",
  "lojaTelefone",
  "impressoraNome",
  "impressoraModo",
  "impressoraPorta",
  "estoqueMinimo",
  "avisoFornecedoresIa",
  "descontoMaxPct",
  "abrirCaixaObrigatorio",
  "beepModo",
  "cashbackPct",
  "modoBarrasContinuo",
  "abrirGavetaAoVender",
];

/**
 * @returns {string}
 */
function caminhoArquivo() {
  return path.join(app.getPath("userData"), "config-app.json");
}

/**
 * Valores padrão a partir do .env já carregado.
 * @returns {object}
 */
function padraoDoEnv() {
  return {
    lojaNome: process.env.LOJA_NOME || "CybhorPDV",
    lojaCnpj: process.env.LOJA_CNPJ || "",
    lojaEndereco: process.env.LOJA_ENDERECO || "",
    lojaTelefone: process.env.LOJA_TELEFONE || "",
    impressoraNome: process.env.IMPRESSORA_NOME || "",
    impressoraModo: process.env.IMPRESSORA_MODO || "",
    impressoraPorta: process.env.IMPRESSORA_PORTA || "",
    estoqueMinimo: Number(process.env.ESTOQUE_MINIMO) || 5,
    avisoFornecedoresIa: true,
    descontoMaxPct: 15,
    abrirCaixaObrigatorio: true,
    beepModo: "curto",
    cashbackPct: 0,
    modoBarrasContinuo: true,
    abrirGavetaAoVender: false,
  };
}

/**
 * @param {object} bruto
 * @returns {object}
 */
function normalizar(bruto) {
  const base = padraoDoEnv();
  const entrada = bruto && typeof bruto === "object" ? bruto : {};
  const estoque = Number(entrada.estoqueMinimo);
  return {
    lojaNome: String(entrada.lojaNome ?? base.lojaNome).trim() || "CybhorPDV",
    lojaCnpj: String(entrada.lojaCnpj ?? base.lojaCnpj).trim(),
    lojaEndereco: String(entrada.lojaEndereco ?? base.lojaEndereco).trim(),
    lojaTelefone: String(entrada.lojaTelefone ?? base.lojaTelefone).trim(),
    impressoraNome: String(entrada.impressoraNome ?? base.impressoraNome).trim(),
    impressoraModo: String(entrada.impressoraModo ?? base.impressoraModo).trim(),
    impressoraPorta: String(
      entrada.impressoraPorta ?? base.impressoraPorta
    ).trim(),
    estoqueMinimo:
      Number.isFinite(estoque) && estoque >= 0 ? Math.floor(estoque) : 5,
    avisoFornecedoresIa:
      entrada.avisoFornecedoresIa === false ||
      entrada.avisoFornecedoresIa === 0 ||
      entrada.avisoFornecedoresIa === "0" ||
      entrada.avisoFornecedoresIa === "false"
        ? false
        : true,
    descontoMaxPct: (() => {
      const n = Number(entrada.descontoMaxPct);
      return Number.isFinite(n) && n >= 0 ? Math.min(100, n) : 15;
    })(),
    abrirCaixaObrigatorio:
      entrada.abrirCaixaObrigatorio === false ||
      entrada.abrirCaixaObrigatorio === 0 ||
      entrada.abrirCaixaObrigatorio === "0" ||
      entrada.abrirCaixaObrigatorio === "false"
        ? false
        : true,
    beepModo: ["off", "curto", "longo"].includes(entrada.beepModo)
      ? entrada.beepModo
      : "curto",
    cashbackPct: (() => {
      const n = Number(entrada.cashbackPct);
      return Number.isFinite(n) && n >= 0 ? Math.min(50, n) : 0;
    })(),
    modoBarrasContinuo:
      entrada.modoBarrasContinuo === false ||
      entrada.modoBarrasContinuo === 0 ||
      entrada.modoBarrasContinuo === "false"
        ? false
        : true,
    abrirGavetaAoVender:
      entrada.abrirGavetaAoVender === true ||
      entrada.abrirGavetaAoVender === 1 ||
      entrada.abrirGavetaAoVender === "1" ||
      entrada.abrirGavetaAoVender === "true",
  };
}

/**
 * Aplica a configuração em process.env para o módulo de impressão.
 * @param {object} config
 */
function aplicarNoProcessEnv(config) {
  process.env.LOJA_NOME = config.lojaNome;
  process.env.LOJA_CNPJ = config.lojaCnpj;
  process.env.LOJA_ENDERECO = config.lojaEndereco;
  process.env.LOJA_TELEFONE = config.lojaTelefone;
  process.env.IMPRESSORA_NOME = config.impressoraNome;
  process.env.IMPRESSORA_MODO = config.impressoraModo;
  process.env.IMPRESSORA_PORTA = config.impressoraPorta;
  process.env.ESTOQUE_MINIMO = String(config.estoqueMinimo);
}

/**
 * Lê configuração salva (ou padrão do .env) e aplica no ambiente.
 * @returns {object}
 */
function carregarConfigApp() {
  let salva = {};
  try {
    const arquivo = caminhoArquivo();
    if (fs.existsSync(arquivo)) {
      salva = JSON.parse(fs.readFileSync(arquivo, "utf8"));
    }
  } catch (erro) {
    console.error("Falha ao ler config-app.json:", erro);
  }

  const config = normalizar({ ...padraoDoEnv(), ...salva });
  aplicarNoProcessEnv(config);
  return config;
}

/**
 * @returns {object}
 */
function obterConfigApp() {
  return carregarConfigApp();
}

/**
 * @param {object} parcial
 * @returns {object}
 */
function salvarConfigApp(parcial) {
  const atual = carregarConfigApp();
  const filtrado = {};
  for (const campo of CAMPOS) {
    if (parcial && Object.prototype.hasOwnProperty.call(parcial, campo)) {
      filtrado[campo] = parcial[campo];
    }
  }
  const config = normalizar({ ...atual, ...filtrado });
  fs.mkdirSync(path.dirname(caminhoArquivo()), { recursive: true });
  fs.writeFileSync(caminhoArquivo(), JSON.stringify(config, null, 2), "utf8");
  aplicarNoProcessEnv(config);
  return config;
}

module.exports = {
  carregarConfigApp,
  obterConfigApp,
  salvarConfigApp,
};
