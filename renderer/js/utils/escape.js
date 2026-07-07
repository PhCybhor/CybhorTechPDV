/**
 * Escapa texto para uso seguro em innerHTML.
 * @param {string} texto
 * @returns {string}
 */
export function escapeHtml(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
