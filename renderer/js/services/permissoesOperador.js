/**
 * Permissões do operador de caixa, definidas pelo administrador da loja.
 * Admin sempre tem tudo; operador usa estes flags (padrão = comportamento atual).
 */

export const PERMISSOES_OPERADOR = Object.freeze([
  { chave: "cadastrarProduto", rotulo: "Cadastrar produto", padrao: true },
  { chave: "editarProduto", rotulo: "Editar produto", padrao: true },
  { chave: "excluirProduto", rotulo: "Excluir produto", padrao: false },
  { chave: "ajustarEstoque", rotulo: "Ajustar estoque (+1 / −1)", padrao: true },
  { chave: "aplicarDesconto", rotulo: "Aplicar desconto no caixa", padrao: true },
  { chave: "venderFiado", rotulo: "Venda fiado", padrao: true },
  { chave: "verHistorico", rotulo: "Ver histórico de vendas", padrao: true },
  { chave: "cancelarVenda", rotulo: "Cancelar venda", padrao: false },
  { chave: "fazerSangria", rotulo: "Fazer sangria", padrao: true },
  { chave: "gerenciarClientes", rotulo: "Cadastrar e editar clientes", padrao: false },
]);

const PADROES = Object.freeze(
  Object.fromEntries(PERMISSOES_OPERADOR.map((p) => [p.chave, p.padrao]))
);

/**
 * @param {unknown} bruto
 * @returns {Record<string, boolean>}
 */
export function normalizarPermissoes(bruto) {
  const entrada = bruto && typeof bruto === "object" && !Array.isArray(bruto)
    ? bruto
    : {};
  /** @type {Record<string, boolean>} */
  const saida = {};
  for (const item of PERMISSOES_OPERADOR) {
    if (Object.prototype.hasOwnProperty.call(entrada, item.chave)) {
      saida[item.chave] = entrada[item.chave] !== false && entrada[item.chave] !== "false" && entrada[item.chave] !== 0;
    } else {
      saida[item.chave] = item.padrao;
    }
  }
  return saida;
}

/**
 * @param {object | null | undefined} funcionario
 * @param {string} chave
 * @returns {boolean}
 */
export function pode(funcionario, chave) {
  if (!funcionario) return false;
  if (funcionario.cargo === "admin") return true;
  return normalizarPermissoes(funcionario.permissoes)[chave] === true;
}

/**
 * HTML de checkboxes de permissão (só operador).
 * @param {string} nameAttr
 * @param {object | null | undefined} atuais
 * @returns {string}
 */
export function htmlCheckboxesPermissoes(nameAttr, atuais) {
  const valores = normalizarPermissoes(atuais);
  return PERMISSOES_OPERADOR.map((item) => {
    const marcado = valores[item.chave] !== false;
    return `
    <label class="perm-chip ${marcado ? "ativo" : ""}">
      <input type="checkbox" name="${nameAttr}" value="${item.chave}" ${
        marcado ? "checked" : ""
      } />
      <span>${item.rotulo}</span>
    </label>`;
  }).join("");
}

/**
 * @param {ParentNode} raiz
 * @param {string} nameAttr
 * @returns {Record<string, boolean>}
 */
export function lerPermissoesDoForm(raiz, nameAttr) {
  /** @type {Record<string, boolean>} */
  const valores = { ...PADROES };
  for (const item of PERMISSOES_OPERADOR) {
    valores[item.chave] = false;
  }
  if (!raiz) return valores;
  raiz.querySelectorAll(`input[type="checkbox"][name="${nameAttr}"]`).forEach((el) => {
    if (valores[el.value] !== undefined) {
      valores[el.value] = Boolean(el.checked);
    }
  });
  return valores;
}
