import { ref, push, update, get, onValue } from "../config/databaseClient.js";
import { obterDatabase } from "../config/databaseClient.js";
import { validarAdministrador } from "./authService.js";
import { caminhoLoja } from "./tenantContext.js";

function caminhoVendas() {
  return caminhoLoja("vendas");
}

function caminhoProdutos() {
  return caminhoLoja("produtos");
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
 * Normaliza pagamento único ou dividido.
 * @param {string} formaPagamento
 * @param {Array<{ tipo: string, valor: number }> | null | undefined} formasPagamento
 * @param {number} total
 */
function normalizarPagamentos(formaPagamento, formasPagamento, total) {
  if (Array.isArray(formasPagamento) && formasPagamento.length >= 2) {
    const partes = formasPagamento
      .map((p) => ({
        tipo: String(p.tipo || "").trim(),
        valor: Math.round((Number(p.valor) || 0) * 100) / 100,
      }))
      .filter((p) => p.tipo && p.valor > 0);
    const soma = partes.reduce((s, p) => s + p.valor, 0);
    if (partes.length < 2) {
      throw new Error("Pagamento dividido precisa de pelo menos 2 formas.");
    }
    if (Math.abs(soma - total) > 0.05) {
      throw new Error(
        `Soma das formas (${soma.toFixed(2)}) deve fechar o total (${total.toFixed(2)}).`
      );
    }
    return { formaPagamento: "misto", formasPagamento: partes };
  }
  const forma = String(formaPagamento || "dinheiro").trim() || "dinheiro";
  return {
    formaPagamento: forma,
    formasPagamento: [{ tipo: forma, valor: total }],
  };
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

  const db = await obterDatabase();
  const pathVendas = caminhoVendas();
  const pathProdutos = caminhoProdutos();

  const subtotal = itens.reduce(
    (soma, item) => soma + item.precoUnitario * item.quantidade,
    0
  );
  const descontoAplicado = Math.min(Math.max(0, Number(desconto) || 0), subtotal);
  const total = subtotal - descontoAplicado;
  const pagamentos = normalizarPagamentos(
    formaPagamento,
    formasPagamento,
    total
  );

  const referenciaVenda = push(ref(db, pathVendas));
  if (!referenciaVenda?.key) {
    throw new Error("Não foi possível gerar o identificador da venda.");
  }
  const atualizacoes = {};

  const criadoEm = Date.now();
  const itensVenda = itens.map((item) => {
    const custoRaw = item.custoUnitario;
    const custoUnitario =
      custoRaw === null || custoRaw === undefined || custoRaw === ""
        ? null
        : Number(custoRaw);
    return {
      produtoId: item.produtoId,
      nome: item.nome,
      quantidade: item.quantidade,
      precoUnitario: item.precoUnitario,
      subtotal: item.precoUnitario * item.quantidade,
      // Snapshot do custo no momento da venda (lucro histórico mesmo se o cadastro mudar)
      custoUnitario:
        custoUnitario !== null && Number.isFinite(custoUnitario)
          ? custoUnitario
          : null,
    };
  });

  atualizacoes[`${pathVendas}/${referenciaVenda.key}`] = {
    itens: itensVenda,
    subtotal,
    desconto: descontoAplicado,
    total,
    formaPagamento: fiado ? "fiado" : pagamentos.formaPagamento,
    formasPagamento: fiado
      ? [{ tipo: "fiado", valor: total }]
      : pagamentos.formasPagamento,
    funcionarioId: funcionario.id,
    funcionarioNome: funcionario.nome,
    clienteId: clienteId || null,
    clienteNome: clienteNome || null,
    fiado: Boolean(fiado),
    criadoEm,
  };

  for (const item of itens) {
    const novoEstoque = Math.max(0, item.estoqueAtual - item.quantidade);
    atualizacoes[`${pathProdutos}/${item.produtoId}/estoque`] = novoEstoque;
  }

  await update(ref(db), atualizacoes);

  return {
    id: referenciaVenda.key,
    total,
    subtotal,
    desconto: descontoAplicado,
    formaPagamento: pagamentos.formaPagamento,
    formasPagamento: pagamentos.formasPagamento,
    funcionarioNome: funcionario.nome,
    itens: itensVenda,
    criadoEm,
    cancelada: false,
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

  const db = await obterDatabase();
  const pathVendas = caminhoVendas();
  const pathProdutos = caminhoProdutos();
  const referencia = ref(db, `${pathVendas}/${vendaId}`);
  const snapshot = await get(referencia);
  if (!snapshot.exists()) throw new Error("Venda não encontrada.");

  const venda = snapshot.val();
  if (venda.cancelada) throw new Error("Esta venda já está cancelada.");

  const atualizacoes = {};
  const itens = Array.isArray(venda.itens) ? venda.itens : [];

  for (const item of itens) {
    if (!item.produtoId) continue;
    const refProduto = ref(db, `${pathProdutos}/${item.produtoId}`);
    const snapProduto = await get(refProduto);
    if (!snapProduto.exists()) continue;
    const estoqueAtual = Number(snapProduto.val().estoque) || 0;
    const qtd = Number(item.quantidade) || 0;
    atualizacoes[`${pathProdutos}/${item.produtoId}/estoque`] =
      estoqueAtual + qtd;
  }

  atualizacoes[`${pathVendas}/${vendaId}/cancelada`] = true;
  atualizacoes[`${pathVendas}/${vendaId}/canceladoEm`] = Date.now();
  atualizacoes[`${pathVendas}/${vendaId}/canceladoPor`] =
    canceladoPorNome || "admin";
  atualizacoes[`${pathVendas}/${vendaId}/motivoCancelamento`] = String(
    motivo || ""
  ).trim();

  await update(ref(db), atualizacoes);
  return { id: vendaId, ...venda, cancelada: true };
}
