/**
 * Paleta de comandos (Ctrl+K) — atalho estilo Linear/Notion no PDV.
 */

/**
 * @param {{
 *   onExecutar: (comando: { id: string, rota?: string, acao?: string }) => void,
 *   obterComandos: () => Array<{ id: string, titulo: string, atalho?: string, rota?: string, acao?: string, admin?: boolean }>,
 * }} opcoes
 */
export class ComandoPalette {
  constructor({ onExecutar, obterComandos }) {
    this.onExecutar = onExecutar;
    this.obterComandos = obterComandos;
    this.aberto = false;
    this.filtro = "";
    this.indice = 0;

    this.overlay = document.createElement("div");
    this.overlay.id = "comando-palette";
    this.overlay.className = "comando-palette oculto";
    this.overlay.innerHTML = `
      <div class="comando-palette-caixa" role="dialog" aria-modal="true" aria-label="Comandos">
        <input type="search" class="comando-palette-input" placeholder="Ir para… vender, relatórios, IA, sangria…" autocomplete="off" />
        <ul class="comando-palette-lista" role="listbox"></ul>
        <p class="comando-palette-dica">↑↓ navegar · Enter abrir · Esc fechar · Ctrl+K</p>
      </div>`;
    document.body.appendChild(this.overlay);

    this.input = this.overlay.querySelector(".comando-palette-input");
    this.listaEl = this.overlay.querySelector(".comando-palette-lista");

    this.input.addEventListener("input", () => {
      this.filtro = this.input.value;
      this.indice = 0;
      this._render();
    });
    this.input.addEventListener("keydown", (e) => this._teclado(e));
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.fechar();
    });
    this.listaEl.addEventListener("click", (e) => {
      const li = e.target.closest("[data-cmd]");
      if (!li) return;
      this._executarId(li.dataset.cmd);
    });
  }

  abrir() {
    this.aberto = true;
    this.filtro = "";
    this.indice = 0;
    this.input.value = "";
    this.overlay.classList.remove("oculto");
    this._render();
    setTimeout(() => this.input.focus(), 20);
  }

  fechar() {
    this.aberto = false;
    this.overlay.classList.add("oculto");
  }

  alternar() {
    if (this.aberto) this.fechar();
    else this.abrir();
  }

  _filtrados() {
    const q = this.filtro.trim().toLowerCase();
    const todos = this.obterComandos() || [];
    if (!q) return todos;
    return todos.filter(
      (c) =>
        c.titulo.toLowerCase().includes(q) ||
        (c.atalho || "").toLowerCase().includes(q) ||
        (c.id || "").includes(q)
    );
  }

  _render() {
    const itens = this._filtrados();
    if (!itens.length) {
      this.listaEl.innerHTML =
        '<li class="comando-palette-vazio">Nenhum comando</li>';
      return;
    }
    this.indice = Math.max(0, Math.min(this.indice, itens.length - 1));
    this.listaEl.innerHTML = itens
      .map(
        (c, i) => `
      <li class="comando-palette-item ${i === this.indice ? "ativo" : ""}" data-cmd="${c.id}" role="option">
        <span>${c.titulo}</span>
        ${c.atalho ? `<kbd>${c.atalho}</kbd>` : ""}
      </li>`
      )
      .join("");
  }

  _teclado(e) {
    const itens = this._filtrados();
    if (e.key === "Escape") {
      e.preventDefault();
      this.fechar();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.indice = Math.min(itens.length - 1, this.indice + 1);
      this._render();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      this.indice = Math.max(0, this.indice - 1);
      this._render();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const c = itens[this.indice];
      if (c) this._executarId(c.id);
    }
  }

  _executarId(id) {
    const cmd = (this.obterComandos() || []).find((c) => c.id === id);
    if (!cmd) return;
    this.fechar();
    this.onExecutar(cmd);
  }
}
