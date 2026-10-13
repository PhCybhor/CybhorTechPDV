import {
  apiRequest,
  ehErroDeConexao,
  obterTokenSessao,
  EVENTO_CONEXAO,
} from "../config/apiClient.js";
import { obterLojaId } from "./tenantContext.js";
import { aplicarPosVendaCliente } from "./clienteService.js";
import { registrarAuditoria } from "./auditoriaService.js";

/**
 * Vendas finalizadas sem internet ficam num arquivo do computador (via processo
 * principal) e são reenviadas sozinhas quando a conexão volta. O servidor usa o
 * idLocal da venda para não gravar duas vezes se uma resposta se perder no caminho.
 */

const INTERVALO_SINCRONIZACAO_MS = 15000;
const TEMPO_LIMITE_ENVIO_MS = 20000;

/**
 * Passos que rodam depois da venda (saldo do fiado, cashback, auditoria).
 * Offline eles esperam a venda chegar ao servidor para não desencontrar os saldos.
 */
const EXECUTORES_EFEITO = {
  posVendaCliente: (dados) =>
    aplicarPosVendaCliente(dados.clienteId, {
      total: dados.total,
      foiFiado: dados.foiFiado,
      cashbackPct: dados.cashbackPct,
    }),
  auditoria: (dados) => registrarAuditoria(dados),
};

let fila = [];
let carregamento = null;
let gravacaoEmAndamento = Promise.resolve();
let sincronizando = false;
let temporizadorSincronizacao = null;
const ouvintes = new Set();

function navegadorSemRede() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function registrosDaLojaAtual() {
  const lojaId = obterLojaId();
  return lojaId ? fila.filter((registro) => registro.lojaId === lojaId) : [];
}

/**
 * @returns {{ pendentes: number, recusadas: number, sincronizando: boolean }}
 */
export function obterStatusFila() {
  const daLoja = registrosDaLojaAtual();
  return {
    pendentes: daLoja.filter((registro) => !registro.recusada).length,
    recusadas: daLoja.filter((registro) => registro.recusada).length,
    sincronizando,
  };
}

function avisarOuvintes(extras = {}) {
  const status = { ...obterStatusFila(), ...extras };
  for (const ouvinte of ouvintes) {
    try {
      ouvinte(status);
    } catch (erro) {
      console.error("Falha ao atualizar o status da fila offline:", erro);
    }
  }
}

/**
 * @param {(status: { pendentes: number, recusadas: number, sincronizando: boolean, enviadas?: number }) => void} ouvinte
 * @returns {() => void}
 */
export function observarFilaOffline(ouvinte) {
  ouvintes.add(ouvinte);
  ouvinte(obterStatusFila());
  return () => ouvintes.delete(ouvinte);
}

async function carregarFila() {
  if (!carregamento) {
    carregamento = (async () => {
      const resposta = await window.pdvAPI?.lerFilaOffline?.();
      fila = Array.isArray(resposta?.fila) ? resposta.fila : [];
    })();
  }
  return carregamento;
}

/** Gravações em série: duas vendas seguidas não podem sobrescrever uma à outra. */
function persistirFila() {
  const copia = JSON.parse(JSON.stringify(fila));
  const gravacao = gravacaoEmAndamento.then(async () => {
    const resposta = await window.pdvAPI?.gravarFilaOffline?.(copia);
    if (!resposta?.ok) {
      throw new Error(resposta?.mensagem || "Não foi possível guardar a venda no computador.");
    }
  });
  gravacaoEmAndamento = gravacao.catch(() => {});
  return gravacao;
}

/**
 * Guarda a venda para envio posterior. Só retorna depois de gravada em disco.
 * @param {object} corpo corpo de POST /api/caixa/venda (com idLocal)
 */
export async function enfileirarVenda(corpo) {
  await carregarFila();
  const lojaId = obterLojaId();
  if (!lojaId) throw new Error("Loja não identificada para guardar a venda.");
  const registro = {
    idLocal: corpo.idLocal,
    lojaId,
    guardadaEm: Date.now(),
    corpo: { ...corpo, offline: true },
    vendaEnviada: false,
    efeitos: [],
    recusada: false,
    ultimoErro: null,
  };
  fila.push(registro);
  try {
    await persistirFila();
  } catch (erro) {
    fila = fila.filter((item) => item !== registro);
    throw erro;
  }
  avisarOuvintes();
}

