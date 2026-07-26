import { escapeHtml } from "../utils/escape.js";
import { formatarMoeda } from "../utils/formato.js";
import { notificar } from "./notificacao.js";
import { obterLojaId, obterMetaLoja } from "../services/tenantContext.js";
import {
  preverDiasEstoque,
  montarItensPedido,
  textoPedidoCompra,
  htmlPedidoCompraPdf,
} from "../services/pedidoCompraService.js";
import {
  montarDreMes,
  htmlDrePdf,
  baixarHtmlComoArquivo,
} from "../services/dreService.js";
import {
  listarCombos,
  salvarCombos,
  criarCupom,
  listarCupons,
} from "../services/promocaoService.js";
import { listarVencendo } from "../services/produtoService.js";
import { ajustarEstoque } from "../services/produtoService.js";
import {
  urlWhatsApp,
  abrirWhatsApp,
} from "../services/whatsappUtil.js";
import { lerTurnos, salvarTurnos, adicionarEscala } from "../services/turnoStore.js";
import { competenciaDe } from "../services/despesaService.js";

/**
 * Painel único: pedido, inventário, DRE, combos, cupons, auditoria, turnos.
 */
export class PainelGestaoAvancada {
  constructor({
    raiz,
    obterProdutos = () => [],
    obterVendas = () => [],
    obterDespesas = () => [],
    obterFornecedores = () => [],
    obterAuditoria = () => [],
  }) {
    this.raiz = raiz;
    this.obterProdutos = obterProdutos;
    this.obterVendas = obterVendas;
    this.obterDespesas = obterDespesas;
    this.obterFornecedores = obterFornecedores;
    this.obterAuditoria = obterAuditoria;
    this.raiz.addEventListener("click", (e) => this._clique(e));
    this.raiz.addEventListener("submit", (e) => this._submit(e));
  }

