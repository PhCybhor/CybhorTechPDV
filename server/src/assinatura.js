/**
 * Regras de assinatura mensal (SaaS).
 *
 * Política do produto:
 * - Atraso / inadimplência / validade vencida: o sistema CONTINUA LIBERADO,
 *   com aviso claro (admin + loja) de que será bloqueado em breve.
 * - Bloqueio duro só para quem nunca pagou (pendente) ou cancelou.
 */

// Status que ainda bloqueiam acesso (nunca liberou ou encerrou de vez).
const STATUS_BLOQUEADOS = new Set(['pendente', 'cancelada']);

// Status com acesso liberado + aviso de atraso.
const STATUS_ATRASADOS = new Set(['inadimplente']);

const MENSAGEM_ATRASO = 'Assinatura atrasada. Renove para evitar bloqueio.';
const MENSAGEM_PENDENTE = 'Assinatura pendente. Conclua o pagamento para liberar o sistema.';
const MENSAGEM_CANCELADA = 'Assinatura cancelada. Contrate novamente para continuar.';
const MENSAGEM_AUSENTE = 'Assinatura nao encontrada. Fale com o suporte.';

const PADRAO_DATA_ISO = /^\d{4}-\d{2}-\d{2}/;

function doisDigitos(numero) {
  return String(numero).padStart(2, '0');
}

/**
 * Data local do servidor no formato YYYY-MM-DD (comparável como texto).
 * @param {Date} [referencia]
 */
export function dataLocalIso(referencia = new Date()) {
  return `${referencia.getFullYear()}-${doisDigitos(referencia.getMonth() + 1)}-${doisDigitos(referencia.getDate())}`;
}

/**
 * Normaliza Date | 'YYYY-MM-DD…' para 'YYYY-MM-DD' ou null.
 * @param {unknown} valor
 * @returns {string | null}
 */
function comoDataIso(valor) {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : valor.toISOString().slice(0, 10);
  }
  const texto = String(valor).trim();
  return PADRAO_DATA_ISO.test(texto) ? texto.slice(0, 10) : null;
}

/**
 * Classifica a assinatura: bloqueada, atrasada ou em dia.
 * @param {string | null | undefined} status
 * @param {unknown} [validaAte]
 * @param {string} [hoje] data de referência YYYY-MM-DD (para testes).
 */
export function avaliarAssinatura(status, validaAte = null, hoje = dataLocalIso()) {
  const statusNormalizado = (status || '').trim().toLowerCase() || null;
  const validade = comoDataIso(validaAte);

  if (!statusNormalizado) {
    return {
      bloqueada: true,
      atrasada: false,
      status: null,
      statusExibicao: 'ausente',
      validaAte: validade,
      rotulo: 'Sem assinatura',
      mensagem: MENSAGEM_AUSENTE,
    };
  }

  if (STATUS_BLOQUEADOS.has(statusNormalizado)) {
    const pendente = statusNormalizado === 'pendente';
    return {
      bloqueada: true,
      atrasada: false,
      status: statusNormalizado,
      statusExibicao: statusNormalizado,
      validaAte: validade,
      rotulo: pendente ? 'Pendente' : 'Cancelada',
      mensagem: pendente ? MENSAGEM_PENDENTE : MENSAGEM_CANCELADA,
    };
  }

  const vencida = validade !== null && validade < hoje;
  if (STATUS_ATRASADOS.has(statusNormalizado) || vencida) {
    return {
      bloqueada: false,
      atrasada: true,
      status: statusNormalizado,
      statusExibicao: 'atrasada',
      validaAte: validade,
      rotulo: 'Atrasada',
      mensagem: MENSAGEM_ATRASO,
    };
  }

  return {
    bloqueada: false,
    atrasada: false,
    status: statusNormalizado,
    statusExibicao: statusNormalizado,
    validaAte: validade,
    rotulo: 'Ativa',
    mensagem: '',
  };
}

/** True só na primeira aprovação do payment_id (evita reprocessar webhook). */
export function deveEstenderAssinatura(statusAnterior, statusNovo) {
  if ((statusNovo || '').toLowerCase() !== 'approved') return false;
  return (statusAnterior || '').toLowerCase() !== 'approved';
}

/** Estorno/chargeback após aprovação -> inadimplente (acesso segue com aviso). */
export function deveMarcarInadimplente(statusAnterior, statusNovo) {
  const novo = (statusNovo || '').toLowerCase();
  if (!['refunded', 'charged_back', 'cancelled'].includes(novo)) return false;
  return (statusAnterior || '').toLowerCase() === 'approved';
}
