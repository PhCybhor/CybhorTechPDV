/**
 * Regras de assinatura (SaaS).
 *
 * Política do produto:
 * - Atraso / inadimplência / validade vencida: sistema CONTINUA LIBERADO,
 *   com aviso claro (admin + loja) de que será bloqueado em breve.
 * - Bloqueio duro só para quem nunca pagou (pendente) ou cancelou.
 */

const STATUS_BLOQUEADOS = new Set(["pendente", "cancelada"]);
const STATUS_ATRASADOS = new Set(["inadimplente"]);

export const MENSAGEM_ATRASO = "Assinatura atrasada. Renove para evitar bloqueio.";
export const MENSAGEM_PENDENTE = "Assinatura pendente. Conclua o pagamento para liberar o sistema.";
export const MENSAGEM_CANCELADA = "Assinatura cancelada. Contrate novamente para continuar.";
export const MENSAGEM_AUSENTE = "Assinatura nao encontrada. Fale com o suporte.";

/** @returns {string} data de hoje no fuso do servidor, 'AAAA-MM-DD'. */
export function hojeIso() {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

/**
 * Normaliza a validade para 'AAAA-MM-DD' (comparável como texto).
 * @param {unknown} valor
 * @returns {string | null}
 */
function comoDataIso(valor) {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.toISOString().slice(0, 10);
  const texto = String(valor).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
}

/**
 * Classifica a assinatura: bloqueada, atrasada ou em dia.
 * @param {string | null | undefined} status
 * @param {unknown} [validaAte]
 * @param {{ hoje?: string }} [opcoes] hoje em 'AAAA-MM-DD' (testes).
 */
export function avaliarAssinatura(status, validaAte = null, { hoje } = {}) {
  const referencia = hoje || hojeIso();
  const statusNormalizado = String(status ?? "").trim().toLowerCase() || null;
  const validade = comoDataIso(validaAte);

  if (!statusNormalizado) {
    return {
      bloqueada: true,
      atrasada: false,
      status: null,
      statusExibicao: "ausente",
      validaAte: validade,
      rotulo: "Sem assinatura",
      mensagem: MENSAGEM_AUSENTE,
    };
  }

  if (STATUS_BLOQUEADOS.has(statusNormalizado)) {
    const pendente = statusNormalizado === "pendente";
    return {
      bloqueada: true,
      atrasada: false,
      status: statusNormalizado,
      statusExibicao: statusNormalizado,
      validaAte: validade,
      rotulo: pendente ? "Pendente" : "Cancelada",
      mensagem: pendente ? MENSAGEM_PENDENTE : MENSAGEM_CANCELADA,
    };
  }

  const vencida = validade !== null && validade < referencia;
  if (STATUS_ATRASADOS.has(statusNormalizado) || vencida) {
    return {
      bloqueada: false,
      atrasada: true,
      status: statusNormalizado,
      statusExibicao: "atrasada",
      validaAte: validade,
      rotulo: "Atrasada",
      mensagem: MENSAGEM_ATRASO,
    };
  }

  return {
    bloqueada: false,
    atrasada: false,
    status: statusNormalizado,
    statusExibicao: statusNormalizado,
    validaAte: validade,
    rotulo: "Ativa",
    mensagem: "",
  };
}

/** Só na primeira aprovação do payment_id (evita reprocessar webhook). */
export function deveEstenderAssinatura(statusAnterior, statusNovo) {
  if (String(statusNovo ?? "").toLowerCase() !== "approved") return false;
  return String(statusAnterior ?? "").toLowerCase() !== "approved";
}

/** Estorno/chargeback após aprovação -> inadimplente (acesso segue com aviso). */
export function deveMarcarInadimplente(statusAnterior, statusNovo) {
  const novo = String(statusNovo ?? "").toLowerCase();
  if (!["refunded", "charged_back", "cancelled"].includes(novo)) return false;
  return String(statusAnterior ?? "").toLowerCase() === "approved";
}
