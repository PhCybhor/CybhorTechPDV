/**
 * Integra o “adicione tudo” do checklist no app autenticado.
 */
import { PainelClientes } from "./ui/clientes.js";
import { PainelGestaoAvancada } from "./ui/gestaoAvancada.js";
import { observarClientes, aplicarPosVendaCliente } from "./services/clienteService.js";
import { observarAuditoria, registrarAuditoria } from "./services/auditoriaService.js";
import { caixaAbertoHoje } from "./services/caixaCicloService.js";
import { anexarEfeitoPosVenda } from "./services/filaVendasOffline.js";
import { ehErroDeConexao } from "./config/apiClient.js";
import {
  precoEfetivo,
  calcularDescontoCombos,
  aplicarCupom,
  consumirCupom,
} from "./services/promocaoService.js";
import { obterLojaId } from "./services/tenantContext.js";
import {
  lerOnboarding,
  obterPassosOnboarding,
  marcarPassoOnboarding,
  pularOnboarding,
} from "./services/onboardingStore.js";
import { notificar } from "./ui/notificacao.js";
import { formatarMoeda } from "./utils/formato.js";
import { escapeHtml } from "./utils/escape.js";
import { CARGOS } from "./services/authService.js";
import { urlWhatsApp, abrirWhatsApp } from "./services/whatsappUtil.js";
import { obterMetaLoja } from "./services/tenantContext.js";

/**
 * @param {object} ctx
 */
