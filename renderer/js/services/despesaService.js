import { ref, get, push, update, remove, onValue } from "firebase/database";
import { obterDatabase } from "../config/firebaseClient.js";
import { caminhoLoja } from "./tenantContext.js";

export const TIPOS_DESPESA = [
  { id: "aluguel", rotulo: "Aluguel" },
  { id: "luz", rotulo: "Energia elétrica" },
  { id: "agua", rotulo: "Água" },
  { id: "internet", rotulo: "Internet / telefone" },
  { id: "folha", rotulo: "Folha / salários" },
  { id: "marketing", rotulo: "Marketing / anúncios" },
  { id: "imposto", rotulo: "Impostos / taxas" },
  { id: "outro", rotulo: "Outro" },
];

function caminhoDespesas() {
  return caminhoLoja("despesas");
}

/**
 * @param {object | null} valor
 * @returns {Array<object>}
 */
function mapearDespesas(valor) {
  if (!valor) return [];
  return Object.entries(valor).map(([id, dados]) => ({ id, ...dados }));
}

/**
 * Competência no formato AAAA-MM a partir de Date ou string.
 * @param {Date | string} [fonte]
 * @returns {string}
 */
export function competenciaDe(fonte = new Date()) {
  if (typeof fonte === "string" && /^\d{4}-\d{2}$/.test(fonte)) return fonte;
  const data = fonte instanceof Date ? fonte : new Date(fonte);
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  return `${ano}-${mes}`;
}

/**
 * @param {object} dados
 * @returns {object}
 */
function normalizarDespesa({ tipo, descricao, valor, competencia, recorrente }) {
  const tipoLimpo = String(tipo || "outro").trim();
  const tiposValidos = new Set(TIPOS_DESPESA.map((t) => t.id));
  if (!tiposValidos.has(tipoLimpo)) {
    throw new Error("Tipo de despesa inválido.");
  }

  const valorNumero = Number(valor);
  if (!Number.isFinite(valorNumero) || valorNumero < 0) {
    throw new Error("Valor da despesa inválido.");
  }

  const comp = competenciaDe(competencia || new Date());
  if (!/^\d{4}-\d{2}$/.test(comp)) {
    throw new Error("Competência inválida (use AAAA-MM).");
  }

  return {
    tipo: tipoLimpo,
    descricao: String(descricao || "").trim(),
    valor: valorNumero,
    competencia: comp,
    recorrente: Boolean(recorrente),
  };
}

/**
 * @returns {Promise<Array<object>}
 */
export async function listarDespesas() {
  const db = await obterDatabase();
  const snapshot = await get(ref(db, caminhoDespesas()));
  return mapearDespesas(snapshot.val());
}

/**
 * @param {(despesas: Array<object>) => void} callback
 * @returns {Promise<import("firebase/database").Unsubscribe>}
 */
export async function observarDespesas(callback) {
  const db = await obterDatabase();
  return onValue(ref(db, caminhoDespesas()), (snapshot) => {
    callback(mapearDespesas(snapshot.val()));
  });
}

/**
 * @param {object} despesa
 * @returns {Promise<string>}
 */
export async function criarDespesa(despesa) {
  const dados = normalizarDespesa(despesa);
  const db = await obterDatabase();
  const referencia = await push(ref(db, caminhoDespesas()), {
    ...dados,
    criadoEm: Date.now(),
  });
  return referencia.key;
}

/**
 * @param {string} despesaId
 * @param {object} despesa
 * @returns {Promise<void>}
 */
export async function atualizarDespesa(despesaId, despesa) {
  if (!despesaId) throw new Error("Despesa inválida.");
  const dados = normalizarDespesa(despesa);
  const db = await obterDatabase();
  await update(ref(db, `${caminhoDespesas()}/${despesaId}`), {
    ...dados,
    atualizadoEm: Date.now(),
  });
}

/**
 * @param {string} despesaId
 * @returns {Promise<void>}
 */
export async function excluirDespesa(despesaId) {
  if (!despesaId) throw new Error("Despesa inválida.");
  const db = await obterDatabase();
  await remove(ref(db, `${caminhoDespesas()}/${despesaId}`));
}

/**
 * Soma despesas de uma competência (AAAA-MM).
 * @param {Array<object>} despesas
 * @param {string} competencia
 * @returns {number}
 */
export function somarDespesasCompetencia(despesas, competencia) {
  const alvo = competenciaDe(competencia);
  return (despesas || [])
    .filter((d) => d.competencia === alvo)
    .reduce((soma, d) => soma + (Number(d.valor) || 0), 0);
}

/**
 * @param {string} tipoId
 * @returns {string}
 */
export function rotuloTipoDespesa(tipoId) {
  return TIPOS_DESPESA.find((t) => t.id === tipoId)?.rotulo || tipoId || "Outro";
}

/**
 * Competência imediatamente anterior (AAAA-MM).
 * @param {string} competencia
 */
export function competenciaAnterior(competencia) {
  const [anoS, mesS] = String(competencia).split("-");
  let ano = Number(anoS);
  let mes = Number(mesS) - 1;
  if (mes < 1) {
    mes = 12;
    ano -= 1;
  }
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

/**
 * Clona despesas marcadas como recorrentes do mês anterior para a competência atual
 * quando ainda não existem (evita duplicar se já houver mesma tipo+descrição+valor).
 * @param {string} [competenciaAlvo]
 * @returns {Promise<number>} quantidade criada
 */
export async function garantirDespesasRecorrentes(competenciaAlvo) {
  const alvo = competenciaDe(competenciaAlvo || new Date());
  const anterior = competenciaAnterior(alvo);
  const lista = await listarDespesas();
  const doAlvo = lista.filter((d) => d.competencia === alvo);
  const recorrentesAnt = lista.filter(
    (d) => d.competencia === anterior && d.recorrente
  );

  let criadas = 0;
  for (const base of recorrentesAnt) {
    const jaExiste = doAlvo.some(
      (d) =>
        d.tipo === base.tipo &&
        (d.descricao || "") === (base.descricao || "") &&
        Number(d.valor) === Number(base.valor)
    );
    if (jaExiste) continue;
    await criarDespesa({
      tipo: base.tipo,
      descricao: base.descricao,
      valor: base.valor,
      competencia: alvo,
      recorrente: true,
    });
    criadas += 1;
  }
  return criadas;
}
