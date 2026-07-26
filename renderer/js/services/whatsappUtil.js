/**
 * Deep links WhatsApp (wa.me) — padrão de mercado que o PDV ainda não usava.
 */

/**
 * @param {string} telefoneBruto
 * @returns {string | null} só dígitos com DDI 55 se parecer BR
 */
export function normalizarTelefoneWa(telefoneBruto) {
  const digitos = String(telefoneBruto || "").replace(/\D/g, "");
  if (!digitos) return null;
  if (digitos.length < 10) return null;
  if (digitos.startsWith("55") && digitos.length >= 12) return digitos;
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  return digitos;
}

/**
 * @param {string} telefone
 * @param {string} [mensagem]
 * @returns {string | null}
 */
export function urlWhatsApp(telefone, mensagem = "") {
  const num = normalizarTelefoneWa(telefone);
  if (!num) return null;
  const base = `https://wa.me/${num}`;
  if (!mensagem) return base;
  return `${base}?text=${encodeURIComponent(mensagem)}`;
}

/**
 * @param {string} url
 */
export function abrirWhatsApp(url) {
  if (!url) return;
  if (window.pdvAPI?.abrirExterno) {
    window.pdvAPI.abrirExterno(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Monta pedido de reposição amigável.
 * @param {{
 *   lojaNome?: string,
 *   fornecedorNome?: string,
 *   itens?: Array<{ nome: string, estoque?: number, faltando?: string }>,
 * }} p
 */
export function montarMensagemReposicao(p = {}) {
  const loja = p.lojaNome || "nossa loja";
  const forn = p.fornecedorNome ? ` ${p.fornecedorNome}` : "";
  const linhas = (p.itens || [])
    .slice(0, 12)
    .map((i) => {
      const est =
        i.estoque !== undefined && i.estoque !== null
          ? ` (estoque: ${i.estoque})`
          : "";
      return `• ${i.nome}${est}${i.faltando ? ` — ${i.faltando}` : ""}`;
    })
    .join("\n");

  return (
    `Olá${forn}! Aqui é da ${loja}.\n` +
    `Precisamos repor:\n${linhas || "• (lista de itens)"}\n` +
    `Pode confirmar disponibilidade e prazo? Obrigado!`
  );
}
