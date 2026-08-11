import { ref, push, onValue, query, orderByChild, limitToLast, get } from "../config/databaseClient.js";
import { obterDatabase } from "../config/databaseClient.js";
import { caminhoLoja } from "./tenantContext.js";

/**
 * Log de auditoria da loja (desconto, cancelamento, sangria, abertura…).
 * @param {{ tipo: string, mensagem: string, funcionario?: object|null, meta?: object }} p
 */
export async function registrarAuditoria({ tipo, mensagem, funcionario = null, meta = {} }) {
  try {
    const db = await obterDatabase();
    await push(ref(db, caminhoLoja("auditoria")), {
      tipo: String(tipo || "evento").slice(0, 40),
      mensagem: String(mensagem || "").slice(0, 500),
      funcionarioId: funcionario?.id || null,
      funcionarioNome: funcionario?.nome || null,
      meta: meta && typeof meta === "object" ? meta : {},
      criadoEm: Date.now(),
    });
  } catch {
    /* não bloqueia a operação principal */
  }
}

/**
 * @param {(lista: Array<object>) => void} callback
 * @param {number} [limite=80]
 */
export async function observarAuditoria(callback, limite = 80) {
  const db = await obterDatabase();
  const consulta = query(
    ref(db, caminhoLoja("auditoria")),
    orderByChild("criadoEm"),
    limitToLast(limite)
  );
  return onValue(consulta, (snap) => {
    if (!snap.exists()) {
      callback([]);
      return;
    }
    const lista = Object.entries(snap.val())
      .map(([id, d]) => ({ id, ...d }))
      .sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
    callback(lista);
  });
}

export async function listarAuditoriaRecente(limite = 80) {
  const db = await obterDatabase();
  const consulta = query(
    ref(db, caminhoLoja("auditoria")),
    orderByChild("criadoEm"),
    limitToLast(limite)
  );
  const snap = await get(consulta);
  if (!snap.exists()) return [];
  return Object.entries(snap.val())
    .map(([id, d]) => ({ id, ...d }))
    .sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
}