  renderizar() {
    const lojaId = obterLojaId();
    const giro = preverDiasEstoque(this.obterProdutos(), this.obterVendas());
    const pedido = montarItensPedido(giro, 7).slice(0, 40);
    const dre = montarDreMes(
      this.obterVendas(),
      this.obterDespesas(),
      this.obterProdutos()
    );
    const vencendo = listarVencendo(this.obterProdutos(), 14);
    const combos = listarCombos(lojaId);
    const cupons = listarCupons(lojaId);
    const turnos = lerTurnos(lojaId);
    const auditoria = this.obterAuditoria().slice(0, 40);
    const produtosOpts = this.obterProdutos()
      .map(
        (p) =>
          `<option value="${escapeHtml(p.id)}">${escapeHtml(p.nome)}</option>`
      )
      .join("");

    this.raiz.innerHTML = `
      <div class="pulso-grade">
        <section class="pulso-secao">
          <h3 class="painel-titulo">Pedido de compra</h3>
          <p class="painel-sub">Itens que acabam em &lt; 7 dias pelo giro</p>
          <div class="lista-despesas" id="mega-pedido-lista">
            ${
              pedido.length
                ? pedido
                    .map(
                      (i) =>
                        `<div class="despesa-linha"><div><strong>${escapeHtml(
                          i.nome
                        )}</strong><span class="fornecedor-meta">Est. ${
                          i.estoque
                        } · pedir ${i.quantidadeSugerida}${
                          i.diasEstoque < 999
                            ? ` · ~${i.diasEstoque}d`
                            : ""
                        }</span></div></div>`
                    )
                    .join("")
                : `<p class="ranking-vazio">Estoque ok pelo giro atual</p>`
            }
          </div>
          <div class="campanha-acoes">
            <button type="button" class="btn btn-primario btn-sm" data-mega="pedido-wa">WhatsApp pedido</button>
            <button type="button" class="btn btn-secundario btn-sm" data-mega="pedido-pdf">Baixar HTML/PDF</button>
          </div>
        </section>

        <section class="pulso-secao">
          <h3 class="painel-titulo">DRE + margem</h3>
          <p class="painel-sub">${escapeHtml(dre.competencia)}</p>
          <div class="folha-cards">
            <div class="folha-card"><span>Receita</span><strong>${formatarMoeda(
              dre.receita
            )}</strong></div>
            <div class="folha-card"><span>CMV</span><strong>${formatarMoeda(
              dre.cmv
            )}</strong></div>
            <div class="folha-card"><span>Despesas</span><strong>${formatarMoeda(
              dre.despesasMes
            )}</strong></div>
            <div class="folha-card"><span>Lucro líquido</span><strong class="${
              dre.lucroLiquido >= 0 ? "sucesso" : ""
            }">${formatarMoeda(dre.lucroLiquido)}</strong></div>
          </div>
          <p class="form-ajuda">Descontos no mês: ${formatarMoeda(
            dre.descontos
          )} · Itens sem custo: ${dre.itensSemCusto}</p>
          ${
            dre.margemMorta.length
              ? `<p class="alerta-inline">Margem morta: ${dre.margemMorta.length} venda(s) com preço &lt; custo</p>`
              : ""
          }
          <button type="button" class="btn btn-secundario btn-sm" data-mega="dre-pdf">Exportar DRE</button>
        </section>

        <section class="pulso-secao">
          <h3 class="painel-titulo">Validade</h3>
          <div class="lista-despesas">
            ${
              vencendo.length
                ? vencendo
                    .map(
                      (p) =>
                        `<div class="despesa-linha"><div><strong>${escapeHtml(
                          p.nome
                        )}</strong><span class="fornecedor-meta">Validade ${escapeHtml(
                          p.validade
                        )}</span></div></div>`
                    )
                    .join("")
                : `<p class="ranking-vazio">Nada vencendo em 14 dias (cadastre validade nos produtos)</p>`
            }
          </div>
        </section>

        <section class="pulso-secao">
          <h3 class="painel-titulo">Inventário rápido</h3>
          <p class="painel-sub">Informe a quantidade contada — ajustamos a diferença</p>
          <form id="form-inventario" class="form form-despesa">
            <label>Produto
              <select id="inv-produto" required>${produtosOpts}</select>
            </label>
            <label>Quantidade contada
              <input type="number" id="inv-qtd" min="0" step="1" required />
            </label>
            <button type="submit" class="btn btn-primario">Ajustar estoque</button>
          </form>
        </section>

        <section class="pulso-secao">
          <h3 class="painel-titulo">Combos (leve/pague)</h3>
          <form id="form-combo" class="form form-despesa">
            <label>Nome <input id="combo-nome" required placeholder="2 por 1 refrigerante" /></label>
            <label>Produto <select id="combo-produto" required>${produtosOpts}</select></label>
            <div class="form-linha">
              <label>Leve <input type="number" id="combo-leve" value="2" min="2" /></label>
              <label>Pague <input type="number" id="combo-pague" value="1" min="1" /></label>
            </div>
            <button type="submit" class="btn btn-primario">Salvar combo</button>
          </form>
          <div class="lista-despesas">
            ${combos
              .map(
                (c) =>
                  `<div class="despesa-linha"><div><strong>${escapeHtml(
                    c.nome
                  )}</strong><span class="fornecedor-meta">Leve ${c.leve} pague ${
                    c.pague
                  }</span></div>
                  <button type="button" class="btn btn-texto btn-sm" data-mega="combo-del" data-id="${escapeHtml(
                    c.id
                  )}">Excluir</button></div>`
              )
              .join("") || `<p class="ranking-vazio">Nenhum combo</p>`}
          </div>
        </section>

        <section class="pulso-secao">
          <h3 class="painel-titulo">Cupons</h3>
          <form id="form-cupom" class="form form-despesa">
            <div class="form-linha">
              <label>Código <input id="cupom-codigo" required placeholder="PROMO10" /></label>
              <label>Tipo
                <select id="cupom-tipo">
                  <option value="valor">R$ fixo</option>
                  <option value="percentual">%</option>
                </select>
              </label>
            </div>
            <div class="form-linha">
              <label>Valor <input type="number" id="cupom-valor" min="0" step="0.01" required /></label>
              <label>Usos <input type="number" id="cupom-usos" min="1" value="1" /></label>
            </div>
            <button type="submit" class="btn btn-primario">Criar cupom</button>
          </form>
          <div class="lista-despesas">
            ${cupons
              .map(
                (c) =>
                  `<div class="despesa-linha"><div><strong>${escapeHtml(
                    c.codigo
                  )}</strong><span class="fornecedor-meta">${
                    c.tipo === "percentual" ? c.valor + "%" : formatarMoeda(c.valor)
                  } · ${c.usosRestantes} uso(s)</span></div></div>`
              )
              .join("") || `<p class="ranking-vazio">Nenhum cupom</p>`}
          </div>
        </section>

        <section class="pulso-secao">
          <h3 class="painel-titulo">Turnos & checklist</h3>
          <form id="form-escala" class="form form-despesa">
            <div class="form-linha">
              <label>Nome <input id="escala-nome" required /></label>
              <label>Turno
                <select id="escala-turno">
                  <option value="manha">Manhã</option>
                  <option value="tarde">Tarde</option>
                  <option value="noite">Noite</option>
                </select>
              </label>
            </div>
            <button type="submit" class="btn btn-secundario">Adicionar escala</button>
          </form>
          <div class="lista-despesas">
            ${(turnos.escala || [])
              .slice(0, 8)
              .map(
                (t) =>
                  `<div class="despesa-linha"><div><strong>${escapeHtml(
                    t.funcionarioNome
                  )}</strong><span class="fornecedor-meta">${escapeHtml(
                    t.dia
                  )} · ${escapeHtml(t.turno)}</span></div></div>`
              )
              .join("") || `<p class="ranking-vazio">Sem escala</p>`}
          </div>
          <h4 class="painel-titulo">Checklist abertura</h4>
          <div id="check-abertura">
            ${(turnos.checklistAbertura || [])
              .map(
                (c) =>
                  `<label class="checkbox"><input type="checkbox" data-check="abertura" data-id="${escapeHtml(
                    c.id
                  )}" ${c.ok ? "checked" : ""}/> ${escapeHtml(c.texto)}</label>`
              )
              .join("")}
          </div>
          <h4 class="painel-titulo">Checklist fechamento</h4>
          <div id="check-fechamento">
            ${(turnos.checklistFechamento || [])
              .map(
                (c) =>
                  `<label class="checkbox"><input type="checkbox" data-check="fechamento" data-id="${escapeHtml(
                    c.id
                  )}" ${c.ok ? "checked" : ""}/> ${escapeHtml(c.texto)}</label>`
              )
              .join("")}
          </div>
        </section>

        <section class="pulso-secao">
          <h3 class="painel-titulo">Auditoria recente</h3>
          <div class="lista-despesas">
            ${
              auditoria.length
                ? auditoria
                    .map((a) => {
                      const quando = a.criadoEm
                        ? new Date(a.criadoEm).toLocaleString("pt-BR")
                        : "—";
                      return `<div class="despesa-linha"><div><strong>${escapeHtml(
                        a.tipo
                      )}</strong><span class="fornecedor-meta">${escapeHtml(
                        quando
                      )} · ${escapeHtml(a.funcionarioNome || "—")}</span>
                      <span class="fornecedor-obs">${escapeHtml(
                        a.mensagem || ""
                      )}</span></div></div>`;
                    })
                    .join("")
                : `<p class="ranking-vazio">Sem eventos ainda</p>`
            }
          </div>
        </section>

        <section class="pulso-secao">
          <h3 class="painel-titulo">Simulador de preço +5%</h3>
          <label>Produto
            <select id="sim-produto">${produtosOpts}</select>
          </label>
          <p id="sim-resultado" class="form-ajuda">Escolha um produto</p>
          <button type="button" class="btn btn-secundario btn-sm" data-mega="simular">Simular</button>
        </section>
      </div>
      <p class="form-ajuda" style="margin-top:12px">Competência DRE: ${competenciaDe()}</p>
    `;
  }

  _clique(e) {
    const check = e.target.closest("[data-check]");
    if (check) {
      const lojaId = obterLojaId();
      const dados = lerTurnos(lojaId);
      const lista =
        check.dataset.check === "abertura"
          ? dados.checklistAbertura
          : dados.checklistFechamento;
      const item = lista.find((x) => x.id === check.dataset.id);
      if (item) item.ok = check.checked;
      salvarTurnos(lojaId, dados);
      return;
    }

    const btn = e.target.closest("[data-mega]");
    if (!btn) return;
    const acao = btn.dataset.mega;
    if (acao === "pedido-wa") this._pedidoWa();
    if (acao === "pedido-pdf") this._pedidoPdf();
    if (acao === "dre-pdf") {
      const dre = montarDreMes(
        this.obterVendas(),
        this.obterDespesas(),
        this.obterProdutos()
      );
      baixarHtmlComoArquivo(
        htmlDrePdf(dre),
        `DRE-${dre.competencia}.html`
      );
      notificar("DRE exportado.", "sucesso");
    }
    if (acao === "combo-del") {
      const lojaId = obterLojaId();
      salvarCombos(
        lojaId,
        listarCombos(lojaId).filter((c) => c.id !== btn.dataset.id)
      );
      this.renderizar();
    }
    if (acao === "simular") {
      const id = this.raiz.querySelector("#sim-produto")?.value;
      const p = this.obterProdutos().find((x) => x.id === id);
      const el = this.raiz.querySelector("#sim-resultado");
      if (!p || !el) return;
      const novo = Number((Number(p.preco) * 1.05).toFixed(2));
      el.textContent = `${p.nome}: de ${formatarMoeda(p.preco)} para ${formatarMoeda(
        novo
      )} (+5%). Em 100 vendas iguais, +${formatarMoeda(
        (novo - Number(p.preco)) * 100
      )}.`;
    }
  }

  async _submit(e) {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.id === "form-inventario") {
      e.preventDefault();
      const id = form.querySelector("#inv-produto")?.value;
      const contado = Number(form.querySelector("#inv-qtd")?.value);
      const p = this.obterProdutos().find((x) => x.id === id);
      if (!p || !Number.isFinite(contado)) return;
      const delta = contado - (Number(p.estoque) || 0);
      try {
        await ajustarEstoque(p.id, p.estoque, delta);
        notificar(
          `Inventário: ${p.nome} ajustado em ${delta >= 0 ? "+" : ""}${delta}.`,
          "sucesso"
        );
        form.reset();
      } catch (erro) {
        notificar(erro.message, "erro");
      }
      return;
    }

    if (form.id === "form-combo") {
      e.preventDefault();
      const lojaId = obterLojaId();
      const lista = listarCombos(lojaId);
      lista.unshift({
        id: `cb_${Date.now().toString(36)}`,
        nome: form.querySelector("#combo-nome").value,
        produtoId: form.querySelector("#combo-produto").value,
        leve: Number(form.querySelector("#combo-leve").value) || 2,
        pague: Number(form.querySelector("#combo-pague").value) || 1,
        ativo: true,
      });
      salvarCombos(lojaId, lista);
      notificar("Combo salvo.", "sucesso");
      this.renderizar();
      return;
    }

    if (form.id === "form-cupom") {
      e.preventDefault();
      try {
        criarCupom(obterLojaId(), {
          codigo: form.querySelector("#cupom-codigo").value,
          tipo: form.querySelector("#cupom-tipo").value,
          valor: form.querySelector("#cupom-valor").value,
          usos: form.querySelector("#cupom-usos").value,
        });
        notificar("Cupom criado.", "sucesso");
        this.renderizar();
      } catch (erro) {
        notificar(erro.message, "erro");
      }
      return;
    }

    if (form.id === "form-escala") {
      e.preventDefault();
      adicionarEscala(obterLojaId(), {
        funcionarioNome: form.querySelector("#escala-nome").value,
        turno: form.querySelector("#escala-turno").value,
      });
      notificar("Escala adicionada.", "sucesso");
      this.renderizar();
    }
  }

  _pedidoWa() {
    const giro = preverDiasEstoque(this.obterProdutos(), this.obterVendas());
    const itens = montarItensPedido(giro, 7);
    const forn = (this.obterFornecedores() || []).find((f) => f.ativo !== false);
    const msg = textoPedidoCompra({
      lojaNome: obterMetaLoja()?.nomeLoja,
      fornecedorNome: forn?.nome,
      itens,
    });
    const url = urlWhatsApp(forn?.whatsapp || forn?.telefone, msg);
    if (!url) {
      navigator.clipboard?.writeText(msg);
      notificar("Pedido copiado (cadastre WhatsApp do fornecedor).", "alerta");
      return;
    }
    abrirWhatsApp(url);
  }

  _pedidoPdf() {
    const giro = preverDiasEstoque(this.obterProdutos(), this.obterVendas());
    const itens = montarItensPedido(giro, 7);
    baixarHtmlComoArquivo(
      htmlPedidoCompraPdf({
        lojaNome: obterMetaLoja()?.nomeLoja,
        itens,
      }),
      `pedido-compra.html`
    );
    notificar("Pedido exportado.", "sucesso");
  }
}