/**
 * Agenda um passo pós-venda para quando houver conexão. Se a venda já foi aceita
 * online (só o passo falhou), cria um registro só com o efeito pendente.
 * @param {string} idLocal
 * @param {{ tipo: keyof typeof EXECUTORES_EFEITO, dados: object }} efeito
 */
export async function anexarEfeitoPosVenda(idLocal, efeito) {
  await carregarFila();
  let registro = fila.find((item) => item.idLocal === idLocal);
  if (!registro) {
    registro = {
      idLocal,
      lojaId: obterLojaId(),
      guardadaEm: Date.now(),
      corpo: null,
      vendaEnviada: true,
      efeitos: [],
      recusada: false,
      ultimoErro: null,
    };
    fila.push(registro);
  }
  registro.efeitos.push(efeito);
  await persistirFila();
  avisarOuvintes();
}

/**
 * @param {object} registro
 * @returns {Promise<"ok" | "parar">}
 */
async function enviarRegistro(registro) {
  if (!registro.vendaEnviada) {
    try {
      await apiRequest("/api/caixa/venda", {
        method: "POST",
        body: registro.corpo,
        timeoutMs: TEMPO_LIMITE_ENVIO_MS,
      });
      registro.vendaEnviada = true;
      await persistirFila();
    } catch (erro) {
      if (ehErroDeConexao(erro) || erro.status === 401 || erro.status >= 500) return "parar";
      // Recusa definitiva (ex.: forma de pagamento inválida): não adianta reenviar.
      registro.recusada = true;
      registro.ultimoErro = String(erro.message || "Venda recusada pelo servidor.");
      await persistirFila();
      return "ok";
    }
  }

  while (registro.efeitos.length > 0) {
    const [efeito] = registro.efeitos;
    const executor = EXECUTORES_EFEITO[efeito?.tipo];
    try {
      if (executor) await executor(efeito.dados || {});
    } catch (erro) {
      if (ehErroDeConexao(erro)) return "parar";
      console.error("Passo pós-venda descartado:", efeito?.tipo, erro);
    }
    registro.efeitos.shift();
    await persistirFila();
  }
  return "ok";
}

/**
 * Envia o que estiver guardado da loja atual. Seguro para chamar a qualquer momento.
 * @returns {Promise<void>}
 */
export async function sincronizarFilaOffline() {
  if (sincronizando || navegadorSemRede() || !obterTokenSessao()) return;
  await carregarFila();
  const pendentes = registrosDaLojaAtual().filter((registro) => !registro.recusada);
  if (pendentes.length === 0) return;

  sincronizando = true;
  avisarOuvintes();
  let enviadas = 0;
  try {
    for (const registro of pendentes) {
      const eraVendaPendente = !registro.vendaEnviada;
      const resultado = await enviarRegistro(registro);
      if (resultado === "parar") break;
      if (eraVendaPendente && registro.vendaEnviada) enviadas += 1;
      if (registro.vendaEnviada && registro.efeitos.length === 0) {
        fila = fila.filter((item) => item !== registro);
        await persistirFila();
      }
    }
  } catch (erro) {
    console.error("Falha ao sincronizar vendas guardadas:", erro);
  } finally {
    sincronizando = false;
    avisarOuvintes({ enviadas });
  }
}

/**
 * Liga o reenvio automático: a cada 15 s e assim que o Windows reportar rede de volta.
 */
export function iniciarSincronizacaoAutomatica() {
  if (temporizadorSincronizacao) return;
  void carregarFila().then(() => avisarOuvintes());
  const tentar = () => void sincronizarFilaOffline();
  window.addEventListener("online", tentar);
  window.addEventListener(EVENTO_CONEXAO, (evento) => {
    if (evento.detail?.online) tentar();
  });
  temporizadorSincronizacao = setInterval(tentar, INTERVALO_SINCRONIZACAO_MS);
}
