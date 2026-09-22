import { ref, get, onValue } from "../config/databaseClient.js";
import { obterDatabase } from "../config/databaseClient.js";
import { validarAdministrador } from "./authService.js";
import { caminhoLoja } from "./tenantContext.js";
import { apiRequest } from "../config/apiClient.js";

function caminhoVendas() {
  return caminhoLoja("vendas");
}

/**
 * Normaliza o snapshot de vendas em uma lista de objetos com id.
 * @param {object | null} valor
 * @returns {Array<object>}
 */
function mapearVendas(valor) {
  if (!valor) return [];
  // Documento pode ser mapa {id: venda} ou, por bug antigo, a própria venda na raiz.
  if (Array.isArray(valor.itens) && valor.criadoEm != null && !valor.id) {
    return [{ id: "legado", ...valor }];
  }
  return Object.entries(valor)
    .filter(([, dados]) => dados && typeof dados === "object" && !Array.isArray(dados))
    .filter(([, dados]) => dados.criadoEm != null || Array.isArray(dados.itens))
    .map(([id, dados]) => ({ id, ...dados }));
}

/**
 * Retorna todas as vendas registradas (leitura única).
 * @returns {Promise<Array<object>>}
 */
export async function listarVendas() {
  const db = await obterDatabase();
  const snapshot = await get(ref(db, caminhoVendas()));
  return mapearVendas(snapshot.val());
}

/**
 * Observa a lista de vendas em tempo real.
 * @param {(vendas: Array<object>) => void} callback
 * @returns {Promise<() => void>}
 */
export async function observarVendas(callback) {
  const db = await obterDatabase();
  return onValue(ref(db, caminhoVendas()), (snapshot) => {
    callback(mapearVendas(snapshot.val()));
  });
}

/**
 * Registra uma venda e dá baixa no estoque dos produtos de forma atômica.
 */
export async function registrarVenda({
  itens,
  desconto = 0,
  formaPagamento,
  formasPagamento = null,
  funcionario,
  clienteId = null,
  clienteNome = null,
  fiado = false,
}) {
  if (!Array.isArray(itens) || itens.length === 0)
    throw new Error("Adicione ao menos um item para finalizar a venda.");
  if (!funcionario?.id) throw new Error("Funcionário inválido.");

  // Estoque é decrementado no servidor com lock — evita corrida entre caixas.
  const venda = await apiRequest("/api/caixa/venda", {
    method: "POST",
    body: {
      itens: itens.map((item) => ({
        produtoId: item.produtoId,
        nome: item.nome,
        quantidade: item.quantidade,
        precoUnitario: item.precoUnitario,
        custoUnitario:
          item.custoUnitario === null ||
          item.custoUnitario === undefined ||
          item.custoUnitario === ""
            ? null
            : Number(item.custoUnitario),
      })),
      desconto: Number(desconto) || 0,
      formaPagamento,
      formasPagamento,
      clienteId: clienteId || null,
      clienteNome: clienteNome || null,
      fiado: Boolean(fiado),
    },
  });

  return {
    id: venda.id,
    total: venda.total,
    subtotal: venda.subtotal,
    desconto: venda.desconto,
    formaPagamento: venda.formaPagamento,
    formasPagamento: venda.formasPagamento,
    funcionarioNome: venda.funcionarioNome || funcionario.nome,
    itens: venda.itens || [],
    criadoEm: venda.criadoEm,
    cancelada: false,
    clienteId: venda.clienteId || clienteId || null,
    clienteNome: venda.clienteNome || clienteNome || null,
    fiado: Boolean(venda.fiado ?? fiado),
  };
}

/**
 * Cancela uma venda, devolve o estoque e exige senha de administrador.
 */
export async function cancelarVenda({
  vendaId,
  adminUsuario,
  adminSenha,
  motivo = "",
  canceladoPorNome = "",
}) {
  if (!vendaId) throw new Error("Venda inválida.");

  const adminOk = await validarAdministrador(adminUsuario, adminSenha);
  if (!adminOk) throw new Error("Credenciais de administrador inválidas.");

  // Devolução de estoque no servidor com lock — sem corrida no cancelamento.
  return apiRequest("/api/caixa/cancelar-venda", {
    method: "POST",
    body: {
      vendaId,
      motivo: String(motivo || "").trim(),
      canceladoPorNome: canceladoPorNome || "admin",
    },
  });
}
