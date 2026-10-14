/**
 * Conversão das linhas exportadas do PostgreSQL para os tipos do schema MySQL.
 * Funções puras: o importador decide quando gravar; aqui só se converte e valida.
 */

export const FORMATO_EXPORTACAO = "cybhorpdv-export";
export const VERSAO_EXPORTACAO = 1;

// Ordem de remoção ao limpar o destino (filhos antes dos pais).
export const TABELAS_EM_ORDEM_DE_REMOCAO = [
  "venda_itens",
  "vendas",
  "pagamentos",
  "aceites_diretrizes",
  "trials_cpf",
  "documentos_loja",
  "assinaturas",
  "produtos",
  "funcionarios",
  "lojas",
  "administradores_sistema",
];

// No MariaDB o tipo JSON aparece como longtext no information_schema; por isso a lista fixa.
const COLUNAS_JSON = new Set(["funcionarios.dados", "pagamentos.payload", "documentos_loja.dados"]);

// Colunas NOT NULL sem DEFAULT no MySQL que podem não existir em bancos Postgres antigos.
const VALORES_PARA_COLUNAS_AUSENTES = { "funcionarios.dados": "{}" };

const DECIMAL_VALIDO = /^-?\d+(\.\d+)?$/;
const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

/** Erro de conteúdo do arquivo (linha ou coluna incompatível com o destino). */
export class ErroDeConversao extends Error {}

function doisDigitos(numero, tamanho = 2) {
  return String(numero).padStart(tamanho, "0");
}

/** ISO-8601 com fuso -> 'AAAA-MM-DD HH:MM:SS.mmm' em UTC (DATETIME sem ambiguidade de fuso). */
export function paraDatetimeUtc(valor) {
  const data = new Date(valor);
  if (typeof valor !== "string" || Number.isNaN(data.getTime())) throw new ErroDeConversao(`data invalida: ${valor}`);
  return (
    `${data.getUTCFullYear()}-${doisDigitos(data.getUTCMonth() + 1)}-${doisDigitos(data.getUTCDate())} ` +
    `${doisDigitos(data.getUTCHours())}:${doisDigitos(data.getUTCMinutes())}:${doisDigitos(data.getUTCSeconds())}.` +
    doisDigitos(data.getUTCMilliseconds(), 3)
  );
}

/**
 * Valor decimal em texto -> centavos exatos (BigInt), para conferir somas sem float.
 * @param {string | number} valor
 */
export function paraCentavos(valor) {
  const texto = String(valor ?? "0").trim();
  if (!DECIMAL_VALIDO.test(texto)) throw new ErroDeConversao(`decimal invalido: ${texto}`);
  const negativo = texto.startsWith("-");
  const [inteiro, fracao = ""] = texto.replace("-", "").split(".");
  // Colunas monetárias são DECIMAL(_, 2): mais casas indicaria dado corrompido.
  if (fracao.length > 2) throw new ErroDeConversao(`decimal com mais de 2 casas: ${texto}`);
  const centavos = BigInt(`${inteiro}${fracao.padEnd(2, "0")}`);
  return negativo ? -centavos : centavos;
}

function converterValor(chave, valor, coluna) {
  if (valor === null || valor === undefined) {
    if (COLUNAS_JSON.has(chave) && !coluna.nulo) return "{}";
    if (!coluna.nulo) throw new ErroDeConversao("valor nulo em coluna obrigatoria");
    return null;
  }
  if (COLUNAS_JSON.has(chave)) return JSON.stringify(valor);

  switch (coluna.tipo) {
    case "datetime":
    case "timestamp":
      return paraDatetimeUtc(valor);
    case "date":
      if (!DATA_VALIDA.test(String(valor))) throw new ErroDeConversao(`data invalida: ${valor}`);
      return String(valor);
    case "tinyint":
      return valor === true || valor === 1 ? 1 : 0;
    case "decimal":
      if (!DECIMAL_VALIDO.test(String(valor))) throw new ErroDeConversao(`decimal invalido: ${valor}`);
      return String(valor);
    case "int":
    case "bigint":
      if (!Number.isInteger(valor)) throw new ErroDeConversao(`inteiro invalido: ${valor}`);
      return valor;
    default: {
      const texto = String(valor);
      // CHARACTER_MAXIMUM_LENGTH conta caracteres; o length do JS conta unidades UTF-16.
      if (coluna.tamanhoMaximo !== null && [...texto].length > coluna.tamanhoMaximo) {
        throw new ErroDeConversao(`texto com ${[...texto].length} caracteres (maximo ${coluna.tamanhoMaximo})`);
      }
      return texto;
    }
  }
}

/**
 * Converte uma linha exportada para a ordem de colunas do INSERT.
 * @param {string} tabela
 * @param {Record<string, unknown>} linha
 * @param {Map<string, { tipo: string, tamanhoMaximo: number | null, nulo: boolean }>} colunasDestino
 * @returns {{ colunas: string[], valores: unknown[] }}
 */
export function converterLinha(tabela, linha, colunasDestino) {
  const colunas = [];
  const valores = [];
  for (const [nomeColuna, valor] of Object.entries(linha)) {
    const coluna = colunasDestino.get(nomeColuna);
    if (!coluna) throw new ErroDeConversao(`coluna ${nomeColuna} nao existe no MySQL`);
    try {
      valores.push(converterValor(`${tabela}.${nomeColuna}`, valor, coluna));
    } catch (erro) {
      if (erro instanceof ErroDeConversao) throw new ErroDeConversao(`${nomeColuna}: ${erro.message}`);
      throw erro;
    }
    colunas.push(nomeColuna);
  }
  for (const [chave, padrao] of Object.entries(VALORES_PARA_COLUNAS_AUSENTES)) {
    const [tabelaPadrao, colunaPadrao] = chave.split(".");
    if (tabelaPadrao === tabela && !colunas.includes(colunaPadrao)) {
      colunas.push(colunaPadrao);
      valores.push(padrao);
    }
  }
  return { colunas, valores };
}

/** Identificador legível da linha para o relatório de problemas (sem dados pessoais). */
export function identificarLinha(linha) {
  if (linha.id !== undefined) return `id=${linha.id}`;
  if (linha.recurso !== undefined) return `loja_id=${linha.loja_id} recurso=${linha.recurso}`;
  return `loja_id=${linha.loja_id ?? "?"}`;
}
