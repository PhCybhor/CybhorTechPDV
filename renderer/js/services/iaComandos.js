import {
  despacharComando,
  CAMPOS_PATCH_PRODUTO_AGENTE,
} from "../../../electron/iaComandoMapa.js";
import { listarProdutos, atualizarProduto, criarProduto } from "./produtoService.js";
import { montarBackupLoja } from "./backupService.js";
import { obterLojaId, obterMetaLoja } from "./tenantContext.js";
import { appBackupValido } from "../config/marcaProduto.js";
import { criarSangria, somarSangriasDoDia } from "./sangriaService.js";
import {
  lerEstadoCaixa,
  somarSuprimentosDoDia,
  somarVendasDinheiroDoDia,
  calcularDinheiroEsperado,
} from "./caixaCicloService.js";
import { resumirFechamento, registrarFechamento } from "./fechamentoService.js";

const CAMPOS_PRODUTO = [
  "nome",
  "preco",
  "estoque",
  "codigoBarras",
  "codigoInterno",
  "categoria",
  "custo",
  "unidade",
  "unidadesPorCaixa",
  "validade",
  "precoPromocao",
  "promoInicio",
  "promoFim",
];

function falha(resumo) {
  return { ok: false, resumo, reversivel: false };
}

function recorteProduto(produto) {
  const saida = { id: produto.id };
  for (const campo of CAMPOS_PRODUTO) {
    if (produto[campo] !== undefined) saida[campo] = produto[campo];
  }
  return saida;
}

function baseProduto(atual) {
  const saida = {};
  for (const campo of CAMPOS_PRODUTO) {
    if (atual[campo] !== undefined) saida[campo] = atual[campo];
  }
  return saida;
}

async function buscarProduto(args) {
  const termo = String(args.termo || "").trim().toLowerCase();
  if (!termo) return falha("informe o termo de busca");
  const produtos = await listarProdutos();
  const hits = produtos
    .filter((p) => {
      const nome = String(p.nome || "").toLowerCase();
      const barras = String(p.codigoBarras || "").toLowerCase();
      const interno = String(p.codigoInterno || "").toLowerCase();
      return nome.includes(termo) || barras.includes(termo) || interno.includes(termo);
    })
    .slice(0, 8);
  if (!hits.length) {
    return { ok: true, resumo: "nenhum produto encontrado", reversivel: false };
  }
  const resumo = hits
    .map((p) => `${p.nome} id=${p.id} preço=${p.preco} estoque=${p.estoque}`)
    .join("; ");
  return { ok: true, resumo, reversivel: false };
}

async function atualizarProdutoCmd(args, deps) {
  if (!deps.pode("editarProduto")) return falha("sem permissão para editar produto");
  const produtoId = String(args.produtoId || "").trim();
  if (!produtoId) return falha("produto inválido");
  const produtos = await listarProdutos();
  const atual = produtos.find((p) => p.id === produtoId);
  if (!atual) return falha("produto não encontrado");
  const next = baseProduto(atual);
  let mudou = false;
  for (const campo of CAMPOS_PATCH_PRODUTO_AGENTE) {
    if (args[campo] !== undefined && args[campo] !== null) {
      next[campo] = args[campo];
      mudou = true;
    }
  }
  if (!mudou) return falha("nada para atualizar");
  await atualizarProduto(produtoId, next);
  return {
    ok: true,
    resumo: `produto atualizado: ${next.nome}`,
    before: recorteProduto(atual),
    after: recorteProduto({ ...next, id: produtoId }),
    reversivel: true,
  };
}

/**
 * A senha de administrador fica no modal do histórico.
 * O agente não recebe nem envia credencial.
 */
async function cancelarVendaCmd(args, deps) {
  if (typeof deps.abrirCancelamento !== "function") {
    return falha("cancelamento de venda não está ligado nesta tela");
  }
  return deps.abrirCancelamento({
    vendaId: args.vendaId,
    motivo: args.motivo,
  });
}

async function sangriaCmd(args, deps) {
  if (!deps.pode("fazerSangria")) return falha("sem permissão para sangria");
  const valor = Number(args.valor);
  if (!Number.isFinite(valor) || valor <= 0) {
    return falha("informe um valor de sangria maior que zero");
  }
  const motivo = String(args.motivo || "").trim();
  if (motivo.length < 2) {
    return falha("informe o motivo da sangria (mínimo 2 caracteres)");
  }
  const funcionario = deps.funcionario() || {};
  const id = await criarSangria({
    valor,
    motivo,
    funcionarioId: funcionario.id || "",
    funcionarioNome: funcionario.nome || "",
  });
  return {
    ok: true,
    resumo: `sangria registrada (${id})`,
    after: { id, valor, motivo },
    reversivel: false,
  };
}

/**
 * Mesma gravação do botão de fechamento em Relatórios.
 * Não trava vendas novas: só persiste o resumo do dia.
 */
