import { randomUUID } from "node:crypto";
import * as db from "../db.js";
import { ErroNegocio } from "../erros.js";
import { arredondarCentavos, converterDecimal, converterInteiro, ehObjetoSimples, lerTexto } from "../regras/entrada.js";
import { carregarRecurso, salvarRecurso } from "./dadosServico.js";

const FORMAS_SIMPLES = new Set(["dinheiro", "credito", "debito", "pix", "fiado", "misto"]);
const ID_LOCAL_VALIDO = /^[a-f0-9]{32}$/;
// Venda guardada sem internet pode chegar dias depois; mais que isso é relógio errado.
const JANELA_VENDA_OFFLINE_MS = 30 * 24 * 60 * 60 * 1000;
const TOLERANCIA_RELOGIO_MS = 5 * 60 * 1000;
const TOLERANCIA_SOMA_FORMAS = 0.05;

function lerIdLocal(valor) {
  const texto = String(valor || "").trim().toLowerCase();
  return ID_LOCAL_VALIDO.test(texto) ? texto : null;
}

function criadoEmOffline(valor, agora) {
  const informado = converterInteiro(valor);
  if (informado === null) return agora;
  const dentroDaJanela = informado >= agora - JANELA_VENDA_OFFLINE_MS && informado <= agora + TOLERANCIA_RELOGIO_MS;
  return dentroDaJanela ? informado : agora;
}

function respostaVenda(vendaId, venda) {
  return {
    id: vendaId,
    total: venda.total ?? null,
    subtotal: venda.subtotal ?? null,
    desconto: venda.desconto ?? null,
    formaPagamento: venda.formaPagamento ?? null,
    formasPagamento: venda.formasPagamento ?? null,
    funcionarioNome: venda.funcionarioNome ?? null,
    itens: venda.itens || [],
    criadoEm: venda.criadoEm ?? null,
    cancelada: Boolean(venda.cancelada),
    clienteId: venda.clienteId ?? null,
    clienteNome: venda.clienteNome ?? null,
    fiado: Boolean(venda.fiado),
  };
}

function lerQuantidade(valor) {
  const quantidade = converterDecimal(valor);
  if (quantidade === null || quantidade <= 0) throw new ErroNegocio("Quantidade invalida em um dos itens.");
  return quantidade;
}

function lerValorMonetario(valor, campo) {
  const numero = converterDecimal(valor || 0);
  if (numero === null || numero < 0) throw new ErroNegocio(`${campo} invalido.`);
  return numero;
}

function normalizarPagamentos(formaPagamento, formasPagamento, total, fiado) {
  if (fiado) return { formaPagamento: "fiado", formasPagamento: [{ tipo: "fiado", valor: total }] };

  if (Array.isArray(formasPagamento) && formasPagamento.length >= 2) {
    const partes = [];
    for (const parte of formasPagamento) {
      if (!ehObjetoSimples(parte)) continue;
      const tipo = lerTexto(parte.tipo).trim().toLowerCase();
      const valorBruto = converterDecimal(parte.valor || 0);
      if (valorBruto === null) continue;
      const valor = arredondarCentavos(valorBruto);
      if (tipo && valor > 0) partes.push({ tipo, valor });
    }
    const soma = arredondarCentavos(partes.reduce((acumulado, parte) => acumulado + parte.valor, 0));
    if (partes.length < 2) throw new ErroNegocio("Pagamento dividido precisa de pelo menos 2 formas.");
    if (Math.abs(soma - total) > TOLERANCIA_SOMA_FORMAS) {
      throw new ErroNegocio(`Soma das formas (${soma.toFixed(2)}) deve fechar o total (${total.toFixed(2)}).`);
    }
    return { formaPagamento: "misto", formasPagamento: partes };
  }

  const forma = String(formaPagamento || "dinheiro").trim().toLowerCase() || "dinheiro";
  if (!FORMAS_SIMPLES.has(forma)) throw new ErroNegocio("Forma de pagamento invalida.");
  return { formaPagamento: forma, formasPagamento: [{ tipo: forma, valor: total }] };
}

function lerCustoUnitario(item, produto) {
  const bruto = Object.hasOwn(item, "custoUnitario") ? item.custoUnitario : produto?.custo;
  if (bruto === null || bruto === undefined || bruto === "") return null;
  const custo = converterDecimal(bruto);
  return custo === null || custo < 0 ? null : custo;
}

function lerProduto(produtos, produtoId) {
  const produto = Object.hasOwn(produtos, produtoId) ? produtos[produtoId] : undefined;
  return ehObjetoSimples(produto) ? produto : null;
}

function calcularItem(item, produto, quantidade, offline, produtoId) {
  const estoqueAtual = converterDecimal(produto?.estoque || 0) ?? 0;
  if (produto && !offline && estoqueAtual + 1e-9 < quantidade) {
    throw new ErroNegocio(`Estoque insuficiente para "${produto.nome || produtoId}".`);
  }

  // Preço do carrinho (promoção/kg) é aceito se for finito e >= 0; senão, o do cadastro.
  const precoCadastro = converterDecimal(produto?.preco || 0) ?? 0;
  const precoEnviado = converterDecimal(item.precoUnitario);
  const precoUnitario = precoEnviado !== null && precoEnviado >= 0 ? precoEnviado : precoCadastro;

  return {
    estoqueAtual,
    itemVenda: {
      produtoId,
      nome: produto?.nome || item.nome || "",
      quantidade,
      precoUnitario,
      subtotal: precoUnitario * quantidade,
      custoUnitario: lerCustoUnitario(item, produto),
    },
  };
}

