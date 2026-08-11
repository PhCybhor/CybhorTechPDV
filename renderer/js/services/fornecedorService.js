import { ref, get, push, update, remove, onValue } from "../config/databaseClient.js";
import { obterDatabase } from "../config/databaseClient.js";
import { caminhoLoja } from "./tenantContext.js";

function caminhoFornecedores() {
  return caminhoLoja("fornecedores");
}

/**
 * @param {object | null} valor
 * @returns {Array<object>}
 */
function mapear(valor) {
  if (!valor) return [];
  return Object.entries(valor).map(([id, dados]) => {
    const tipos = obterTiposMercadoriaLista(dados);
    return {
      id,
      ...dados,
      tiposMercadoria: tipos.join(", "),
      // Compat: UI/listagens antigas ainda leem nicho
      nicho: tipos.join(", ") || dados.nicho || "",
    };
  });
}

/**
 * @param {string} texto
 * @returns {string}
 */
function normalizarTexto(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Extrai lista de tipos de mercadoria (novo campo ou legado `nicho`).
 * @param {object | null | undefined} fornecedor
 * @returns {string[]}
 */
export function obterTiposMercadoriaLista(fornecedor) {
  const bruto =
    fornecedor?.tiposMercadoria ?? fornecedor?.nicho ?? "";
  return String(bruto)
    .split(/[,;|/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/**
 * Texto amigável dos tipos (vírgula).
 * @param {object | null | undefined} fornecedor
 * @returns {string}
 */
export function rotuloTiposMercadoria(fornecedor) {
  return obterTiposMercadoriaLista(fornecedor).join(", ");
}

/**
 * @param {object} dados
 * @returns {object}
 */
function normalizarFornecedor({
  nome,
  tiposMercadoria,
  nicho,
  telefone,
  whatsapp,
  email,
  cidade,
  observacao,
  ativo,
}) {
  const nomeLimpo = String(nome || "").trim();
  const tipos = obterTiposMercadoriaLista({
    tiposMercadoria: tiposMercadoria ?? nicho,
  });

  if (nomeLimpo.length < 2) {
    throw new Error("Informe o nome do fornecedor.");
  }
  if (tipos.length === 0) {
    throw new Error(
      "Informe o que o fornecedor vende (ex.: Bebidas, Água, Refrigerante)."
    );
  }

  const emailLimpo = String(email || "").trim().toLowerCase();
  if (emailLimpo && !emailLimpo.includes("@")) {
    throw new Error("E-mail do fornecedor inválido.");
  }

  const tiposTexto = tipos.join(", ");

  return {
    nome: nomeLimpo,
    tiposMercadoria: tiposTexto,
    telefone: String(telefone || "").trim(),
    whatsapp: String(whatsapp || "").trim(),
    email: emailLimpo,
    cidade: String(cidade || "").trim(),
    observacao: String(observacao || "").trim(),
    ativo: ativo === false ? false : true,
  };
}

/**
 * @returns {Promise<Array<object>>}
 */
export async function listarFornecedores() {
  const db = await obterDatabase();
  const snapshot = await get(ref(db, caminhoFornecedores()));
  return mapear(snapshot.val()).sort((a, b) =>
    String(a.nome || "").localeCompare(String(b.nome || ""))
  );
}

/**
 * @param {(lista: Array<object>) => void} callback
 * @returns {Promise<() => void>}
 */
export async function observarFornecedores(callback) {
  const db = await obterDatabase();
  return onValue(ref(db, caminhoFornecedores()), (snapshot) => {
    const lista = mapear(snapshot.val()).sort((a, b) =>
      String(a.nome || "").localeCompare(String(b.nome || ""))
    );
    callback(lista);
  });
}

/**
 * @param {object} dados
 * @returns {Promise<string>}
 */
export async function criarFornecedor(dados) {
  const normalizado = normalizarFornecedor(dados);
  const db = await obterDatabase();
  const referencia = await push(ref(db, caminhoFornecedores()), {
    ...normalizado,
    criadoEm: Date.now(),
  });
  return referencia.key;
}

/**
 * @param {string} id
 * @param {object} dados
 * @returns {Promise<void>}
 */
export async function atualizarFornecedor(id, dados) {
  if (!id) throw new Error("Fornecedor inválido.");
  const normalizado = normalizarFornecedor(dados);
  const db = await obterDatabase();
  await update(ref(db, `${caminhoFornecedores()}/${id}`), {
    ...normalizado,
    atualizadoEm: Date.now(),
  });
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function excluirFornecedor(id) {
  if (!id) throw new Error("Fornecedor inválido.");
  const db = await obterDatabase();
  await remove(ref(db, `${caminhoFornecedores()}/${id}`));
}

/**
 * Verifica se algum tipo de mercadoria do fornecedor combina com categoria/nome do produto.
 * @param {object} fornecedor
 * @param {object} produto
 * @returns {boolean}
 */
export function fornecedorCombinaComProduto(fornecedor, produto) {
  if (!fornecedor || fornecedor.ativo === false) return false;
  const tipos = obterTiposMercadoriaLista(fornecedor).map(normalizarTexto);
  if (tipos.length === 0) return false;

  const categoria = normalizarTexto(produto?.categoria);
  const nome = normalizarTexto(produto?.nome);
  const obs = normalizarTexto(fornecedor.observacao);

  for (const tipo of tipos) {
    if (categoria && (categoria.includes(tipo) || tipo.includes(categoria))) {
      return true;
    }
    if (
      nome &&
      (nome.includes(tipo) ||
        tipo.split(/\s+/).some((p) => p.length > 3 && nome.includes(p)))
    ) {
      return true;
    }
  }
  if (obs && categoria && obs.includes(categoria)) return true;
  return false;
}

/**
 * Para cada produto com estoque baixo, sugere fornecedores com tipos compatíveis.
 * @param {Array<object>} produtosBaixos
 * @param {Array<object>} fornecedores
 * @returns {Array<{ produto: object, fornecedores: Array<object> }>}
 */
export function sugerirFornecedoresParaEstoqueBaixo(
  produtosBaixos,
  fornecedores
) {
  const ativos = (fornecedores || []).filter((f) => f.ativo !== false);
  return (produtosBaixos || []).map((produto) => {
    const matches = ativos.filter((f) =>
      fornecedorCombinaComProduto(f, produto)
    );
    return { produto, fornecedores: matches };
  });
}

/**
 * Lista unica de fornecedores uteis para Reposicao atual.
 * @param {Array<object>} produtosBaixos
 * @param {Array<object>} fornecedores
 * @returns {Array<object>}
 */
export function listarFornecedoresParaReposicao(produtosBaixos, fornecedores) {
  const mapa = new Map();
  for (const item of sugerirFornecedoresParaEstoqueBaixo(
    produtosBaixos,
    fornecedores
  )) {
    for (const f of item.fornecedores) {
      if (!mapa.has(f.id)) {
        mapa.set(f.id, {
          ...f,
          produtosSugeridos: [item.produto.nome],
        });
      } else {
        mapa.get(f.id).produtosSugeridos.push(item.produto.nome);
      }
    }
  }
  return Array.from(mapa.values());
}

/**
 * Monta texto para a IA / WhatsApp.
 * @param {Array<object>} produtosBaixos
 * @param {Array<object>} fornecedores
 * @returns {string}
 */
export function montarAlertaReposicaoTexto(produtosBaixos, fornecedores) {
  const sugestoes = sugerirFornecedoresParaEstoqueBaixo(
    produtosBaixos,
    fornecedores
  );
  if (!sugestoes.length) return "";

  const linhas = sugestoes.map(({ produto, fornecedores: fors }) => {
    const estoque = Number(produto.estoque) || 0;
    if (fors.length === 0) {
      return `• ${produto.nome} (est. ${estoque}) — nenhum fornecedor com tipos de mercadoria compatíveis cadastrado.`;
    }
    const nomes = fors
      .map((f) => {
        const contato = f.whatsapp || f.telefone || f.email || "sem contato";
        const tipos = rotuloTiposMercadoria(f) || "—";
        return `${f.nome} [${tipos}] (${contato})`;
      })
      .join("; ");
    return `• ${produto.nome} (est. ${estoque}, cat. ${
      produto.categoria || "—"
    }) → ${nomes}`;
  });

  return [
    "Estoque baixo — sugestão de fornecedores pelos tipos de mercadoria que vendem:",
    ...linhas,
    "",
    "Monte uma mensagem curta de pedido para cada fornecedor listado, priorizando o que está mais crítico. Inclua WhatsApp/telefone quando houver.",
  ].join("\n");
}
