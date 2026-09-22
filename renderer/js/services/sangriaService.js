import { ref, get, push, update, remove, onValue } from "../config/databaseClient.js";
import { obterDatabase } from "../config/databaseClient.js";
import { caminhoLoja } from "./tenantContext.js";


function paraCentavos(valor) {
  return Math.round((Number(valor) || 0) * 100);
}

function deCentavos(centavos) {
  return Math.round(Number(centavos) || 0) / 100;
}

function caminhoSangrias() {
  return caminhoLoja("sangrias");
}

/**
 * @param {object | null} valor
 * @returns {Array<object>}
 */
function mapear(valor) {
  if (!valor) return [];
  return Object.entries(valor).map(([id, dados]) => ({ id, ...dados }));
}

/**
 * Início e fim do dia local em ms.
 * @param {Date | string | number} [fonte]
 * @returns {{ inicio: number, fim: number }}
 */
export function limitesDoDia(fonte = new Date()) {
  const data =
    typeof fonte === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fonte)
      ? new Date(`${fonte}T12:00:00`)
      : fonte instanceof Date
        ? fonte
        : new Date(fonte);
  const inicio = new Date(
    data.getFullYear(),
    data.getMonth(),
    data.getDate()
  ).getTime();
  return { inicio, fim: inicio + 24 * 60 * 60 * 1000 };
}

/**
 * Competência AAAA-MM.
 * @param {Date | string | number} [fonte]
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
function normalizarSangria({
  valor,
  motivo,
  funcionarioId,
  funcionarioNome,
}) {
  const valorNumero = Number(valor);
  if (!Number.isFinite(valorNumero) || valorNumero <= 0) {
    throw new Error("Informe um valor de sangria maior que zero.");
  }
  const motivoLimpo = String(motivo || "").trim();
  if (motivoLimpo.length < 2) {
    throw new Error("Informe o motivo da sangria (ex.: troco, pagamento).");
  }

  return {
    valor: deCentavos(paraCentavos(valorNumero)),
    motivo: motivoLimpo,
    funcionarioId: String(funcionarioId || "").trim(),
    funcionarioNome: String(funcionarioNome || "").trim() || "—",
  };
}

/**
 * @returns {Promise<Array<object>>}
 */
export async function listarSangrias() {
  const db = await obterDatabase();
  const snapshot = await get(ref(db, caminhoSangrias()));
  return mapear(snapshot.val()).sort(
    (a, b) => (Number(b.criadoEm) || 0) - (Number(a.criadoEm) || 0)
  );
}

/**
 * @param {(lista: Array<object>) => void} callback
 * @returns {Promise<() => void>}
 */
export async function observarSangrias(callback) {
  const db = await obterDatabase();
  return onValue(ref(db, caminhoSangrias()), (snapshot) => {
    const lista = mapear(snapshot.val()).sort(
      (a, b) => (Number(b.criadoEm) || 0) - (Number(a.criadoEm) || 0)
    );
    callback(lista);
  });
}

/**
 * @param {object} dados
 * @returns {Promise<string>}
 */
export async function criarSangria(dados) {
  const normalizado = normalizarSangria(dados);
  const db = await obterDatabase();
  const agora = Date.now();
  const referencia = await push(ref(db, caminhoSangrias()), {
    ...normalizado,
    criadoEm: agora,
    competencia: competenciaDe(new Date(agora)),
  });
  return referencia.key;
}

/**
 * @param {string} id
 * @param {object} dados
 * @returns {Promise<void>}
 */
export async function atualizarSangria(id, dados) {
  if (!id) throw new Error("Sangria inválida.");
  const normalizado = normalizarSangria(dados);
  const db = await obterDatabase();
  await update(ref(db, `${caminhoSangrias()}/${id}`), {
    ...normalizado,
    atualizadoEm: Date.now(),
  });
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function excluirSangria(id) {
  if (!id) throw new Error("Sangria inválida.");
  const db = await obterDatabase();
  await remove(ref(db, `${caminhoSangrias()}/${id}`));
}

/**
 * @param {Array<object>} sangrias
 * @param {Date | string | number} [dia]
 * @returns {Array<object>}
 */
export function filtrarSangriasDoDia(sangrias, dia = new Date()) {
  const { inicio, fim } = limitesDoDia(dia);
  return (sangrias || []).filter((s) => {
    const t = Number(s.criadoEm) || 0;
    return t >= inicio && t < fim;
  });
}

/**
 * @param {Array<object>} sangrias
 * @param {string} [competencia] AAAA-MM
 * @returns {Array<object>}
 */
export function filtrarSangriasDaCompetencia(sangrias, competencia) {
  const alvo = competenciaDe(competencia || new Date());
  return (sangrias || []).filter((s) => {
    const comp =
      s.competencia ||
      (s.criadoEm ? competenciaDe(Number(s.criadoEm)) : "");
    return comp === alvo;
  });
}

/**
 * @param {Array<object>} sangrias
 * @param {Date | string | number} [dia]
 * @returns {number}
 */
export function somarSangriasDoDia(sangrias, dia = new Date()) {
  const centavos = filtrarSangriasDoDia(sangrias, dia).reduce(
    (soma, s) => soma + paraCentavos(s.valor),
    0
  );
  return deCentavos(centavos);
}

/**
 * @param {Array<object>} sangrias
 * @param {string} [competencia]
 * @returns {number}
 */
export function somarSangriasCompetencia(sangrias, competencia) {
  const centavos = filtrarSangriasDaCompetencia(sangrias, competencia).reduce(
    (soma, s) => soma + paraCentavos(s.valor),
    0
  );
  return deCentavos(centavos);
}
