import { notificar } from "./notificacao.js";

/** Espera o app abrir antes de consultar, para não competir com o login. */
const ATRASO_PRIMEIRA_VERIFICACAO_MS = 20000;
const INTERVALO_VERIFICACAO_MS = 6 * 60 * 60 * 1000;

/**
 * Consulta a versão publicada no painel do cliente e mostra uma faixa no topo
 * do app quando há versão mais nova, com o instalador certo para este Windows.
 */
export function iniciarAvisoAtualizacao() {
  const aviso = document.getElementById("aviso-atualizacao");
  const texto = document.getElementById("aviso-atualizacao-texto");
  const botaoBaixar = document.getElementById("btn-baixar-atualizacao");
  const botaoAdiar = document.getElementById("btn-adiar-atualizacao");
  if (!aviso || !texto || !botaoBaixar || !botaoAdiar || !window.pdvAPI?.verificarAtualizacao) {
    return;
  }

  let versaoOferecida = null;
  let versaoAdiada = null;
  let urlDownload = null;

  const verificar = async () => {
    const resultado = await window.pdvAPI.verificarAtualizacao().catch(() => null);
    if (!resultado?.ok || !resultado.disponivel || resultado.versaoNova === versaoAdiada) return;
    versaoOferecida = resultado.versaoNova;
    urlDownload = resultado.urlDownload;
    texto.textContent = `Nova versão do CybhorPDV: ${resultado.versaoNova} (você usa a ${resultado.versaoAtual}). Baixe, feche o CybhorPDV e execute o instalador por cima — não precisa desinstalar.`;
    aviso.classList.remove("oculto");
  };

  botaoBaixar.addEventListener("click", async () => {
    if (!urlDownload) return;
    const resposta = await window.pdvAPI.abrirExterno(urlDownload).catch(() => null);
    if (!resposta?.ok) {
      notificar(resposta?.mensagem || "Não foi possível abrir o download.", "erro");
      return;
    }
    notificar(
      "Download aberto no navegador. Feche o CybhorPDV e execute o instalador por cima da versão atual (não desinstale).",
      "info",
      8000
    );
  });

  // "Depois" vale até o app ser reaberto; uma versão ainda mais nova volta a avisar.
  botaoAdiar.addEventListener("click", () => {
    versaoAdiada = versaoOferecida;
    aviso.classList.add("oculto");
  });

  setTimeout(() => void verificar(), ATRASO_PRIMEIRA_VERIFICACAO_MS);
  setInterval(() => void verificar(), INTERVALO_VERIFICACAO_MS);
}
