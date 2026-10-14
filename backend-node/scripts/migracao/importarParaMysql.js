/**
 * Importa no MySQL/MariaDB o arquivo gerado por exportar_postgres.py.
 *
 * Uso:
 *   npm run migracao:importar -- cybhorpdv-export.jsonl.gz --simular
 *   npm run migracao:importar -- cybhorpdv-export.jsonl.gz
 *
 * Tudo acontece numa única transação: ou entra tudo, ou nada. Depois de gravar, confere
 * as contagens de cada tabela e as somas de vendas e pagamentos com o cabeçalho do arquivo.
 * --simular  faz a importação completa e desfaz no fim (valida contra o banco real).
 * --limpar-destino  apaga os dados atuais do MySQL antes (para repetir o ensaio).
 */
import { createReadStream, openSync, readSync, closeSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import * as db from "../../src/db.js";
import {
  converterLinha,
  ErroDeConversao,
  FORMATO_EXPORTACAO,
  identificarLinha,
  paraCentavos,
  TABELAS_EM_ORDEM_DE_REMOCAO,
  VERSAO_EXPORTACAO,
} from "./conversao.js";

// Prepared statements aceitam até 65535 parâmetros; o limite de bytes protege o max_allowed_packet.
const MAXIMO_PARAMETROS_POR_LOTE = 60_000;
const MAXIMO_BYTES_POR_LOTE = 2 * 1024 * 1024;
const MAXIMO_PROBLEMAS_LISTADOS = 50;
const ASSINATURA_GZIP = [0x1f, 0x8b];

class SimulacaoConcluida extends Error {}

function lerArgumentos(argumentos) {
  const arquivo = argumentos.find((argumento) => !argumento.startsWith("--"));
  if (!arquivo) throw new Error("Informe o arquivo exportado. Ex.: npm run migracao:importar -- export.jsonl.gz --simular");
  return {
    arquivo,
    simular: argumentos.includes("--simular"),
    limparDestino: argumentos.includes("--limpar-destino"),
  };
}

function ehGzip(arquivo) {
  const descritor = openSync(arquivo, "r");
  try {
    const inicio = Buffer.alloc(2);
    readSync(descritor, inicio, 0, 2, 0);
    return inicio[0] === ASSINATURA_GZIP[0] && inicio[1] === ASSINATURA_GZIP[1];
  } finally {
    closeSync(descritor);
  }
}

function abrirLinhas(arquivo) {
  const fluxo = createReadStream(arquivo);
  const entrada = ehGzip(arquivo) ? fluxo.pipe(createGunzip()) : fluxo;
  return createInterface({ input: entrada, crlfDelay: Infinity });
}

function validarCabecalho(cabecalho) {
  if (cabecalho?.formato !== FORMATO_EXPORTACAO || cabecalho.versao !== VERSAO_EXPORTACAO) {
    throw new Error("Arquivo nao e uma exportacao do CybhorPDV (cabecalho invalido).");
  }
  return cabecalho;
}

async function carregarColunasDestino(tx) {
  const linhas = await tx.consultar(
    `SELECT TABLE_NAME AS tabela, COLUMN_NAME AS coluna, DATA_TYPE AS tipo,
            CHARACTER_MAXIMUM_LENGTH AS tamanhoMaximo, IS_NULLABLE AS nulo
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`,
  );
  const porTabela = new Map();
  for (const linha of linhas) {
    if (!porTabela.has(linha.tabela)) porTabela.set(linha.tabela, new Map());
    porTabela.get(linha.tabela).set(linha.coluna, {
      tipo: String(linha.tipo).toLowerCase(),
      tamanhoMaximo: linha.tamanhoMaximo === null ? null : Number(linha.tamanhoMaximo),
      nulo: linha.nulo === "YES",
    });
  }
  const faltando = TABELAS_EM_ORDEM_DE_REMOCAO.filter((tabela) => !porTabela.has(tabela));
  if (faltando.length) throw new Error(`Schema MySQL incompleto (rode npm run banco:schema): ${faltando.join(", ")}`);
  return porTabela;
}

async function prepararDestino(tx, limparDestino) {
  const ocupadas = [];
  for (const tabela of TABELAS_EM_ORDEM_DE_REMOCAO) {
    const [{ total }] = await tx.consultar(`SELECT COUNT(*) AS total FROM ${tabela}`);
    if (Number(total) > 0) ocupadas.push(`${tabela} (${total})`);
  }
  if (!ocupadas.length) return;
  if (!limparDestino) {
    throw new Error(`O MySQL de destino ja tem dados: ${ocupadas.join(", ")}. Use --limpar-destino para substituir.`);
  }
  for (const tabela of TABELAS_EM_ORDEM_DE_REMOCAO) await tx.executar(`DELETE FROM ${tabela}`);
}

/** Acumula linhas da mesma tabela/colunas e grava em INSERTs de várias linhas. */
function criarGravadorEmLotes(tx) {
  let lote = null;

  async function descarregar() {
    if (!lote?.valores.length) return;
    const marcadoresLinha = `(${db.marcadores(lote.colunas.length)})`;
    const linhasSql = Array.from({ length: lote.valores.length / lote.colunas.length }, () => marcadoresLinha).join(", ");
    try {
      await tx.executar(`INSERT INTO ${lote.tabela} (${lote.colunas.join(", ")}) VALUES ${linhasSql}`, lote.valores);
    } catch (erro) {
      throw new Error(`Falha ao gravar ${lote.tabela}: ${erro.message}`);
    }
    lote = null;
  }

  return {
    async adicionar(tabela, colunas, valores) {
      const assinaturaColunas = colunas.join(",");
      const bytesLinha = valores.reduce((soma, valor) => soma + (typeof valor === "string" ? Buffer.byteLength(valor) : 8), 0);
      const mudouFormato = lote && (lote.tabela !== tabela || lote.assinaturaColunas !== assinaturaColunas);
      const estourou =
        lote &&
        (lote.valores.length + valores.length > MAXIMO_PARAMETROS_POR_LOTE || lote.bytes + bytesLinha > MAXIMO_BYTES_POR_LOTE);
      if (mudouFormato || estourou) await descarregar();
      if (!lote) lote = { tabela, colunas, assinaturaColunas, valores: [], bytes: 0 };
      lote.valores.push(...valores);
      lote.bytes += bytesLinha;
    },
    descarregar,
  };
}

async function conferirResultado(tx, cabecalho) {
  const divergencias = [];
  const relatorio = [];
  for (const [tabela, esperado] of Object.entries(cabecalho.contagens)) {
    const [{ total }] = await tx.consultar(`SELECT COUNT(*) AS total FROM ${tabela}`);
    relatorio.push({ tabela, postgres: Number(esperado), mysql: Number(total) });
    if (Number(total) !== Number(esperado)) divergencias.push(`${tabela}: esperado ${esperado}, gravado ${total}`);
  }
  for (const [chave, esperado] of Object.entries(cabecalho.totais)) {
    const [tabela, coluna] = chave.split(".");
    const [{ soma }] = await tx.consultar(`SELECT CAST(COALESCE(SUM(${coluna}), 0) AS CHAR) AS soma FROM ${tabela}`);
    if (paraCentavos(soma) !== paraCentavos(esperado)) divergencias.push(`soma de ${chave}: esperado ${esperado}, gravado ${soma}`);
  }
  if (divergencias.length) throw new Error(`Conferencia falhou:\n  ${divergencias.join("\n  ")}`);
  return relatorio;
}

async function importar({ arquivo, simular, limparDestino }) {
  let cabecalho = null;
  let rodape = null;
  let numeroLinha = 0;
  const problemas = [];

  return db.transacao(async (tx) => {
    const colunasDestino = await carregarColunasDestino(tx);
    await prepararDestino(tx, limparDestino);
    const gravador = criarGravadorEmLotes(tx);

    // O readline começa a ler assim que é criado: aberto antes de um await, perderia linhas.
    for await (const texto of abrirLinhas(arquivo)) {
      numeroLinha += 1;
      if (!texto.trim()) continue;
      if (rodape) throw new Error(`Conteudo depois do rodape na linha ${numeroLinha}.`);
      const registro = JSON.parse(texto);
      if (!cabecalho) {
        cabecalho = validarCabecalho(registro);
        continue;
      }
      if (registro.fim === true) {
        rodape = registro;
        continue;
      }

      const colunas = colunasDestino.get(registro.tabela);
      if (!colunas) throw new Error(`Tabela desconhecida no arquivo: ${registro.tabela}`);
      try {
        const convertida = converterLinha(registro.tabela, registro.linha, colunas);
        // Com problema em qualquer linha nada será gravado; segue só para listar todos de uma vez.
        if (!problemas.length) await gravador.adicionar(registro.tabela, convertida.colunas, convertida.valores);
      } catch (erro) {
        if (!(erro instanceof ErroDeConversao)) throw erro;
        problemas.push(`${registro.tabela} ${identificarLinha(registro.linha)}: ${erro.message}`);
      }
    }

    if (!cabecalho) throw new Error("Arquivo vazio.");
    if (!rodape) throw new Error("Arquivo incompleto (sem rodape): a exportacao foi interrompida.");
    if (problemas.length) {
      const listados = problemas.slice(0, MAXIMO_PROBLEMAS_LISTADOS).join("\n  ");
      throw new Error(`${problemas.length} registro(s) incompativeis com o MySQL; nada foi gravado:\n  ${listados}`);
    }
    await gravador.descarregar();

    const relatorio = await conferirResultado(tx, cabecalho);
    if (simular) throw new SimulacaoConcluida(JSON.stringify(relatorio));
    return relatorio;
  });
}

function imprimirRelatorio(relatorio, titulo) {
  process.stdout.write(`${titulo}\n`);
  for (const { tabela, postgres, mysql } of relatorio) {
    process.stdout.write(`  ${tabela.padEnd(26)} postgres=${String(postgres).padStart(7)}  mysql=${String(mysql).padStart(7)}\n`);
  }
}

async function principal() {
  const opcoes = lerArgumentos(process.argv.slice(2));
  try {
    const relatorio = await importar(opcoes);
    imprimirRelatorio(relatorio, "Importacao concluida e conferida:");
  } catch (erro) {
    if (!(erro instanceof SimulacaoConcluida)) throw erro;
    imprimirRelatorio(JSON.parse(erro.message), "Simulacao OK (nada foi gravado):");
  } finally {
    await db.fecharPool();
  }
}

principal().catch((erro) => {
  process.stderr.write(`Importacao cancelada, nenhum dado foi gravado.\n${erro.message}\n`);
  process.exitCode = 1;
});
