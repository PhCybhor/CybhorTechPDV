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
  "tema",
  "fonteUi",
  "densidadeUi",
  "tamanhoUi",
  "reduzirAnimacoes",
  "ocultarFiado",
  "ocultarDesconto",
  "ocultarCliente",
  "campoProdutoCusto",
  "campoProdutoCodigos",
  "campoProdutoCategoria",
  "campoProdutoUnidade",
  "campoProdutoCaixa",
  "campoProdutoValidade",
  "campoProdutoPromocao",
  "moduloProdutos",
  "moduloHistorico",
  "moduloClientes",
  "moduloRelatorios",
  "moduloFornecedores",
  "moduloGestao",
  "moduloAssistente",
  "moduloFuncionarios",
];

/**
 * @param {unknown} valor
 * @param {boolean} padrao
 * @returns {boolean}
 */

/**
 * Limita tamanho de strings persistidas (evita JSON gigante via IPC).
 * @param {unknown} valor
 * @param {number} max
 * @returns {string}
 */
function textoLimitado(valor, max) {
  return String(valor ?? "").trim().slice(0, max);
}

/**
 * Só aceita porta serial/USB de impressora — bloqueia caminhos de arquivo
 * arbitrários que o writeFile da impressão poderia sobrescrever.
 * @param {unknown} valor
 * @returns {string}
 */
function normalizarPortaImpressora(valor) {
  const p = String(valor ?? "").trim();
  if (!p) return "";
  if (p.length > 64) return "";
  if (/^COM\d{1,3}$/i.test(p)) return p.toUpperCase();
  if (/^\/dev\/(tty(USB|ACM|S|AMA)\d+|usb\/lp\d+)$/.test(p)) return p;
  return "";
}

function comoBool(valor, padrao = true) {
  if (
    valor === false ||
    valor === 0 ||
    valor === "0" ||
    valor === "false"
  ) {
    return false;
  }
  if (
    valor === true ||
    valor === 1 ||
    valor === "1" ||
    valor === "true"
  ) {
    return true;
  }
  return padrao;
}

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
    tema: "escuro",
    fonteUi: "sistema",
    densidadeUi: "confortavel",
    tamanhoUi: "medio",
    reduzirAnimacoes: false,
    ocultarFiado: false,
    ocultarDesconto: false,
    ocultarCliente: false,
    campoProdutoCusto: true,
    campoProdutoCodigos: true,
    campoProdutoCategoria: true,
    campoProdutoUnidade: true,
    campoProdutoCaixa: true,
    campoProdutoValidade: true,
    campoProdutoPromocao: true,
    moduloProdutos: true,
    moduloHistorico: true,
    moduloClientes: true,
    moduloRelatorios: true,
    moduloFornecedores: true,
    moduloGestao: true,
    moduloAssistente: true,
    moduloFuncionarios: true,
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
    lojaNome: textoLimitado(entrada.lojaNome ?? base.lojaNome, 120) || "CybhorPDV",
    lojaCnpj: textoLimitado(entrada.lojaCnpj ?? base.lojaCnpj, 32),
    lojaEndereco: textoLimitado(entrada.lojaEndereco ?? base.lojaEndereco, 200),
    lojaTelefone: textoLimitado(entrada.lojaTelefone ?? base.lojaTelefone, 40),
    impressoraNome: textoLimitado(entrada.impressoraNome ?? base.impressoraNome, 120),
    impressoraModo: textoLimitado(entrada.impressoraModo ?? base.impressoraModo, 32),
    impressoraPorta: normalizarPortaImpressora(
      entrada.impressoraPorta ?? base.impressoraPorta
    ),
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
    tema: entrada.tema === "claro" ? "claro" : "escuro",
    fonteUi: ["sistema", "moderna", "legivel", "tecnica"].includes(
      entrada.fonteUi
    )
      ? entrada.fonteUi
      : "sistema",
    densidadeUi: entrada.densidadeUi === "compacta" ? "compacta" : "confortavel",
    tamanhoUi: ["pequeno", "medio", "grande", "enorme"].includes(
      entrada.tamanhoUi
    )
      ? entrada.tamanhoUi
      : "medio",
    reduzirAnimacoes: comoBool(entrada.reduzirAnimacoes, false),
    ocultarFiado: comoBool(entrada.ocultarFiado, false),
    ocultarDesconto: comoBool(entrada.ocultarDesconto, false),
    ocultarCliente: comoBool(entrada.ocultarCliente, false),
    campoProdutoCusto: comoBool(entrada.campoProdutoCusto, true),
    campoProdutoCodigos: comoBool(entrada.campoProdutoCodigos, true),
    campoProdutoCategoria: comoBool(entrada.campoProdutoCategoria, true),
    campoProdutoUnidade: comoBool(entrada.campoProdutoUnidade, true),
    campoProdutoCaixa: comoBool(entrada.campoProdutoCaixa, true),
    campoProdutoValidade: comoBool(entrada.campoProdutoValidade, true),
    campoProdutoPromocao: comoBool(entrada.campoProdutoPromocao, true),
    moduloProdutos: comoBool(entrada.moduloProdutos, true),
    moduloHistorico: comoBool(entrada.moduloHistorico, true),
    moduloClientes: comoBool(entrada.moduloClientes, true),
    moduloRelatorios: comoBool(entrada.moduloRelatorios, true),
    moduloFornecedores: comoBool(entrada.moduloFornecedores, true),
    moduloGestao: comoBool(entrada.moduloGestao, true),
    moduloAssistente: comoBool(entrada.moduloAssistente, true),
    moduloFuncionarios: comoBool(entrada.moduloFuncionarios, true),
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
  if (parcial != null && (typeof parcial !== "object" || Array.isArray(parcial))) {
    throw new Error("Configuração inválida.");
  }
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
  normalizarPortaImpressora,
};
