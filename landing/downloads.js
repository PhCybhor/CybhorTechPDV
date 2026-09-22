function escapeDownloadHtml(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Só aceita http(s) same-origin ou caminho relativo iniciando com /.
 * Rejeita javascript:, data: e hosts externos.
 * @param {string} url
 * @returns {string} href seguro ou "#" se inválido
 */
function hrefDownloadSeguro(url) {
  const bruto = String(url || "").trim();
  if (!bruto || /^javascript:/i.test(bruto) || /^data:/i.test(bruto)) {
    return "#";
  }
  if (bruto.startsWith("/") && !bruto.startsWith("//")) {
    return bruto;
  }
  try {
    const parsed = new URL(bruto, window.location.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "#";
    }
    if (parsed.origin !== window.location.origin) {
      return "#";
    }
    return parsed.href;
  } catch {
    return "#";
  }
}

async function carregarInstaladores(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  try {
    const origem = window.location.origin;
    const resposta = await fetch(`${origem}/api/site/downloads`);
    const dados = await resposta.json();
    const lista = Array.isArray(dados.instaladores) ? dados.instaladores : [];
    if (!lista.length) {
      el.innerHTML = `<p class="cadastro-sub">Instaladores em breve. Tente novamente em alguns minutos.</p>`;
      return;
    }
    el.innerHTML = lista
      .map((item) => {
        const href = hrefDownloadSeguro(item.url);
        return `
      <a class="cartao-download" href="${escapeDownloadHtml(href)}" download>
        <span>
          <strong>${escapeDownloadHtml(item.rotulo)}</strong>
          <small>Setup ${escapeDownloadHtml(item.arquivo)}</small>
        </span>
        <span class="btn-suave">Baixar</span>
      </a>`;
      })
      .join("");
  } catch {
    el.innerHTML = `<p class="cadastro-sub">Nao foi possivel listar os instaladores agora.</p>`;
  }
}
