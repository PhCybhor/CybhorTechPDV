import { config } from "../config.js";
import { ErroNegocio } from "../erros.js";
import { arredondarCentavos } from "./entrada.js";

const PLANOS_BASE = {
  teste: { id: "teste", nome: "Teste gratis", meses: 1, dias: 30, rotuloPeriodo: "/30 dias", destaque: false, gratis: true },
  mensal: { id: "mensal", nome: "Mensal", meses: 1, rotuloPeriodo: "/mes", destaque: false },
  semestral: { id: "semestral", nome: "Semestral", meses: 6, rotuloPeriodo: "/6 meses", destaque: true },
  anual: { id: "anual", nome: "Anual", meses: 12, rotuloPeriodo: "/ano", destaque: false },
};

function valorPadrao(planoId) {
  if (planoId === "teste") return 0;
  if (planoId === "semestral") return config.assinaturaValorSemestral;
  if (planoId === "anual") return config.assinaturaValorAnual;
  return config.assinaturaValorMensal;
}

function montarPlano(planoId) {
  const base = PLANOS_BASE[planoId];
  return { ...base, valor: arredondarCentavos(valorPadrao(planoId)), gratis: Boolean(base.gratis) };
}

/** @returns {object[]} planos à venda com os valores do .env. */
export function catalogoPlanos() {
  return Object.keys(PLANOS_BASE).map(montarPlano);
}

/**
 * @param {unknown} planoId
 * @throws {ErroNegocio} plano inexistente.
 */
export function obterPlano(planoId) {
  const chave = String(planoId || "mensal").trim().toLowerCase();
  if (!Object.hasOwn(PLANOS_BASE, chave)) {
    throw new ErroNegocio("Plano invalido. Escolha teste, mensal, semestral ou anual.");
  }
  return montarPlano(chave);
}
