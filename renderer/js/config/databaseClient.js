import { apiRequest } from "./apiClient.js";

const INTERVALO_ATUALIZACAO_MS = 2500;

class Snapshot {
  constructor(valor, chave = null) {
    this._valor = valor;
    this.key = chave;
  }

  exists() {
    return this._valor !== null && this._valor !== undefined;
  }

  val() {
    return this._valor ?? null;
  }
}

function normalizarCaminho(caminho) {
  const partes = String(caminho || "")
    .split("/")
    .filter(Boolean);
  if (partes[0] === "lojas" && partes.length >= 3) {
    return partes.slice(2).join("/");
  }
  return partes.join("/");
}

function chaveDoCaminho(caminho) {
  return String(caminho || "").split("/").filter(Boolean).at(-1) || null;
}

function aplicarConsulta(valor, constraints = []) {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return valor;
  let entradas = Object.entries(valor);
  const ordem = constraints.find((c) => c.tipo === "orderByChild");
  if (ordem) {
    entradas.sort(([, a], [, b]) => {
      const av = a?.[ordem.campo];
      const bv = b?.[ordem.campo];
      return av === bv ? 0 : av > bv ? 1 : -1;
    });
  }
  const igual = constraints.find((c) => c.tipo === "equalTo");
  if (igual && ordem) {
    entradas = entradas.filter(([, item]) => item?.[ordem.campo] === igual.valor);
  }
  const inicio = constraints.find((c) => c.tipo === "startAt");
  if (inicio && ordem) {
    entradas = entradas.filter(([, item]) => item?.[ordem.campo] >= inicio.valor);
  }
  const fim = constraints.find((c) => c.tipo === "endAt");
  if (fim && ordem) {
    entradas = entradas.filter(([, item]) => item?.[ordem.campo] <= fim.valor);
  }
  const limite = constraints.find((c) => c.tipo === "limitToLast");
  if (limite) entradas = entradas.slice(-limite.valor);
  return Object.fromEntries(entradas);
}

export async function obterDatabase() {
  return { tipo: "fastapi-postgresql" };
}

export function ref(_db, caminho = "") {
  return { caminho: String(caminho || ""), constraints: [] };
}

export function query(referencia, ...constraints) {
  return { ...referencia, constraints };
}

export function orderByChild(campo) {
  return { tipo: "orderByChild", campo };
}

export function equalTo(valor) {
  return { tipo: "equalTo", valor };
}

export function startAt(valor) {
  return { tipo: "startAt", valor };
}

export function endAt(valor) {
  return { tipo: "endAt", valor };
}

export function limitToLast(valor) {
  return { tipo: "limitToLast", valor: Math.max(0, Number(valor) || 0) };
}

export async function get(referencia) {
  const caminho = normalizarCaminho(referencia.caminho);
  const dados = await apiRequest(`/api/dados/${encodeURI(caminho)}`);
  const valor = aplicarConsulta(dados?.valor, referencia.constraints || []);
  return new Snapshot(valor, chaveDoCaminho(caminho));
}

export async function set(referencia, valor) {
  const caminho = normalizarCaminho(referencia.caminho);
  await apiRequest(`/api/dados/${encodeURI(caminho)}`, {
    method: "PUT",
    body: { valor },
  });
}

export async function push(referencia, valor) {
  const chave = crypto.randomUUID().replace(/-/g, "");
  const caminhoBase = normalizarCaminho(referencia.caminho);
  const resultado = { caminho: `${caminhoBase}/${chave}`, key: chave, constraints: [] };
  if (valor !== undefined) await set(resultado, valor);
  return resultado;
}

export async function update(referencia, patch) {
  const caminho = normalizarCaminho(referencia.caminho);
  if (!caminho) {
    await apiRequest("/api/dados/lote", {
      method: "POST",
      body: { atualizacoes: patch || {} },
    });
    return;
  }
  await apiRequest(`/api/dados/${encodeURI(caminho)}`, {
    method: "PATCH",
    body: { patch: patch || {} },
  });
}

export async function remove(referencia) {
  const caminho = normalizarCaminho(referencia.caminho);
  await apiRequest(`/api/dados/${encodeURI(caminho)}`, { method: "DELETE" });
}

export function onValue(referencia, callback) {
  let ativo = true;
  let serializadoAnterior = Symbol("inicial");

  const atualizar = async () => {
    if (!ativo) return;
    try {
      const snapshot = await get(referencia);
      const serializado = JSON.stringify(snapshot.val());
      if (serializado !== serializadoAnterior) {
        serializadoAnterior = serializado;
        callback(snapshot);
      }
    } catch (erro) {
      console.error("Falha ao atualizar dados da FastAPI:", erro);
    }
  };

  void atualizar();
  const timer = setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
  return () => {
    ativo = false;
    clearInterval(timer);
  };
}
