import { config } from './config.js';
import { ErroNegocio } from './errors.js';

const PLANOS_BASE = {
  teste: {
    id: 'teste',
    nome: 'Teste gratis',
    meses: 1,
    dias: 30,
    rotuloPeriodo: '/30 dias',
    destaque: false,
    gratis: true,
  },
  mensal: { id: 'mensal', nome: 'Mensal', meses: 1, rotuloPeriodo: '/mes', destaque: false },
  semestral: {
    id: 'semestral',
    nome: 'Semestral',
    meses: 6,
    rotuloPeriodo: '/6 meses',
    destaque: true,
  },
  anual: { id: 'anual', nome: 'Anual', meses: 12, rotuloPeriodo: '/ano', destaque: false },
};

function arredondarDuasCasas(valor) {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

function valorPadrao(planoId) {
  if (planoId === 'teste') return 0;
  if (planoId === 'semestral') return config.assinaturaValorSemestral;
  if (planoId === 'anual') return config.assinaturaValorAnual;
  return config.assinaturaValorMensal;
}

function montarPlano(planoId) {
  const meta = PLANOS_BASE[planoId];
  return { ...meta, valor: arredondarDuasCasas(valorPadrao(planoId)), gratis: Boolean(meta.gratis) };
}

/** @returns {Array<Record<string, any>>} planos oferecidos no site, com preço vigente. */
export function catalogoPlanos() {
  return Object.keys(PLANOS_BASE).map(montarPlano);
}

/**
 * @param {string} planoId
 * @returns {Record<string, any>}
 * @throws {ErroNegocio} quando o plano não existe.
 */
export function obterPlano(planoId) {
  const chave = (typeof planoId === 'string' ? planoId : '').trim().toLowerCase() || 'mensal';
  if (!Object.hasOwn(PLANOS_BASE, chave)) {
    throw new ErroNegocio('Plano invalido. Escolha teste, mensal, semestral ou anual.');
  }
  return montarPlano(chave);
}
