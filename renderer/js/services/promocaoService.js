/**
 * Preço promocional, combos 2x1 e cupons de desconto (local + produto).
 */

const CHAVE_CUPONS = "cybhor_cupons_";
const CHAVE_COMBOS = "cybhor_combos_";

function chave(lojaId, prefixo) {
  return `${prefixo}${lojaId || "local"}`;
}

/**
 * Preço efetivo do produto (promoção vigente ou preço normal).
 * @param {object} produto
 * @param {number} [agoraMs]
 */
export function precoEfetivo(produto, agoraMs = Date.now()) {
  const base = Number(produto?.preco) || 0;
  const promo = Number(produto?.precoPromocao);
  if (!Number.isFinite(promo) || promo <= 0 || promo >= base) return base;
  const ini = produto.promoInicio ? Date.parse(produto.promoInicio) : null;
  const fim = produto.promoFim ? Date.parse(produto.promoFim) : null;
  if (ini && Number.isFinite(ini) && agoraMs < ini) return base;
  if (fim && Number.isFinite(fim) && agoraMs > fim + 86400000 - 1) return base;
  return promo;
}

/**
 * Combos locais: { id, nome, produtoId, leve: 2, pague: 1, ativo }
 */
export function listarCombos(lojaId) {
  try {
    const bruto = localStorage.getItem(chave(lojaId, CHAVE_COMBOS));
    const lista = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

export function salvarCombos(lojaId, lista) {
  localStorage.setItem(
    chave(lojaId, CHAVE_COMBOS),
    JSON.stringify((lista || []).slice(0, 40))
  );
}

/**
 * Aplica regra leve/pague nos itens do carrinho (desconto em valor).
 * @returns {{ descontoCombo: number, detalhes: string[] }}
 */
export function calcularDescontoCombos(itens, lojaId) {
  const combos = listarCombos(lojaId).filter((c) => c.ativo !== false);
  let descontoCombo = 0;
  const detalhes = [];
  for (const combo of combos) {
    const item = (itens || []).find((i) => i.produtoId === combo.produtoId);
    if (!item) continue;
    const leve = Math.max(2, Number(combo.leve) || 2);
    const pague = Math.max(1, Math.min(leve - 1, Number(combo.pague) || 1));
    const grupos = Math.floor(item.quantidade / leve);
    if (grupos <= 0) continue;
    const gratis = grupos * (leve - pague);
    const valor = gratis * (Number(item.precoUnitario) || 0);
    descontoCombo += valor;
    detalhes.push(`${combo.nome || "Combo"}: −${gratis} un`);
  }
  return {
    descontoCombo: Math.round(descontoCombo * 100) / 100,
    detalhes,
  };
}

export function listarCupons(lojaId) {
  try {
    const bruto = localStorage.getItem(chave(lojaId, CHAVE_CUPONS));
    const lista = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

export function salvarCupons(lojaId, lista) {
  localStorage.setItem(
    chave(lojaId, CHAVE_CUPONS),
    JSON.stringify((lista || []).slice(0, 100))
  );
}

/**
 * @param {string} lojaId
 * @param {{ codigo: string, tipo: 'valor'|'percentual', valor: number, usos?: number }} dados
 */
export function criarCupom(lojaId, dados) {
  const codigo = String(dados.codigo || "")
    .trim()
    .toUpperCase();
  if (codigo.length < 3) throw new Error("Código do cupom muito curto.");
  const lista = listarCupons(lojaId);
  if (lista.some((c) => c.codigo === codigo)) {
    throw new Error("Já existe um cupom com esse código.");
  }
  const item = {
    id: `cup_${Date.now().toString(36)}`,
    codigo,
    tipo: dados.tipo === "percentual" ? "percentual" : "valor",
    valor: Number(dados.valor) || 0,
    usosRestantes: Number(dados.usos) > 0 ? Number(dados.usos) : 1,
    criadoEm: Date.now(),
  };
  lista.unshift(item);
  salvarCupons(lojaId, lista);
  return item;
}

/**
 * @returns {{ ok: boolean, desconto: number, cupom?: object, mensagem?: string }}
 */
export function aplicarCupom(lojaId, codigo, subtotal) {
  const cod = String(codigo || "")
    .trim()
    .toUpperCase();
  const cupom = listarCupons(lojaId).find((c) => c.codigo === cod);
  if (!cupom) return { ok: false, desconto: 0, mensagem: "Cupom inválido." };
  if (cupom.usosRestantes <= 0) {
    return { ok: false, desconto: 0, mensagem: "Cupom já utilizado." };
  }
  let desconto = 0;
  if (cupom.tipo === "percentual") {
    desconto = (subtotal * cupom.valor) / 100;
  } else {
    desconto = cupom.valor;
  }
  desconto = Math.min(subtotal, Math.max(0, desconto));
  return { ok: true, desconto: Math.round(desconto * 100) / 100, cupom };
}

export function consumirCupom(lojaId, codigo) {
  const lista = listarCupons(lojaId).map((c) => {
    if (c.codigo !== String(codigo || "").toUpperCase()) return c;
    return { ...c, usosRestantes: Math.max(0, (c.usosRestantes || 1) - 1) };
  });
  salvarCupons(lojaId, lista);
}
