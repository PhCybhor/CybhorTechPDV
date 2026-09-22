/**
 * Encaminha a impressao do comprovante para o processo principal (Electron),
 * que localiza a impressora Jetway e imprime em modo silencioso.
 *
 * @param {object} dadosVenda
 * @returns {Promise<{ok: boolean, impressora?: string, mensagem?: string}>}
 */
const TIMEOUT_IMPRESSAO_MS = 20000;

export async function imprimirCupomVenda(dadosVenda) {
  if (!window.pdvAPI?.imprimirCupom) {
    return {
      ok: false,
      mensagem: "API de impressão indisponível neste ambiente.",
    };
  }

  let timer;
  try {
    const impressao = await Promise.race([
      window.pdvAPI.imprimirCupom(dadosVenda),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          resolve({
            ok: false,
            mensagem:
              "Impressão demorou demais — confira a impressora e tente de novo.",
          });
        }, TIMEOUT_IMPRESSAO_MS);
      }),
    ]);
    return impressao && typeof impressao === "object"
      ? impressao
      : { ok: false, mensagem: "Resposta inválida da impressão." };
  } catch (erro) {
    return {
      ok: false,
      mensagem: erro?.message || "Falha ao imprimir o cupom.",
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
