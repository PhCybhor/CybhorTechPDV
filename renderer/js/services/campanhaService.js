/**
 * Campanhas geradas pela CybhorIA — salvas localmente por loja
 * para virar plano de ação (não só texto na tela).
 */

const PREFIXO = "cybhor_campanhas_";

/**
 * @param {string | null | undefined} lojaId
 */
function chave(lojaId) {
  return `${PREFIXO}${lojaId || "local"}`;
}

/**
 * @param {string | null | undefined} lojaId
 * @returns {Array<object>}
 */
export function listarCampanhas(lojaId) {
  try {
    const bruto = localStorage.getItem(chave(lojaId));
    if (!bruto) return [];
    const lista = JSON.parse(bruto);
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

/**
 * @param {string | null | undefined} lojaId
 * @param {Array<object>} lista
 */
function salvarLista(lojaId, lista) {
  localStorage.setItem(chave(lojaId), JSON.stringify(lista.slice(0, 40)));
}

/**
 * @param {string | null | undefined} lojaId
 * @param {{ titulo?: string, texto: string, modo?: string }} dados
 */
export function salvarCampanha(lojaId, dados) {
  const texto = String(dados.texto || "").trim();
  if (!texto) throw new Error("Nada para salvar na campanha.");
  const lista = listarCampanhas(lojaId);
  const item = {
    id: `c_${Date.now().toString(36)}`,
    titulo: String(dados.titulo || "Campanha CybhorIA").trim().slice(0, 80),
    texto,
    modo: dados.modo || "concorrencia",
    status: "rascunho",
    criadoEm: Date.now(),
  };
  lista.unshift(item);
  salvarLista(lojaId, lista);
  return item;
}

/**
 * @param {string | null | undefined} lojaId
 * @param {string} id
 * @param {"rascunho"|"ativa"|"feita"} status
 */
export function atualizarStatusCampanha(lojaId, id, status) {
  const lista = listarCampanhas(lojaId).map((c) =>
    c.id === id ? { ...c, status } : c
  );
  salvarLista(lojaId, lista);
}

/**
 * @param {string | null | undefined} lojaId
 * @param {string} id
 */
export function excluirCampanha(lojaId, id) {
  salvarLista(
    lojaId,
    listarCampanhas(lojaId).filter((c) => c.id !== id)
  );
}