async function fecharCaixa(_args, deps) {
  const funcionario = deps.funcionario();
  if (!funcionario) return falha("faça login para fechar o caixa");
  if (funcionario.cargo !== "admin") {
    return falha("somente o administrador fecha o caixa");
  }
  const vendas = deps.vendas();
  const sangrias = deps.sangrias();
  const suprimentos = deps.suprimentos();
  const resumo = resumirFechamento(vendas);
  const totalSangrias = somarSangriasDoDia(sangrias);
  const estadoCaixa = await lerEstadoCaixa();
  const suprimentosDia = somarSuprimentosDoDia(suprimentos);
  const vendasDinheiro = somarVendasDinheiroDoDia(vendas);
  const dinheiroEsperado = calcularDinheiroEsperado({
    fundoInicial: estadoCaixa.fundoInicial,
    suprimentosDia,
    vendasDinheiro,
    sangriasDia: totalSangrias,
  });
  const id = await registrarFechamento(
    {
      ...resumo,
      totalSangrias,
      fundoInicial: estadoCaixa.fundoInicial,
      suprimentosDia,
      vendasDinheiro,
      dinheiroEsperado,
    },
    { id: funcionario.id, nome: funcionario.nome }
  );
  return {
    ok: true,
    resumo: `caixa fechado (${id})`,
    after: {
      id,
      dinheiroEsperado,
      totalLiquido: resumo.totalLiquido,
    },
    reversivel: false,
  };
}

async function exportarBackupCmd(_args, deps) {
  const meta = obterMetaLoja() || {};
  const { nomeArquivo, blob } = montarBackupLoja({
    lojaId: obterLojaId(),
    lojaNome: meta.nome || meta.nomeLoja || "",
    produtos: typeof deps.produtos === "function" ? deps.produtos() : [],
    vendas: typeof deps.vendas === "function" ? deps.vendas() : [],
    despesas: [],
    sangrias: typeof deps.sangrias === "function" ? deps.sangrias() : [],
  });
  const tamanho = blob?.size || 0;
  return {
    ok: true,
    resumo: `backup pronto: ${nomeArquivo} (${tamanho} bytes). Use Exportar no menu se quiser baixar.`,
    after: { nomeArquivo, tamanho },
    reversivel: false,
  };
}

async function importarBackupCmd(args) {
  let payload = null;
  const bruto = String(args.json || args.produtos || "").trim();
  if (bruto) {
    try {
      payload = JSON.parse(bruto);
    } catch {
      return falha("JSON de backup inválido");
    }
  }
  if (!payload || !appBackupValido(payload.app)) {
    return falha("só importo backup Operar ou CybhorPDV (campo app)");
  }
  const produtos = Array.isArray(payload.produtos) ? payload.produtos : [];
  let criados = 0;
  const erros = [];
  for (const p of produtos.slice(0, 500)) {
    try {
      await criarProduto({
        nome: p.nome,
        preco: p.preco,
        estoque: p.estoque,
        codigoBarras: p.codigoBarras,
        categoria: p.categoria,
        custo: p.custo,
      });
      criados += 1;
    } catch (erro) {
      erros.push(String(erro?.message || erro).slice(0, 80));
    }
  }
  return {
    ok: true,
    resumo: `importados ${criados} produtos` +
      (erros.length ? `; ${erros.length} falhas` : ""),
    after: { criados, erros: erros.slice(0, 5) },
    reversivel: false,
  };
}

function abrirRotaCmd(args, deps) {
  const rota = String(args.rota || "").trim();
  if (!rota) return falha("informe a rota");
  if (typeof deps.abrirRota !== "function" || !deps.abrirRota(rota)) {
    return falha(`rota indisponível: ${rota}`);
  }
  return { ok: true, resumo: `rota aberta: ${rota}`, reversivel: false };
}

/**
 * @param {string} comando
 * @param {object} args
 * @param {object} deps
 */
export function executarComandoLoja(comando, args, deps) {
  const contexto = deps || {};
  const pode = typeof contexto.pode === "function" ? contexto.pode : () => false;
  const amarrado = {
    pode,
    funcionario: () => (typeof contexto.funcionario === "function" ? contexto.funcionario() : null),
    produtos: () => (typeof contexto.produtos === "function" ? contexto.produtos() : []),
    vendas: () => (typeof contexto.vendas === "function" ? contexto.vendas() : []),
    sangrias: () => (typeof contexto.sangrias === "function" ? contexto.sangrias() : []),
    suprimentos: () =>
      typeof contexto.suprimentos === "function" ? contexto.suprimentos() : [],
    abrirRota: contexto.abrirRota,
    abrirCancelamento: contexto.abrirCancelamento,
  };
  return despacharComando(comando, args, {
    buscarProduto: (recebidos) => buscarProduto(recebidos),
    atualizarProduto: (recebidos) => atualizarProdutoCmd(recebidos, amarrado),
    cancelarVenda: (recebidos) => cancelarVendaCmd(recebidos, amarrado),
    sangria: (recebidos) => sangriaCmd(recebidos, amarrado),
    fecharCaixa: (recebidos) => fecharCaixa(recebidos, amarrado),
    exportarBackupIa: (recebidos) => exportarBackupCmd(recebidos, amarrado),
    importarBackupIa: (recebidos) => importarBackupCmd(recebidos),
    abrirRota: (recebidos) => abrirRotaCmd(recebidos, amarrado),
  });
}
