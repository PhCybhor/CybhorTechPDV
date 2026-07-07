/**
 * Exibe uma notificacao temporaria (toast) no canto da tela.
 * @param {string} mensagem
 * @param {"info"|"sucesso"|"erro"|"alerta"} [tipo="info"]
 * @param {number} [duracaoMs=3200]
 */
export function notificar(mensagem, tipo = "info", duracaoMs = 3200) {
  const container = document.getElementById("notificacoes");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${tipo}`;
  toast.textContent = mensagem;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 200);
  }, duracaoMs);
}
