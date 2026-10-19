import { randomUUID } from 'node:crypto';
import * as db from '../db.js';
import { ErroNegocio } from '../errors.js';
import {
  arredondarMoeda,
  converterParaInteiro,
  converterParaNumero,
  ehObjetoSimples,
  ehVerdadeiro,
  texto,
} from '../utils/valores.js';
import { carregarRecurso, salvarRecurso } from './dadosService.js';

const FORMAS_SIMPLES = new Set(['dinheiro', 'credito', 'debito', 'pix', 'fiado', 'misto']);
const ID_LOCAL_VALIDO = /^[a-f0-9]{32}$/;
const TOLERANCIA_SOMA_PAGAMENTOS = 0.05;
// Venda guardada sem internet pode chegar dias depois; mais que isso é relógio errado.
const JANELA_VENDA_OFFLINE_MS = 30 * 24 * 60 * 60 * 1000;
const TOLERANCIA_RELOGIO_MS = 5 * 60 * 1000;
const EPSILON_ESTOQUE = 1e-9;

function idLocal(valor) {
  const normalizado = texto(valor).toLowerCase();
  return ID_LOCAL_VALIDO.test(normalizado) ? normalizado : null;
}

function criadoEmOffline(valor, agora) {
  const informado = converterParaInteiro(valor);
  if (informado === null) return agora;
  const dentroDaJanela =
    informado >= agora - JANELA_VENDA_OFFLINE_MS && informado <= agora + TOLERANCIA_RELOGIO_MS;
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
    itens: ehVerdadeiro(venda.itens) ? venda.itens : [],
    criadoEm: venda.criadoEm ?? null,
    cancelada: ehVerdadeiro(venda.cancelada),
    clienteId: venda.clienteId ?? null,
    clienteNome: venda.clienteNome ?? null,
    fiado: ehVerdadeiro(venda.fiado),
  };
}

function lerQuantidade(valor) {
  const quantidade = converterParaNumero(valor);
  if (quantidade === null || quantidade <= 0) {
    throw new ErroNegocio('Quantidade invalida em um dos itens.');
  }
  return quantidade;
}

function lerValorMonetario(valor, campo) {
  const numero = converterParaNumero(ehVerdadeiro(valor) ? valor : 0);
  if (numero === null || numero < 0) throw new ErroNegocio(`${campo} invalido.`);
  return numero;
}

function normalizarPagamentos(formaPagamento, formasPagamento, total, fiado) {
  if (fiado) {
    return {
      formaPagamento: 'fiado',
      formasPagamento: [{ tipo: 'fiado', valor: total }],
    };
  }

  if (Array.isArray(formasPagamento) && formasPagamento.length >= 2) {
    const partes = [];
    for (const parte of formasPagamento) {
      if (!ehObjetoSimples(parte)) continue;
      const tipo = texto(parte.tipo).toLowerCase();
      const valorBruto = converterParaNumero(ehVerdadeiro(parte.valor) ? parte.valor : 0);
      if (valorBruto === null) continue;
      const valor = arredondarMoeda(valorBruto);
      if (tipo && valor > 0) partes.push({ tipo, valor });
    }
    const soma = arredondarMoeda(partes.reduce((acumulado, parte) => acumulado + parte.valor, 0));
    if (partes.length < 2) {
      throw new ErroNegocio('Pagamento dividido precisa de pelo menos 2 formas.');
    }
    if (Math.abs(soma - total) > TOLERANCIA_SOMA_PAGAMENTOS) {
      throw new ErroNegocio(
        `Soma das formas (${soma.toFixed(2)}) deve fechar o total (${total.toFixed(2)}).`,
      );
    }
    return { formaPagamento: 'misto', formasPagamento: partes };
  }

  const forma = texto(formaPagamento).toLowerCase() || 'dinheiro';
  if (!FORMAS_SIMPLES.has(forma)) throw new ErroNegocio('Forma de pagamento invalida.');
  return { formaPagamento: forma, formasPagamento: [{ tipo: forma, valor: total }] };
}

function lerCustoUnitario(item, produto) {
  const bruto = Object.hasOwn(item, 'custoUnitario') ? item.custoUnitario : produto?.custo;
  if (bruto === null || bruto === undefined || bruto === '') return null;
  const custo = converterParaNumero(bruto);
  return custo === null || custo < 0 ? null : custo;
}

/**
 * Calcula o item da venda a partir do cadastro (preço) e do carrinho (promoção/kg).
 * Devolve também o produto já com o estoque baixado (ou null se o produto sumiu offline).
 */
