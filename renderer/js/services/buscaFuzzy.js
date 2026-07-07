import Fuse from "fuse.js";

/**
 * Servico de busca tolerante a erros de digitacao (fuzzy search).
 * Permite encontrar produtos mesmo com o nome escrito errado, funcionando
 * como uma "indicacao" do produto mais provavel.
 */

const OPCOES_FUSE = {
  includeScore: true,
  threshold: 0.45,
  ignoreLocation: true,
  minMatchCharLength: 2,
  keys: [
    { name: "nome", weight: 0.7 },
    { name: "categoria", weight: 0.2 },
    { name: "codigoBarras", weight: 0.1 },
  ],
};

let indice = null;

/**
 * (Re)constroi o indice de busca com a lista atual de produtos.
 * @param {Array<object>} produtos
 */
export function atualizarIndice(produtos) {
  indice = new Fuse(produtos || [], OPCOES_FUSE);
}

/**
 * Busca produtos por um termo, tolerando erros de digitacao.
 * @param {string} termo
 * @param {number} [limite=8]
 * @returns {Array<object>} produtos ordenados por relevancia
 */
export function buscar(termo, limite = 8) {
  const consulta = (termo || "").trim();
  if (!indice || consulta.length === 0) return [];

  return indice
    .search(consulta, { limit: limite })
    .map((resultado) => resultado.item);
}
