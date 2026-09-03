/**
 * Integração das features “melhor do mercado” sem inchá-las no app.js.
 */
import { formatarMoeda } from "./utils/formato.js";
import { escapeHtml } from "./utils/escape.js";
import { notificar } from "./ui/notificacao.js";
import { ComandoPalette } from "./ui/comandoPalette.js";
import { PainelPulso } from "./ui/pulso.js";
import { PainelCaixaFisico } from "./ui/caixaFisico.js";
import { sugerirParaCarrinho } from "./services/compradosJuntos.js";
import {
  lerPreferenciasCaixa,
  salvarMetaDia,
} from "./services/caixaOperadorStore.js";
import { garantirDespesasRecorrentes } from "./services/despesaService.js";
import { montarBackupLoja, baixarBlob } from "./services/backupService.js";
import { obterLojaId, obterMetaLoja } from "./services/tenantContext.js";
import {
  observarSuprimentos,
} from "./services/caixaCicloService.js";
import { criarSangria } from "./services/sangriaService.js";
import {
  urlWhatsApp,
  abrirWhatsApp,
  montarMensagemReposicao,
} from "./services/whatsappUtil.js";
import { CARGOS } from "./services/authService.js";
import { pode } from "./services/permissoesOperador.js";

/**
 * @param {object} ctx — estado + callbacks do app
 */
