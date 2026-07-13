/**
 * Encaminha a impressao do comprovante para o processo principal (Electron),
 * que localiza a impressora Jetway e imprime em modo silencioso.
 *
 * @param {object} dadosVenda
 * @returns {Promise<{ok: boolean, impressora?: string, mensagem?: string}>}
 */
export async function imprimirCupomVenda(dadosVenda) {
  if (!window.pdvAPI?.imprimirCupom) {
    return {
      ok: false,
      mensagem: "API de impressao indisponivel neste ambiente.",
    };
  }
  return window.pdvAPI.imprimirCupom(dadosVenda);
}
