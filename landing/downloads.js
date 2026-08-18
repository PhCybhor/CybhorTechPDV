"use strict";

function escapeDownloadHtml(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
      .map(
        (item) => `
      <a class="cartao-download" href="${escapeDownloadHtml(item.url)}" download>
        <span>
          <strong>${escapeDownloadHtml(item.rotulo)}</strong>
          <small>Setup ${escapeDownloadHtml(item.arquivo)}</small>
        </span>
        <span class="btn-suave">Baixar</span>
      </a>`
      )
      .join("");
  } catch {
    el.innerHTML = `<p class="cadastro-sub">Nao foi possivel listar os instaladores agora.</p>`;
  }
}