export function instalarMegaPack(ctx) {
  const { estado, $, navegarPara, abrirModal, fecharModal } = ctx;

  estado.clientes = estado.clientes || [];
  estado.auditoria = estado.auditoria || [];
  estado.clienteVendaAtual = null;
  estado.cancelarObservacaoClientes = null;
  estado.cancelarObservacaoAuditoria = null;
  estado.painelClientes = null;
  estado.painelGestao = null;

  async function aoEntrarMega() {
    if (!estado.painelClientes && $("lista-clientes")) {
      estado.painelClientes = new PainelClientes({
        listaEl: $("lista-clientes"),
        formEl: $("form-cliente"),
        obterVendas: () => estado.vendas,
        onSelecionarPdv: (c) => {
          estado.clienteVendaAtual = c;
          atualizarChipCliente();
          navegarPara("pdv");
          notificar(`Cliente ${c.nome} no caixa.`, "sucesso");
          marcarPassoOnboarding("venda");
        },
      });
    }
    if (!estado.painelGestao && $("painel-gestao-root")) {
      estado.painelGestao = new PainelGestaoAvancada({
        raiz: $("painel-gestao-root"),
        obterProdutos: () => estado.produtos,
        obterVendas: () => estado.vendas,
        obterDespesas: () => estado.despesas,
        obterFornecedores: () => estado.fornecedores,
        obterAuditoria: () => estado.auditoria,
      });
    }

    if (!estado.cancelarObservacaoClientes) {
      try {
        estado.cancelarObservacaoClientes = await observarClientes((lista) => {
          estado.clientes = lista;
          estado.painelClientes?.atualizar(lista);
          popularSelectClientes();
        });
      } catch {
        /* ok */
      }
    } else {
      estado.painelClientes?.atualizar(estado.clientes);
    }

    if (
      estado.funcionario?.cargo === CARGOS.ADMIN &&
      !estado.cancelarObservacaoAuditoria
    ) {
      try {
        estado.cancelarObservacaoAuditoria = await observarAuditoria((lista) => {
          estado.auditoria = lista;
          if (estado.rotaAtual === "gestao") estado.painelGestao?.renderizar();
        });
      } catch {
        /* ok */
      }
    }

    popularSelectClientes();
    mostrarOnboardingSePreciso();
  }

  function popularSelectClientes() {
    const sel = $("pdv-cliente");
    if (!sel) return;
    const atual = estado.clienteVendaAtual?.id || sel.value;
    sel.innerHTML =
      `<option value="">Cliente (opcional)</option>` +
      (estado.clientes || [])
        .filter((c) => c.ativo !== false)
        .map(
          (c) =>
            `<option value="${escapeHtml(c.id)}">${escapeHtml(c.nome)}${
              Number(c.saldoFiado) > 0 ? " · fiado" : ""
            }</option>`
        )
        .join("");
    if (atual) sel.value = atual;
  }

  function atualizarChipCliente() {
    const chip = $("pdv-cliente-chip");
    const c = estado.clienteVendaAtual;
    if (!chip) return;
    if (!c) {
      chip.classList.add("oculto");
      chip.textContent = "";
      return;
    }
    chip.classList.remove("oculto");
    chip.textContent = `${c.nome}${
      Number(c.saldoFiado) > 0 ? ` · fiado ${formatarMoeda(c.saldoFiado)}` : ""
    }`;
  }

  function mostrarOnboardingSePreciso() {
    const box = $("onboarding-box");
    if (!box) return;
    const { feito, concluidos } = lerOnboarding();
    if (feito) {
      box.classList.add("oculto");
      return;
    }
    const passos = obterPassosOnboarding();
    box.classList.remove("oculto");
    box.innerHTML = `
      <strong>Comece em 5 passos</strong>
      <ul class="onboarding-lista">
        ${passos
          .map(
            (p) =>
              `<li class="${
                concluidos.includes(p.id) ? "feito" : ""
              }"><button type="button" data-onboard="${escapeHtml(
                p.id
              )}" data-rota="${escapeHtml(p.rota)}" data-aba="${escapeHtml(
                p.aba || ""
              )}">${escapeHtml(p.titulo)}</button></li>`
          )
          .join("")}
      </ul>
      <button type="button" class="btn btn-texto btn-sm" id="btn-pular-onboarding">Pular</button>`;
  }

  function produtoParaCarrinho(produto, quantidade = 1) {
    const preco = precoEfetivo(produto);
    return {
      ...produto,
      preco,
      _precoOriginal: Number(produto.preco) || 0,
      _emPromo: preco < (Number(produto.preco) || 0),
    };
  }

  /**
   * Validações antes de finalizar (abertura, desconto max, fiado).
   * @returns {Promise<{ ok: boolean, formasExtras?: object }>}
   */
  async function validarAntesDeFinalizar(carrinho) {
    const config = estado.configLoja || {};
    const ocultarCliente = Boolean(config.ocultarCliente);
    const ocultarFiado = Boolean(config.ocultarFiado) || ocultarCliente;
    const ocultarDesconto = Boolean(config.ocultarDesconto);

    if (config.abrirCaixaObrigatorio !== false) {
      const aberto = await caixaAbertoHoje();
      if (!aberto) {
        notificar(
          "Abra o caixa do dia (Números → Gaveta) antes de vender.",
          "alerta"
        );
        if (estado.funcionario?.cargo === CARGOS.ADMIN) {
          navegarPara("relatorios");
          setTimeout(() => {
            document
              .querySelector('[data-aba-relatorio="caixa"]')
              ?.dispatchEvent(new Event("click", { bubbles: true }));
          }, 100);
        }
        return { ok: false };
      }
    }

    const subtotal = carrinho.obterSubtotal();
    const desconto = ocultarDesconto ? 0 : carrinho.obterDesconto();
    const maxPct = Number(config.descontoMaxPct);
    if (
      !ocultarDesconto &&
      Number.isFinite(maxPct) &&
      maxPct >= 0 &&
      subtotal > 0 &&
      (desconto / subtotal) * 100 > maxPct + 0.001
    ) {
      if (estado.funcionario?.cargo !== CARGOS.ADMIN) {
        notificar(
          `Desconto acima de ${maxPct}% exige administrador.`,
          "alerta"
        );
        return { ok: false };
      }
      const ok = confirm(
        `Desconto ${(desconto / subtotal * 100).toFixed(1)}% acima do limite (${maxPct}%). Autorizar?`
      );
      if (!ok) return { ok: false };
      await registrarAuditoria({
        tipo: "desconto_alto",
        mensagem: `Desconto ${formatarMoeda(desconto)} (${(
          (desconto / subtotal) *
          100
        ).toFixed(1)}%) autorizado`,
        funcionario: estado.funcionario,
        meta: { desconto, subtotal },
      });
    }

    const checkFiado = $("check-venda-fiado");
    const clienteId = ocultarCliente
      ? null
      : $("pdv-cliente")?.value || estado.clienteVendaAtual?.id;
    const fiadoAtivo = !ocultarFiado && Boolean(checkFiado?.checked);
    if (fiadoAtivo) {
      if (!clienteId) {
        notificar("Selecione um cliente para vender fiado.", "alerta");
        return { ok: false };
      }
      const cli = estado.clientes.find((c) => c.id === clienteId);
      const total = carrinho.obterTotal();
      const novoSaldo = (Number(cli?.saldoFiado) || 0) + total;
      if (cli && Number(cli.limiteFiado) > 0 && novoSaldo > Number(cli.limiteFiado)) {
        notificar(
          `Limite de fiado ${formatarMoeda(cli.limiteFiado)} seria ultrapassado.`,
          "alerta"
        );
        return { ok: false };
      }
    }

    // Combos + cupom
    let descontoExtra = 0;
    const { descontoCombo } = calcularDescontoCombos(
      carrinho.obterItens(),
      obterLojaId()
    );
    descontoExtra += descontoCombo;
    const codigoCupom = $("pdv-cupom")?.value;
    let cupomUsado = null;
    if (codigoCupom) {
      const r = aplicarCupom(
        obterLojaId(),
        codigoCupom,
        Math.max(0, subtotal - desconto)
      );
      if (!r.ok) {
        notificar(r.mensagem || "Cupom inválido.", "alerta");
        return { ok: false };
      }
      descontoExtra += r.desconto;
      cupomUsado = r.cupom;
    }

    return {
      ok: true,
      descontoExtra,
      cupomUsado,
      clienteId: clienteId || null,
      foiFiado: fiadoAtivo,
    };
  }

  /**
   * Venda guardada offline: o passo espera a venda chegar ao servidor.
   * Venda online cujo passo caiu por falta de rede: o passo vai para a fila.
   */
  async function executarOuGuardarPosVenda(venda, efeito) {
    if (!venda.offline) {
      try {
        await (efeito.tipo === "posVendaCliente"
          ? aplicarPosVendaCliente(efeito.dados.clienteId, efeito.dados)
          : registrarAuditoria(efeito.dados));
        return;
      } catch (erro) {
        if (!ehErroDeConexao(erro)) throw erro;
      }
    }
    await anexarEfeitoPosVenda(venda.id, efeito);
  }

  function funcionarioParaAuditoria() {
    const f = estado.funcionario;
    return f ? { id: f.id, nome: f.nome } : null;
  }

  async function aposVendaMega(venda, extras = {}) {
    if (extras.cupomUsado) {
      consumirCupom(obterLojaId(), extras.cupomUsado.codigo);
    }
    if (extras.clienteId) {
      await executarOuGuardarPosVenda(venda, {
        tipo: "posVendaCliente",
        dados: {
          clienteId: extras.clienteId,
          total: venda.total,
          foiFiado: extras.foiFiado,
          cashbackPct: Number(estado.configLoja?.cashbackPct) || 0,
        },
      });
      marcarPassoOnboarding("venda");
    }
    if (extras.descontoAlto || (venda.desconto || 0) > 0) {
      await executarOuGuardarPosVenda(venda, {
        tipo: "auditoria",
        dados: {
          tipo: "venda",
          mensagem: `Venda ${formatarMoeda(venda.total)}${
            venda.desconto ? ` · desc. ${formatarMoeda(venda.desconto)}` : ""
          }${extras.foiFiado ? " · FIADO" : ""}`,
          funcionario: funcionarioParaAuditoria(),
          meta: { vendaId: venda.id },
        },
      });
    }
    if ($("pdv-avaliacao") && Number($("pdv-avaliacao").value) > 0) {
      await executarOuGuardarPosVenda(venda, {
        tipo: "auditoria",
        dados: {
          tipo: "avaliacao",
          mensagem: `Atendimento nota ${$("pdv-avaliacao").value}`,
          funcionario: funcionarioParaAuditoria(),
          meta: { vendaId: venda.id },
        },
      });
      $("pdv-avaliacao").value = "0";
    }
    // WhatsApp cupom texto
    if ($("check-enviar-wa-cupom")?.checked && extras.clienteId) {
      const cli = estado.clientes.find((c) => c.id === extras.clienteId);
      const fone = cli?.whatsapp || cli?.telefone;
      const msg =
        `Obrigado${cli ? `, ${cli.nome}` : ""}! Compra de ${formatarMoeda(
          venda.total
        )} na ${obterMetaLoja()?.nomeLoja || "loja"}.` +
        (extras.foiFiado ? " (fiado)" : "");
      const url = urlWhatsApp(fone, msg);
      if (url) abrirWhatsApp(url);
    }
    estado.clienteVendaAtual = null;
    if ($("pdv-cliente")) $("pdv-cliente").value = "";
    if ($("check-venda-fiado")) $("check-venda-fiado").checked = false;
    if ($("pdv-cupom")) $("pdv-cupom").value = "";
    atualizarChipCliente();
  }

  function trocoInteligente(total) {
    const notas = [2, 5, 10, 20, 50, 100, 200];
    const t = Number(total) || 0;
    if (t <= 0) return [];
    const sugestoes = new Set([Math.ceil(t)]);
    for (const n of notas) {
      if (n >= t) sugestoes.add(n);
      const mult = Math.ceil(t / n) * n;
      if (mult > t) sugestoes.add(mult);
    }
    return Array.from(sugestoes)
      .filter((v) => v >= t)
      .sort((a, b) => a - b)
      .slice(0, 5);
  }

  function atualizarAtalhosTrocoInteligente(carrinho) {
    const wrap = $("atalhos-troco");
    if (!wrap || !carrinho) return;
    const total = carrinho.obterTotal();
    const ehDinheiro =
      carrinho.dividirPagamento ||
      $("forma-pagamento")?.value === "dinheiro";
    if (!ehDinheiro) return;
    const vals = trocoInteligente(total);
    // Mantém botões extras sem destruir os existentes — só atualiza data
    wrap.querySelectorAll("[data-troco-valor]").forEach((b) => b.remove());
    for (const v of vals) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn btn-secundario btn-sm";
      b.dataset.trocoValor = String(v);
      b.textContent = formatarMoeda(v);
      wrap.appendChild(b);
    }
  }

  // Eventos
  if (!estado._megaEventos) {
    estado._megaEventos = true;

    document.addEventListener("click", (e) => {
      if (e.target.closest("#btn-pular-onboarding")) {
        pularOnboarding();
        mostrarOnboardingSePreciso();
        return;
      }
      const ob = e.target.closest("[data-onboard]");
      if (ob) {
        marcarPassoOnboarding(ob.dataset.onboard);
        navegarPara(ob.dataset.rota);
        if (ob.dataset.aba) {
          setTimeout(() => {
            document
              .querySelector(`[data-aba-relatorio="${ob.dataset.aba}"]`)
              ?.dispatchEvent(new Event("click", { bubbles: true }));
          }, 120);
        }
        mostrarOnboardingSePreciso();
        return;
      }
      const tv = e.target.closest("[data-troco-valor]");
      if (tv && estado.carrinho) {
        estado.carrinho.valorRecebido = Number(tv.dataset.trocoValor) || 0;
        if ($("carrinho-recebido")) {
          $("carrinho-recebido").value = String(estado.carrinho.valorRecebido);
        }
        estado.carrinho.renderizar();
      }
      if (e.target.closest("#btn-limpar-cliente-pdv")) {
        estado.clienteVendaAtual = null;
        if ($("pdv-cliente")) $("pdv-cliente").value = "";
        atualizarChipCliente();
      }
      if (e.target.closest("#btn-repetir-ultima-cesta")) {
        const ultima = (estado.vendas || []).find((v) => !v.cancelada);
        if (!ultima?.itens?.length) {
          notificar("Nenhuma venda para repetir.", "alerta");
          return;
        }
        for (const i of ultima.itens) {
          const p = estado.produtos.find((x) => x.id === i.produtoId);
          if (p) estado.carrinho?.adicionar(produtoParaCarrinho(p), i.quantidade);
        }
        notificar("Cesta da última venda carregada.", "sucesso");
      }
      if (e.target.closest("#btn-modo-venda-rapida")) {
        document.body.classList.toggle("venda-rapida");
        const on = document.body.classList.contains("venda-rapida");
        notificar(
          on
            ? "Venda rápida ON — use “Sair da venda rápida” ou Esc"
            : "Venda rápida OFF",
          "sucesso"
        );
        if (on) setTimeout(() => $("busca-produto")?.focus(), 40);
        return;
      }
      if (e.target.closest("#btn-sair-venda-rapida")) {
        return;
      }
    });

    $("pdv-cliente")?.addEventListener("change", () => {
      const id = $("pdv-cliente").value;
      estado.clienteVendaAtual =
        estado.clientes.find((c) => c.id === id) || null;
      atualizarChipCliente();
    });

    window.addEventListener("cybhor-caixa-aberto", () => {
      marcarPassoOnboarding("fundo");
      mostrarOnboardingSePreciso();
    });
  }

  return {
    aoEntrarMega,
    validarAntesDeFinalizar,
    aposVendaMega,
    produtoParaCarrinho,
    atualizarAtalhosTrocoInteligente,
    registrarAuditoria,
    mostrarOnboardingSePreciso,
    marcarPassoOnboarding,
    precoEfetivo,
  };
}
