/**
 * Exibe uma notificacao temporaria (toast) no canto da tela.
 * Limitado a 3 toasts para nao cobrir o caixa em vendas rapidas.
 * @param {string} mensagem
 * @param {"info"|"sucesso"|"erro"|"alerta"} [tipo="info"]
 * @param {number} [duracaoMs]
 */
const MAX_TOASTS = 3;

const DURACAO_PADRAO = {
  sucesso: 2600,
  info: 2800,
  alerta: 3800,
  erro: 4500,
};

export function notificar(mensagem, tipo = "info", duracaoMs) {
  const container = document.getElementById("notificacoes");
  if (!container) return;

  const texto = String(mensagem || "").trim();
  if (!texto) return;

  while (container.children.length >= MAX_TOASTS) {
    container.firstElementChild?.remove();
  }

  const toast = document.createElement("div");
  toast.className = `toast ${tipo}`;
  toast.setAttribute("role", tipo === "erro" || tipo === "alerta" ? "alert" : "status");
  toast.setAttribute("aria-live", tipo === "erro" ? "assertive" : "polite");
  toast.textContent = texto;
  container.appendChild(toast);

  const ms =
    typeof duracaoMs === "number" && duracaoMs > 0
      ? duracaoMs
      : DURACAO_PADRAO[tipo] || DURACAO_PADRAO.info;

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 200);
  }, ms);
}
