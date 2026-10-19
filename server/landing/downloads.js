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

/**
 * @param {string|null} iso
 * @returns {string} data dd/mm/aaaa ou "" se ausente/inválida
 */
function formatarDataPublicacao(iso) {
  if (!iso) return "";
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  return data.toLocaleDateString("pt-BR");
}

/**
 * @param {number} bytes
 * @returns {string} tamanho em MB ou "" se ausente
 */
function formatarTamanho(bytes) {
  const numero = Number(bytes);
  if (!Number.isFinite(numero) || numero <= 0) return "";
  return `${Math.round(numero / (1024 * 1024))} MB`;
}

function renderizarCartaoDownload(item) {
  const href = hrefDownloadSeguro(item.url);
  const detalhes = [item.arquivo, formatarTamanho(item.tamanho_bytes)].filter(Boolean).join(" · ");
  return `
      <a class="cartao-download" href="${escapeDownloadHtml(href)}" download>
        <span>
          <strong>${escapeDownloadHtml(item.rotulo)}</strong>
          <small>${escapeDownloadHtml(detalhes)}</small>
        </span>
        <span class="btn-suave">Baixar</span>
      </a>`;
}

function renderizarVersaoAtual(atual) {
  const cartoes = atual.instaladores.map(renderizarCartaoDownload).join("");
  if (!atual.versao) return cartoes;
  const data = formatarDataPublicacao(atual.publicado_em);
  return `
      <p class="download-versao-atual">
        <span class="selo-versao">Versao ${escapeDownloadHtml(atual.versao)}</span>
        ${data ? `<small>Atualizada em ${escapeDownloadHtml(data)}</small>` : ""}
      </p>
      ${cartoes}`;
}

function renderizarVersaoAnterior(versao) {
  const data = formatarDataPublicacao(versao.publicado_em);
  const links = versao.instaladores
    .map(
      (item) => `
          <a class="link-download-anterior" href="${escapeDownloadHtml(hrefDownloadSeguro(item.url))}" download>
            ${escapeDownloadHtml(item.rotulo)}
          </a>`
    )
    .join("");
  return `
        <div class="versao-anterior">
          <span class="versao-anterior-titulo">
            <strong>Versao ${escapeDownloadHtml(versao.versao)}</strong>
            ${data ? `<small>${escapeDownloadHtml(data)}</small>` : ""}
          </span>
          <div class="versao-anterior-links">${links}</div>
        </div>`;
}

function renderizarVersoesAnteriores(anteriores) {
  if (!anteriores.length) return "";
  return `
      <details class="versoes-anteriores">
        <summary>Versoes anteriores (${anteriores.length})</summary>
        <p class="cadastro-sub">Use somente se o suporte pedir. A versao mais nova acima e a recomendada.</p>
        ${anteriores.map(renderizarVersaoAnterior).join("")}
      </details>`;
}

async function carregarInstaladores(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  try {
    const origem = window.location.origin;
    const resposta = await fetch(`${origem}/api/site/downloads`);
    const dados = await resposta.json();
    const atual = dados.atual && Array.isArray(dados.atual.instaladores) ? dados.atual : null;
    if (!atual || !atual.instaladores.length) {
      el.innerHTML = `<p class="cadastro-sub">Instaladores em breve. Tente novamente em alguns minutos.</p>`;
      return;
    }
    const anteriores = (Array.isArray(dados.anteriores) ? dados.anteriores : []).filter(
      (versao) => Array.isArray(versao.instaladores) && versao.instaladores.length
    );
    el.innerHTML = renderizarVersaoAtual(atual) + renderizarVersoesAnteriores(anteriores);
  } catch {
    el.innerHTML = `<p class="cadastro-sub">Nao foi possivel listar os instaladores agora.</p>`;
  }
}
