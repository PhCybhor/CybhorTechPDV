/**
 * Preferências locais do caixa por funcionário (favoritos e mais usados).
 * Não sobe ao PostgreSQL — só facilita o dia a dia neste terminal.
 */

const PREFIXO = "cybhor_caixa_";

/**
 * @param {string | null | undefined} funcionarioId
 * @returns {string}
 */
function chave(funcionarioId) {
  return `${PREFIXO}${funcionarioId || "anon"}`;
}

/**
 * @param {string | null | undefined} funcionarioId
 * @returns {{ favoritos: string[], usos: Record<string, number>, ultimoProdutoId: string | null }}
 */
export function lerPreferenciasCaixa(funcionarioId) {
  try {
    const bruto = localStorage.getItem(chave(funcionarioId));
    if (!bruto) {
      return {
        favoritos: [],
        usos: {},
        ultimoProdutoId: null,
        metaDia: 0,
      };
    }
    const dados = JSON.parse(bruto);
    return {
      favoritos: Array.isArray(dados.favoritos) ? dados.favoritos.slice(0, 24) : [],
      usos:
        dados.usos && typeof dados.usos === "object" && !Array.isArray(dados.usos)
          ? dados.usos
          : {},
      ultimoProdutoId: dados.ultimoProdutoId || null,
      metaDia: Number(dados.metaDia) || 0,
    };
  } catch {
    return {
      favoritos: [],
      usos: {},
      ultimoProdutoId: null,
      metaDia: 0,
    };
  }
}

/**
 * @param {string | null | undefined} funcionarioId
 * @param {{ favoritos?: string[], usos?: Record<string, number>, ultimoProdutoId?: string | null }} parcial
 */
export function salvarPreferenciasCaixa(funcionarioId, parcial) {
  const atual = lerPreferenciasCaixa(funcionarioId);
  const proximo = {
    favoritos: parcial.favoritos ?? atual.favoritos,
    usos: parcial.usos ?? atual.usos,
    ultimoProdutoId:
      parcial.ultimoProdutoId !== undefined
        ? parcial.ultimoProdutoId
        : atual.ultimoProdutoId,
    metaDia:
      parcial.metaDia !== undefined ? Number(parcial.metaDia) || 0 : atual.metaDia,
  };
  localStorage.setItem(chave(funcionarioId), JSON.stringify(proximo));
  return proximo;
}

/**
 * @param {string | null | undefined} funcionarioId
 * @param {string} produtoId
 * @returns {boolean} true se ficou favorito
 */
export function alternarFavorito(funcionarioId, produtoId) {
  if (!produtoId) return false;
  const atual = lerPreferenciasCaixa(funcionarioId);
  const set = new Set(atual.favoritos);
  if (set.has(produtoId)) set.delete(produtoId);
  else set.add(produtoId);
  const favoritos = Array.from(set).slice(0, 24);
  salvarPreferenciasCaixa(funcionarioId, { favoritos });
  return set.has(produtoId);
}

/**
 * @param {string | null | undefined} funcionarioId
 * @param {string} produtoId
 * @param {number} [quantidade=1]
 */
export function registrarUsoProduto(funcionarioId, produtoId, quantidade = 1) {
  if (!produtoId) return;
  const atual = lerPreferenciasCaixa(funcionarioId);
  const usos = { ...atual.usos };
  usos[produtoId] = (Number(usos[produtoId]) || 0) + Math.max(1, Number(quantidade) || 1);
  salvarPreferenciasCaixa(funcionarioId, {
    usos,
    ultimoProdutoId: produtoId,
  });
}

/**
 * @param {string | null | undefined} funcionarioId
 * @param {Array<object>} produtos
 * @param {number} [limite=8]
 * @returns {Array<object>}
 */
export function listarMaisUsados(funcionarioId, produtos, limite = 8) {
  const { usos, favoritos } = lerPreferenciasCaixa(funcionarioId);
  const mapa = new Map((produtos || []).map((p) => [p.id, p]));
  const idsFavoritos = new Set(favoritos);

  const porUso = Object.entries(usos)
    .map(([id, qtd]) => ({ id, qtd: Number(qtd) || 0 }))
    .filter((x) => mapa.has(x.id) && (Number(mapa.get(x.id).estoque) || 0) > 0)
    .sort((a, b) => b.qtd - a.qtd)
    .map((x) => mapa.get(x.id));

  const favs = favoritos
    .map((id) => mapa.get(id))
    .filter((p) => p && (Number(p.estoque) || 0) > 0);

  const vistos = new Set();
  const lista = [];
  for (const p of [...favs, ...porUso]) {
    if (!p || vistos.has(p.id)) continue;
    vistos.add(p.id);
    lista.push({ ...p, _favorito: idsFavoritos.has(p.id) });
    if (lista.length >= limite) break;
  }
  return lista;
}

/**
 * Extrai quantidade no final da busca: "coca*3", "789*2", "agua x 4".
 * @param {string} termo
 * @returns {{ consulta: string, quantidade: number }}
 */
export function parseBuscaComQuantidade(termo) {
  const bruto = String(termo || "").trim();
  const match = bruto.match(/^(.*?)(?:\s*[*xX]\s*|\*)(\d{1,4})\s*$/);
  if (!match) {
    return { consulta: bruto, quantidade: 1 };
  }
  const consulta = (match[1] || "").trim();
  const quantidade = Math.max(1, Math.min(999, Number(match[2]) || 1));
  if (!consulta) {
    return { consulta: "", quantidade };
  }
  return { consulta, quantidade };
}

/**
 * @param {string | null | undefined} funcionarioId
 * @param {number} meta
 */
export function salvarMetaDia(funcionarioId, meta) {
  const valor = Math.max(0, Number(meta) || 0);
  salvarPreferenciasCaixa(funcionarioId, { metaDia: valor });
  return valor;
}

/** Dicas curtas rotativas após finalizar venda. */
export const DICAS_OPERADOR = [
  "Dica: digite o nome e *3 (ex.: água*3) para adicionar 3 de uma vez.",
  "Dica: F9 repete o último produto. F5–F8 escolhem a forma de pagamento.",
  "Dica: fixe produtos no ⭐ Favoritos para aparecerem no topo do caixa.",
  "Dica: F2 volta para a busca. Esc limpa a busca sem perder o carrinho.",
  "Dica: no dinheiro, use Exato / +10 / +50 para calcular o troco rápido.",
  "Dica: F1 abre o guia completo de atalhos do caixa.",
  "Dica: filtre por categoria nos chips acima da grade para achar mais rápido.",
];