function montarItemVenda({ item, produtos, offline, agora }) {
  if (!ehObjetoSimples(item)) throw new ErroNegocio('Item de venda invalido.');
  const produtoId = texto(item.produtoId);
  if (!produtoId) throw new ErroNegocio('Produto invalido na venda.');
  const quantidade = lerQuantidade(item.quantidade);

  let produto = Object.hasOwn(produtos, produtoId) ? produtos[produtoId] : null;
  if (!ehObjetoSimples(produto)) {
    if (!offline) throw new ErroNegocio('Produto nao encontrado na loja.', 404);
    produto = null;
  }

  const estoqueAtual = converterParaNumero(produto?.estoque ?? 0) ?? 0;
  if (produto !== null && !offline && estoqueAtual + EPSILON_ESTOQUE < quantidade) {
    throw new ErroNegocio(`Estoque insuficiente para "${produto.nome || produtoId}".`);
  }

  // O preço-base vem do cadastro; o do carrinho só vale se for um número >= 0.
  const precoCadastro = converterParaNumero(ehVerdadeiro(produto?.preco) ? produto.preco : 0) ?? 0;
  const precoEnviado = converterParaNumero(item.precoUnitario);
  const precoUnitario = precoEnviado !== null && precoEnviado >= 0 ? precoEnviado : precoCadastro;
  const subtotalItem = precoUnitario * quantidade;

  const itemVenda = {
    produtoId,
    nome: produto?.nome || item.nome || '',
    quantidade,
    precoUnitario,
    subtotal: subtotalItem,
    custoUnitario: lerCustoUnitario(item, produto),
  };

  if (produto !== null) {
    produto.estoque = Math.max(0, estoqueAtual - quantidade);
    produto.atualizadoEm = agora;
    produtos[produtoId] = produto;
  }
  return itemVenda;
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
  if (itens.length === 0) throw new ErroNegocio('A venda precisa de ao menos um item.');

  const desconto = lerValorMonetario(dados.desconto, 'Desconto');
  const fiado = ehVerdadeiro(dados.fiado);
  const clienteId = dados.clienteId || null;
  const clienteNome = dados.clienteNome || null;
  const idLocalInformado = idLocal(dados.idLocal);
  const offline = ehVerdadeiro(dados.offline);

  const vendaId = idLocalInformado || randomUUID().replaceAll('-', '');
  const agora = Date.now();
  const criadoEm = offline ? criadoEmOffline(dados.criadoEmLocal, agora) : agora;

  return db.transacao(async (cx) => {
    // Mesma ordem de lock que cancelarVenda (vendas -> produtos) evita deadlock.
    const vendas = await carregarRecurso(cx, lojaId, 'vendas');
    const jaRegistrada = idLocalInformado && Object.hasOwn(vendas, vendaId) ? vendas[vendaId] : null;
    if (ehObjetoSimples(jaRegistrada)) return respostaVenda(vendaId, jaRegistrada);
    const produtos = await carregarRecurso(cx, lojaId, 'produtos');

    const itensVenda = itens.map((item) => montarItemVenda({ item, produtos, offline, agora }));
    const subtotal = itensVenda.reduce((acumulado, item) => acumulado + item.subtotal, 0);

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
      funcionarioId: funcionario.id,
      funcionarioNome: funcionario.nome,
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

    await salvarRecurso(cx, lojaId, 'produtos', produtos);
    await salvarRecurso(cx, lojaId, 'vendas', vendas);
    return respostaVenda(vendaId, venda);
  });
}

/** Cancela a venda e devolve o estoque atomicamente (com lock). */
export async function cancelarVenda(lojaId, { vendaId, motivo = '', canceladoPorNome = '' }) {
  if (!vendaId) throw new ErroNegocio('Venda invalida.');

  const agora = Date.now();
  return db.transacao(async (cx) => {
    const vendas = await carregarRecurso(cx, lojaId, 'vendas');
    const venda = Object.hasOwn(vendas, vendaId) ? vendas[vendaId] : null;
    if (!ehObjetoSimples(venda)) throw new ErroNegocio('Venda nao encontrada.', 404);
    if (ehVerdadeiro(venda.cancelada)) throw new ErroNegocio('Esta venda ja esta cancelada.');

    const produtos = await carregarRecurso(cx, lojaId, 'produtos');
    for (const item of Array.isArray(venda.itens) ? venda.itens : []) {
      if (!ehObjetoSimples(item) || !item.produtoId) continue;
      const produtoId = String(item.produtoId);
      const produto = Object.hasOwn(produtos, produtoId) ? produtos[produtoId] : null;
      if (!ehObjetoSimples(produto)) continue;

      const quantidade = converterParaNumero(ehVerdadeiro(item.quantidade) ? item.quantidade : 0) ?? 0;
      if (quantidade <= 0) continue;
      const estoqueAtual = converterParaNumero(ehVerdadeiro(produto.estoque) ? produto.estoque : 0) ?? 0;
      produto.estoque = estoqueAtual + quantidade;
      produto.atualizadoEm = agora;
    }

    venda.cancelada = true;
    venda.canceladoEm = agora;
    venda.canceladoPor = canceladoPorNome || 'admin';
    venda.motivoCancelamento = texto(motivo);

    await salvarRecurso(cx, lojaId, 'produtos', produtos);
    await salvarRecurso(cx, lojaId, 'vendas', vendas);
    return { id: vendaId, ...venda };
  });
}