/**
 * Registra venda e baixa estoque no documento JSON com lock — sem corrida no caixa.
 *
 * Com `idLocal` o envio é idempotente: o caixa reenvia a mesma venda quando a
 * resposta se perde na rede e o servidor devolve a já gravada, sem baixar estoque
 * de novo. Com `offline` a venda já aconteceu no balcão sem internet, então
 * estoque insuficiente ou produto removido não podem mais recusá-la.
 */
export async function finalizarVenda(lojaId, funcionario, dados) {
  const itens = Array.isArray(dados.itens) ? dados.itens : [];
  if (!itens.length) throw new ErroNegocio("A venda precisa de ao menos um item.");

  const desconto = lerValorMonetario(dados.desconto, "Desconto");
  const fiado = Boolean(dados.fiado);
  const clienteId = dados.clienteId || null;
  const clienteNome = dados.clienteNome || null;
  const idLocal = lerIdLocal(dados.idLocal);
  const offline = Boolean(dados.offline);

  const vendaId = idLocal || randomUUID().replaceAll("-", "");
  const agora = Date.now();
  const criadoEm = offline ? criadoEmOffline(dados.criadoEmLocal, agora) : agora;

  return db.transacao(async (tx) => {
    // Mesma ordem de lock que cancelarVenda (vendas -> produtos) evita deadlock.
    const vendas = await carregarRecurso(tx, lojaId, "vendas");
    const jaRegistrada = idLocal && Object.hasOwn(vendas, vendaId) ? vendas[vendaId] : null;
    if (ehObjetoSimples(jaRegistrada)) return respostaVenda(vendaId, jaRegistrada);
    const produtos = await carregarRecurso(tx, lojaId, "produtos");

    let subtotal = 0;
    const itensVenda = [];
    for (const item of itens) {
      if (!ehObjetoSimples(item)) throw new ErroNegocio("Item de venda invalido.");
      const produtoId = lerTexto(item.produtoId).trim();
      if (!produtoId) throw new ErroNegocio("Produto invalido na venda.");
      const quantidade = lerQuantidade(item.quantidade);

      const produto = lerProduto(produtos, produtoId);
      if (!produto && !offline) throw new ErroNegocio("Produto nao encontrado na loja.", 404);

      const { estoqueAtual, itemVenda } = calcularItem(item, produto, quantidade, offline, produtoId);
      subtotal += itemVenda.subtotal;
      itensVenda.push(itemVenda);
      if (produto) {
        produto.estoque = Math.max(0, estoqueAtual - quantidade);
        produto.atualizadoEm = agora;
      }
    }

    const descontoAplicado = Math.min(desconto, subtotal);
    const total = subtotal - descontoAplicado;
    const pagamentos = normalizarPagamentos(dados.formaPagamento, dados.formasPagamento, total, fiado);

    const venda = {
      itens: itensVenda,
      subtotal,
      desconto: descontoAplicado,
      total,
      formaPagamento: pagamentos.formaPagamento,
      formasPagamento: pagamentos.formasPagamento,
      funcionarioId: funcionario.id ?? null,
      funcionarioNome: funcionario.nome ?? null,
      clienteId,
      clienteNome,
      fiado,
      criadoEm,
      cancelada: false,
    };
    if (offline) {
      venda.registradaOffline = true;
      venda.sincronizadaEm = agora;
    }
    vendas[vendaId] = venda;

    await salvarRecurso(tx, lojaId, "produtos", produtos);
    await salvarRecurso(tx, lojaId, "vendas", vendas);
    return respostaVenda(vendaId, venda);
  });
}

/** Cancela venda e devolve estoque atomicamente (com lock). */
export async function cancelarVenda(lojaId, { vendaId, motivo = "", canceladoPorNome = "" }) {
  if (!vendaId) throw new ErroNegocio("Venda invalida.");

  const agora = Date.now();
  return db.transacao(async (tx) => {
    const vendas = await carregarRecurso(tx, lojaId, "vendas");
    const venda = Object.hasOwn(vendas, vendaId) ? vendas[vendaId] : null;
    if (!ehObjetoSimples(venda)) throw new ErroNegocio("Venda nao encontrada.", 404);
    if (venda.cancelada) throw new ErroNegocio("Esta venda ja esta cancelada.");

    const produtos = await carregarRecurso(tx, lojaId, "produtos");
    for (const item of Array.isArray(venda.itens) ? venda.itens : []) {
      if (!ehObjetoSimples(item) || !item.produtoId) continue;
      const produto = lerProduto(produtos, String(item.produtoId));
      if (!produto) continue;
      const quantidade = converterDecimal(item.quantidade || 0) ?? 0;
      if (quantidade <= 0) continue;
      produto.estoque = (converterDecimal(produto.estoque || 0) ?? 0) + quantidade;
      produto.atualizadoEm = agora;
    }

    venda.cancelada = true;
    venda.canceladoEm = agora;
    venda.canceladoPor = canceladoPorNome || "admin";
    venda.motivoCancelamento = String(motivo || "").trim();

    await salvarRecurso(tx, lojaId, "produtos", produtos);
    await salvarRecurso(tx, lojaId, "vendas", vendas);
    return { id: vendaId, ...venda };
  });
}