export function instalarRevolucao(ctx) {
  const {
    estado,
    $,
    navegarPara,
    abrirModal,
    fecharModal,
    iniciarAssistente,
    iniciarRelatorios,
  } = ctx;

  estado.suprimentos = estado.suprimentos || [];
  estado.painelPulso = null;
  estado.painelCaixaFisico = null;
  estado.comandoPalette = null;
  estado.cancelarObservacaoSuprimentos = null;

  // --- Paleta Ctrl+K ---
  estado.comandoPalette = new ComandoPalette({
    obterComandos: () => {
      const admin = estado.funcionario?.cargo === CARGOS.ADMIN;
      const base = [
        { id: "pdv", titulo: "Ir para o Caixa", atalho: "F2", rota: "pdv" },
        { id: "historico", titulo: "Histórico de vendas", rota: "historico" },
        { id: "sangria-pdv", titulo: "Registrar sangria rápida", acao: "sangria-pdv" },
        { id: "meta", titulo: "Definir meta do dia", acao: "meta-dia" },
        { id: "ajuda", titulo: "Ajuda do caixa", acao: "ajuda", atalho: "F1" },
      ];
      if (!admin) return base;
      return [
        ...base,
        { id: "pulso", titulo: "Pulso da loja", acao: "relatorios-pulso" },
        { id: "relatorios", titulo: "Números da loja", rota: "relatorios" },
        { id: "gastos", titulo: "Gastos / Despesas", acao: "relatorios-gastos" },
        { id: "caixa-fisico", titulo: "Caixa físico (fundo/suprimento)", acao: "relatorios-caixa" },
        { id: "produtos", titulo: "Produtos", rota: "produtos" },
        { id: "fornecedores", titulo: "Fornecedores", rota: "fornecedores" },
        { id: "clientes", titulo: "Clientes / fiado", rota: "clientes" },
        { id: "gestao", titulo: "Gestão+ (DRE, pedido, combos)", rota: "gestao" },
        { id: "assistente", titulo: "CybhorIA", rota: "assistente" },
        { id: "concorrencia-ia", titulo: "Concorrência (IA)", acao: "assistente-concorrencia" },
        { id: "equipe", titulo: "Equipe", rota: "funcionarios" },
        { id: "config", titulo: "Configurações", rota: "configuracoes" },
        { id: "backup", titulo: "Exportar backup JSON", acao: "backup" },
      ];
    },
    onExecutar: (cmd) => executarComando(cmd),
  });

  function abrirAbaRelatorio(id) {
    navegarPara("relatorios");
    iniciarRelatorios?.();
    setTimeout(() => {
      document
        .querySelector(`[data-aba-relatorio="${id}"]`)
        ?.dispatchEvent(new Event("click", { bubbles: true }));
    }, 80);
  }

  function executarComando(cmd) {
    if (cmd.rota) {
      navegarPara(cmd.rota);
      if (cmd.rota === "assistente") iniciarAssistente?.();
      return;
    }
    switch (cmd.acao) {
      case "sangria-pdv":
        abrirModal("modal-sangria-pdv");
        $("sangria-pdv-valor")?.focus();
        break;
      case "meta-dia":
        definirMetaInterativa();
        break;
      case "ajuda":
        abrirModal("modal-ajuda-caixa");
        break;
      case "relatorios-pulso":
        abrirAbaRelatorio("pulso");
        break;
      case "relatorios-gastos":
        abrirAbaRelatorio("gastos");
        break;
      case "relatorios-caixa":
        abrirAbaRelatorio("caixa");
        break;
      case "assistente-concorrencia":
      case "assistente-promocoes":
        navegarPara("assistente");
        iniciarAssistente?.();
        estado.painelAssistente?.prepararPergunta?.(
          cmd.acao === "assistente-promocoes" ? "promocoes" : "concorrencia",
          ""
        );
        break;
      case "backup":
        exportarBackup();
        break;
      default:
        break;
    }
  }

  function definirMetaInterativa() {
    const atual = lerPreferenciasCaixa(estado.funcionario?.id).metaDia || 0;
    const bruto = window.prompt(
      "Meta de vendas do dia (R$):",
      atual ? String(atual) : "1500"
    );
    if (bruto === null) return;
    const valor = salvarMetaDia(estado.funcionario?.id, bruto);
    const cfg = $("cfg-meta-dia");
    if (cfg) cfg.value = String(valor || "");
    atualizarMetaCaixa();
    notificar(
      valor > 0
        ? `Meta do dia: ${formatarMoeda(valor)}`
        : "Meta do dia removida.",
      "sucesso"
    );
  }

  function atualizarMetaCaixa() {
    const barra = $("meta-caixa-barra");
    if (!barra || !estado.funcionario) return;
    const meta = lerPreferenciasCaixa(estado.funcionario.id).metaDia || 0;
    if (meta <= 0) {
      barra.classList.add("oculto");
      return;
    }
    const t0 = new Date();
    t0.setHours(0, 0, 0, 0);
    const totalHoje = (estado.vendas || [])
      .filter((v) => !v.cancelada && (v.criadoEm || 0) >= t0.getTime())
      .reduce((s, v) => s + (Number(v.total) || 0), 0);
    const pct = Math.min(100, Math.round((totalHoje / meta) * 100));
    barra.classList.remove("oculto");
    const texto = $("meta-caixa-texto");
    const fill = $("meta-caixa-preenchimento");
    if (texto) {
      texto.textContent = `${formatarMoeda(totalHoje)} / ${formatarMoeda(meta)} (${pct}%)`;
    }
    if (fill) {
      fill.style.width = `${pct}%`;
      fill.classList.toggle("meta-completa", pct >= 100);
    }
  }

  function atualizarUpsell() {
    const el = $("upsell-carrinho");
    if (!el || !estado.carrinho) return;
    const ids = estado.carrinho.obterItens().map((i) => i.produtoId);
    if (ids.length === 0) {
      el.classList.add("oculto");
      el.innerHTML = "";
      return;
    }
    const sugestoes = sugerirParaCarrinho(estado.vendas, ids, 4);
    const mapa = new Map((estado.produtos || []).map((p) => [p.id, p]));
    const cards = sugestoes
      .map((s) => mapa.get(s.produtoId))
      .filter((p) => p && (Number(p.estoque) || 0) > 0)
      .slice(0, 3);
    if (!cards.length) {
      el.classList.add("oculto");
      el.innerHTML = "";
      return;
    }
    el.classList.remove("oculto");
    el.innerHTML = `
      <span class="upsell-rotulo">Leva junto?</span>
      <div class="upsell-chips">
        ${cards
          .map(
            (p) => `
          <button type="button" class="btn btn-secundario btn-sm" data-upsell-id="${escapeHtml(
            p.id
          )}" title="Comprado junto com frequência">
            + ${escapeHtml(p.nome)} · ${formatarMoeda(p.preco)}
          </button>`
          )
          .join("")}
      </div>`;
  }

  function atualizarPulso() {
    if (!estado.painelPulso) return;
    const resumo = ctx.gerarResumo?.(estado.vendas, {
      produtos: estado.produtos,
      despesas: estado.despesas,
    });
    estado.painelPulso.atualizar({
      vendas: estado.vendas,
      produtos: estado.produtos,
      despesas: estado.despesas,
      sangrias: estado.sangrias,
      resumo,
    });
  }

  async function iniciarObservacaoSuprimentos() {
    if (estado.cancelarObservacaoSuprimentos) {
      estado.painelCaixaFisico?.atualizarSuprimentos(estado.suprimentos);
      await estado.painelCaixaFisico?.atualizarEstado();
      return;
    }
    try {
      estado.cancelarObservacaoSuprimentos = await observarSuprimentos(
        (lista) => {
          estado.suprimentos = lista;
          estado.painelCaixaFisico?.atualizarSuprimentos(lista);
          estado.dashboard?.atualizar(estado.vendas);
        }
      );
      await estado.painelCaixaFisico?.atualizarEstado();
    } catch {
      /* silencioso se nó ainda não existe */
    }
  }

  function exportarBackup() {
    if (estado.funcionario?.cargo !== CARGOS.ADMIN) {
      notificar("Somente administrador exporta backup.", "alerta");
      return;
    }
    const meta = obterMetaLoja() || {};
    const { nomeArquivo, blob } = montarBackupLoja({
      lojaId: obterLojaId(),
      lojaNome: meta.nomeLoja || meta.lojaNome || estado.configLoja?.lojaNome,
      produtos: estado.produtos,
      vendas: estado.vendas,
      despesas: estado.despesas,
      sangrias: estado.sangrias,
      fornecedores: estado.fornecedores,
      funcionarios: estado.listaFuncionarios,
    });
    baixarBlob(blob, nomeArquivo);
    notificar("Backup exportado.", "sucesso");
  }

  async function aoEntrarSessao() {
    try {
      const n = await garantirDespesasRecorrentes();
      if (n > 0) {
        notificar(
          `${n} despesa(s) recorrente(s) lançada(s) neste mês.`,
          "sucesso"
        );
      }
    } catch {
      /* ok */
    }

    const prefs = lerPreferenciasCaixa(estado.funcionario?.id);
    const cfgMeta = $("cfg-meta-dia");
    if (cfgMeta) cfgMeta.value = prefs.metaDia ? String(prefs.metaDia) : "";

    const raizPulso = $("painel-pulso-root");
    if (raizPulso && !estado.painelPulso) {
      estado.painelPulso = new PainelPulso({
        raiz: raizPulso,
        obterLojaId,
        onAcao: (acao) => {
          if (acao === "recarregar-pulso") {
            atualizarPulso();
            return;
          }
          if (acao === "campanha-copiada") {
            notificar("Campanha copiada.", "sucesso");
            return;
          }
          if (acao === "produtos") navegarPara("produtos");
          else if (acao === "fornecedores") navegarPara("fornecedores");
          else if (acao === "pdv") navegarPara("pdv");
          else if (acao === "relatorios" || acao === "relatorios-gastos") {
            abrirAbaRelatorio(acao === "relatorios-gastos" ? "gastos" : "receita");
          } else if (
            acao === "assistente-promocoes" ||
            acao === "assistente-concorrencia"
          ) {
            executarComando({ acao });
          }
        },
      });
    }

    const raizRel = $("rota-relatorios");
    if (raizRel && !estado.painelCaixaFisico) {
      estado.painelCaixaFisico = new PainelCaixaFisico({
        raiz: raizRel,
        obterFuncionario: () => estado.funcionario,
        obterVendas: () => estado.vendas,
        obterSangrias: () => estado.sangrias,
      });
    }

    // Patch carrinho render → upsell
    if (estado.carrinho && !estado.carrinho._revolucaoPatch) {
      const render = estado.carrinho.renderizar.bind(estado.carrinho);
      estado.carrinho.renderizar = () => {
        render();
        atualizarUpsell();
      };
      estado.carrinho._revolucaoPatch = true;
    }

    // Reset UI dividir
    const check = $("check-dividir-pagamento");
    if (check) check.checked = false;
    estado.carrinho?.definirDividir(false);

    await iniciarObservacaoSuprimentos();
    atualizarMetaCaixa();
    atualizarUpsell();
  }

  // --- Eventos DOM (uma vez) ---
  if (!estado._revolucaoEventos) {
    estado._revolucaoEventos = true;

    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if ($("tela-app") && !$("tela-app").classList.contains("oculto")) {
          estado.comandoPalette?.alternar();
        }
      }
    });

    $("check-dividir-pagamento")?.addEventListener("change", (e) => {
      estado.carrinho?.definirDividir(e.target.checked);
    });
    $("dividir-dinheiro")?.addEventListener("input", (e) => {
      estado.carrinho?.definirParteDinheiro(e.target.value);
    });
    $("dividir-resto-forma")?.addEventListener("change", (e) => {
      estado.carrinho?.definirFormaRestante(e.target.value);
    });

    $("upsell-carrinho")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-upsell-id]");
      if (!btn) return;
      const produto = (estado.produtos || []).find(
        (p) => p.id === btn.dataset.upsellId
      );
      if (!produto) return;
      const ok = estado.carrinho?.adicionar(produto, 1);
      if (ok) {
        notificar(`+ ${produto.nome}`, "sucesso");
        atualizarUpsell();
      } else {
        notificar("Sem estoque para esse item.", "alerta");
      }
    });

    $("btn-sangria-pdv")?.addEventListener("click", () => {
      if (!pode(estado.funcionario, "fazerSangria")) {
        notificar("Você não tem permissão para fazer sangria.", "alerta");
        return;
      }
      abrirModal("modal-sangria-pdv");
    });

    $("form-sangria-pdv")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!pode(estado.funcionario, "fazerSangria")) {
        notificar("Você não tem permissão para fazer sangria.", "alerta");
        return;
      }
      try {
        await criarSangria({
          valor: $("sangria-pdv-valor")?.value,
          motivo: $("sangria-pdv-motivo")?.value,
          funcionarioId: estado.funcionario?.id,
          funcionarioNome: estado.funcionario?.nome,
        });
        $("form-sangria-pdv")?.reset();
        fecharModal("modal-sangria-pdv");
        notificar("Sangria registrada.", "sucesso");
      } catch (erro) {
        notificar(erro.message || "Falha na sangria.", "erro");
      }
    });

    $("meta-caixa-barra")?.addEventListener("click", () => definirMetaInterativa());

    $("btn-backup-loja")?.addEventListener("click", () => exportarBackup());

    window.addEventListener("cybhor-campanha-salva", () => atualizarPulso());
  }

  return {
    aoEntrarSessao,
    atualizarMetaCaixa,
    atualizarUpsell,
    atualizarPulso,
    iniciarObservacaoSuprimentos,
    exportarBackup,
    executarComando,
    abrirWhatsAppReposicao(itens, fornecedor) {
      const meta = obterMetaLoja() || {};
      const msg = montarMensagemReposicao({
        lojaNome: meta.nomeLoja || meta.lojaNome || "nossa loja",
        fornecedorNome: fornecedor?.nome,
        itens,
      });
      const url = urlWhatsApp(fornecedor?.whatsapp || fornecedor?.telefone, msg);
      if (!url) {
        notificar("WhatsApp/telefone inválido.", "alerta");
        return;
      }
      abrirWhatsApp(url);
    },
  };
}
