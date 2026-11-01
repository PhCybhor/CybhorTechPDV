import { escapeHtml } from "../utils/escape.js";
import { notificar } from "./notificacao.js";
import { salvarCampanha } from "../services/campanhaService.js";
import { obterLojaId } from "../services/tenantContext.js";

const MODOS = [
  {
    id: "criativos",
    titulo: "Criativos",
    dica: "Posts, stories e anúncios para a loja",
    placeholder: "Ex.: promoção de bebidas no fim de semana para o bairro X…",
  },
  {
    id: "organizacao",
    titulo: "Organização",
    dica: "Gôndola, checkout e fluxo de mercadoria",
    placeholder: "Ex.: tenho padaria + bebidas + limpeza em 40m². Como organizar?",
  },
  {
    id: "pesquisa_area",
    titulo: "Pesquisa de área",
    dica: "Perfil do bairro, concorrentes e oportunidades",
    placeholder: "Ex.: loja em [bairro/cidade]. O que pesquisar antes de ampliar o mix?",
  },
  {
    id: "precificacao",
    titulo: "Precificação",
    dica: "Margem, markup e preço competitivo",
    placeholder: "Ex.: custo R$ 4,00 e concorrente vende a R$ 6,50. Quanto cobrar?",
  },
  {
    id: "compras",
    titulo: "Compras",
    dica: "O que repor, pausar ou liquidar",
    placeholder: "Ex.: o que priorizar na próxima compra com base no giro?",
  },
  {
    id: "promocoes",
    titulo: "Promoções",
    dica: "Combos e ofertas sem matar a margem",
    placeholder: "Ex.: monte 3 combos com os mais vendidos sem ficar no prejuízo",
  },
  {
    id: "concorrencia",
    titulo: "Concorrência",
    dica: "Ideias dos concorrentes adaptadas (ético)",
    placeholder: "Ex.: o mercado da esquina faz combo + entrega. O que posso adaptar?",
  },
  {
    id: "folha",
    titulo: "Folha CLT/PJ",
    dica: "Pagamentos, encargos e riscos de pejotização",
    placeholder:
      "Ex.: tenho um caixa CLT a R$ 2.500 e um estoquista PJ a R$ 3.500/NF. O que observar na lei?",
  },
  {
    id: "caixa",
    titulo: "Caixa",
    dica: "Atendimento, troco, upsell e rotina do PDV",
    placeholder: "Ex.: como treinar um caixa novo em 1 hora?",
  },
  {
    id: "rh",
    titulo: "RH",
    dica: "Admissão, escala, clima e vínculos",
    placeholder: "Ex.: roteiro de entrevista para operador de caixa",
  },
  {
    id: "marketing",
    titulo: "Marketing",
    dica: "Campanhas, vitrine e redes da loja",
    placeholder: "Ex.: campanha de sexta-feira para o bairro",
  },
  {
    id: "cardapio_semana",
    titulo: "Cardápio da semana",
    dica: "7 posts + preços sugeridos para o feed",
    placeholder: "Ex.: mercearia no bairro X — gere 7 ideias com legenda",
  },
  {
    id: "crise",
    titulo: "Modo crise",
    dica: "10 ações se o dia estiver fraco",
    placeholder: "Ex.: estamos 25% abaixo de ontem às 15h. O que fazer agora?",
  },
  {
    id: "placa_oferta",
    titulo: "Placa de oferta",
    dica: "Texto pronto para imprimir / Canva",
    placeholder: "Ex.: placa A4 para refrigerante 2L a R$ 5,99",
  },
  {
    id: "treino_caixa",
    titulo: "Treino do caixa",
    dica: "Quiz de 5 perguntas para o operador",
    placeholder: "Ex.: quiz sobre troco, fiado e upsell",
  },
  {
    id: "livre",
    titulo: "Livre",
    dica: "Pergunte qualquer coisa sobre a loja",
    placeholder: "Ex.: como aumentar o ticket médio no caixa?",
  },
];

const CHAVE_MODO_SESSAO = "cybhor-ia-modo";
const TEXTO_ONBOARDING =
  "Antes de começar: a CybhorIA pode pedir autorização a cada alteração na loja, ou agir no modo autônomo. Qual você prefere nesta sessão?";
const MODOS_CAMPANHA = new Set(["concorrencia", "promocoes", "criativos", "marketing"]);

/**
 * @returns {"autorizacao"|"autonomo"|""}
 */
function lerModoSessao() {
  try {
    const valor = sessionStorage.getItem(CHAVE_MODO_SESSAO);
    if (valor === "autorizacao" || valor === "autonomo") return valor;
  } catch {
    /* sessão indisponível */
  }
  return "";
}

/**
 * @param {"autorizacao"|"autonomo"} valor
 */
function gravarModoSessao(valor) {
  try {
    sessionStorage.setItem(CHAVE_MODO_SESSAO, valor);
  } catch {
    /* sessão indisponível */
  }
}

/** @returns {string} */
function criarId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `ia-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Tira da UI campos internos e caminhos de arquivo.
 * @param {unknown} texto
 * @returns {string}
 */
function textoVisivel(texto) {
  return String(texto || "")
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, "")
    .replace(/(?:\/(?:home|Users|tmp|var|usr|opt|private)\/[^\s"'<>]+)/g, "")
    .replace(/\b[\w./\\-]+\.(?:js|mjs|cjs|json|jsonl|html|css|md)\b/g, "")
    .replace(/\b(?:provider|localOk)\b\s*[:=]?\s*\S*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * @param {string} ts
 * @returns {string}
 */
function formatarQuando(ts) {
  const data = new Date(ts);
  if (Number.isNaN(data.getTime())) return "";
  return data.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Chat da CybhorIA. O modo de operação vai no payload; os chips só prefixam o prompt.
 */
export class PainelAssistente {
  /**
   * @param {{
   *   raiz: HTMLElement,
   *   obterContexto: () => object
   * }} opcoes
   */
  constructor({ raiz, obterContexto }) {
    this.raiz = raiz;
    this.obterContexto = obterContexto;
    this.modo = "livre";
    this.carregando = false;
    /** @type {string} */
    this.confirmToken = "";
    /** @type {{ id: string, titulo: string, mensagens: object[] }[]} */
    this.threads = [];
    /** @type {string} */
    this.threadAtivaId = "";

    this.chipsEl = raiz.querySelector("#assistente-modos");
    this.textarea = raiz.querySelector("#assistente-mensagem");
    this.btn = raiz.querySelector("#btn-assistente-enviar");
    this.dicaEl = raiz.querySelector("#assistente-dica");
    this.threadsEl = raiz.querySelector("#ia-threads");
    this.journalEl = raiz.querySelector("#ia-journal");
    this.mensagensEl = raiz.querySelector("#ia-mensagens");
    this.confirmCard = raiz.querySelector("#ia-confirm-card");
    this.modoSelect = raiz.querySelector("#ia-modo");

    this._renderChips();
    this._aplicarModo("livre");
    this._aplicarModoSessaoInicial();
    this._novaThread();

    this.btn?.addEventListener("click", () => this.enviar());
    this.textarea?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.enviar();
      }
    });
    this.chipsEl?.addEventListener("click", (e) => {
      const botao = e.target.closest("[data-modo]");
      if (!botao || !this.chipsEl?.contains(botao)) return;
      this._aplicarModo(botao.dataset.modo);
    });
    this.modoSelect?.addEventListener("change", () => {
      const valor = this.modoSelect?.value;
      if (valor === "autorizacao" || valor === "autonomo") {
        this._definirModoOperacao(valor);
      }
    });
    raiz.querySelector("#ia-nova-conversa")?.addEventListener("click", () => {
      this._novaThread();
    });
    this.threadsEl?.addEventListener("click", (e) => {
      const botao = e.target.closest("[data-thread-id]");
      if (!botao || !this.threadsEl?.contains(botao)) return;
      this._abrirThread(botao.getAttribute("data-thread-id") || "");
    });
    this.mensagensEl?.addEventListener("click", (e) => {
      const modoBtn = e.target.closest("[data-modo-operacao]");
      if (modoBtn && this.mensagensEl?.contains(modoBtn)) {
        const valor = modoBtn.getAttribute("data-modo-operacao");
        if (valor === "autorizacao" || valor === "autonomo") {
          this._definirModoOperacao(valor);
        }
        return;
      }
      const botao = e.target.closest("[data-acao-assistente]");
      if (!botao || !this.mensagensEl?.contains(botao)) return;
      const acao = botao.getAttribute("data-acao-assistente");
      if (acao === "copiar") this._copiarResposta();
      if (acao === "word") this._baixarWord();
      if (acao === "campanha") this._salvarCampanha();
    });
    this.journalEl?.addEventListener("click", (e) => {
      const botao = e.target.closest("[data-journal-desfazer]");
      if (!botao || !this.journalEl?.contains(botao)) return;
      this._desfazerJournal(botao.getAttribute("data-journal-desfazer") || "");
    });
    this.confirmCard?.addEventListener("click", (e) => {
      const botao = e.target.closest("[data-ia-confirm]");
      if (!botao || !this.confirmCard?.contains(botao)) return;
      this._responderConfirmacao(botao.getAttribute("data-ia-confirm") === "sim");
    });

    if (window.pdvAPI?.onIaConfirmarAcao) {
      window.pdvAPI.onIaConfirmarAcao((dados) => {
        this._mostrarConfirmacao(dados || {});
      });
    }
    void this._atualizarJournal();
  }

  _aplicarModoSessaoInicial() {
    const salvo = lerModoSessao();
    if (salvo && this.modoSelect) this.modoSelect.value = salvo;
  }

  /**
   * @param {"autorizacao"|"autonomo"} valor
   */
  _definirModoOperacao(valor) {
    gravarModoSessao(valor);
    if (this.modoSelect) this.modoSelect.value = valor;
    for (const thread of this.threads) {
      const bolha = thread.mensagens.find((m) => m.onboarding);
      if (!bolha) continue;
      bolha.onboarding = false;
      bolha.texto =
        valor === "autonomo"
          ? "Modo desta sessão: autônomo. As ações permitidas seguem sem pedir confirmação a cada passo."
          : "Modo desta sessão: com autorização. Vou pedir confirmação antes de alterar a loja.";
    }
    this._renderMensagens();
  }

  /** @returns {"autorizacao"|"autonomo"} */
  _modoOperacao() {
    const valor = this.modoSelect?.value || lerModoSessao();
    return valor === "autonomo" ? "autonomo" : "autorizacao";
  }

  /** @returns {string} */
  _prefixoPrompt() {
    const modo = MODOS.find((m) => m.id === this.modo);
    if (!modo || modo.id === "livre") return "";
    return `[${modo.titulo}] `;
  }

  _novaThread() {
    const mensagens = [];
    if (this.threads.length === 0 && !lerModoSessao()) {
      mensagens.push({
        id: criarId(),
        papel: "assistente",
        onboarding: true,
        texto: TEXTO_ONBOARDING,
      });
    }
    const thread = { id: criarId(), titulo: "Nova conversa", mensagens };
    this.threads.unshift(thread);
    this.threadAtivaId = thread.id;
    this._renderThreads();
    this._renderMensagens();
    this.textarea?.focus();
  }

  /**
   * @param {string} id
   */
  _abrirThread(id) {
    if (!this.threads.some((t) => t.id === id)) return;
    this.threadAtivaId = id;
    this._renderThreads();
    this._renderMensagens();
  }

  /** @returns {{ id: string, titulo: string, mensagens: object[] }|null} */
  _threadAtiva() {
    return this.threads.find((t) => t.id === this.threadAtivaId) || null;
  }

  /** @returns {object|null} */
  _ultimaComAcoes() {
    const lista = this._threadAtiva()?.mensagens || [];
    for (let i = lista.length - 1; i >= 0; i -= 1) {
      if (lista[i].comAcoes && lista[i].texto) return lista[i];
    }
    return null;
  }

  _renderThreads() {
    if (!this.threadsEl) return;
    this.threadsEl.innerHTML = this.threads
      .map(
        (thread) => `
        <button type="button" class="ia-chat-thread ${
          thread.id === this.threadAtivaId ? "ativo" : ""
        }" data-thread-id="${escapeHtml(thread.id)}">
          <span class="ia-chat-thread-titulo">${escapeHtml(thread.titulo)}</span>
        </button>`
      )
      .join("");
  }

  _renderChips() {
    if (!this.chipsEl) return;
    this.chipsEl.innerHTML = MODOS.map(
      (m) => `
      <button type="button" class="assistente-chip ${
        m.id === this.modo ? "ativo" : ""
      }" data-modo="${m.id}">
        ${escapeHtml(m.titulo)}
      </button>`
    ).join("");
  }

  _aplicarModo(modoId) {
    const modo = MODOS.find((m) => m.id === modoId) || MODOS.find((m) => m.id === "livre");
    this.modo = modo.id;
    this.chipsEl?.querySelectorAll("[data-modo]").forEach((el) => {
      el.classList.toggle("ativo", el.dataset.modo === modo.id);
    });
    if (this.dicaEl) this.dicaEl.textContent = modo.dica;
    if (this.textarea) this.textarea.placeholder = modo.placeholder;
  }

  /**
   * Abre um atalho de prompt e opcionalmente preenche a pergunta.
   * @param {string} modoId
   * @param {string} [mensagem]
   */
  prepararPergunta(modoId, mensagem = "") {
    const mapa = {
      caixa: "caixa",
      rh: "rh",
      marketing: "marketing",
      folha: "folha",
    };
    this._aplicarModo(mapa[modoId] || modoId || "livre");
    if (this.textarea && mensagem) {
      this.textarea.value = mensagem;
      this.textarea.focus();
    }
  }

  _renderMensagens() {
    const el = this.mensagensEl;
    if (!el) return;
    const msgs = this._threadAtiva()?.mensagens || [];
    if (!msgs.length) {
      el.innerHTML = `<p class="ia-chat-vazio">Escreva uma mensagem para a CybhorIA.</p>`;
      return;
    }
    el.innerHTML = msgs.map((m) => this._htmlMensagem(m)).join("");
    el.scrollTop = el.scrollHeight;
  }

  /**
   * @param {object} mensagem
   * @returns {string}
   */
  _htmlMensagem(mensagem) {
    if (mensagem.papel === "usuario") {
      return `<div class="ia-chat-bolha ia-chat-bolha-usuario">${escapeHtml(
        mensagem.texto
      )}</div>`;
    }
    if (mensagem.onboarding) {
      return `<div class="ia-chat-bolha ia-chat-bolha-assistente">
        <p class="ia-chat-texto">${escapeHtml(mensagem.texto)}</p>
        <div class="ia-chat-onboarding-acoes">
          <button type="button" class="btn btn-primario btn-sm" data-modo-operacao="autorizacao">Com autorização</button>
          <button type="button" class="btn btn-secundario btn-sm" data-modo-operacao="autonomo">Autônomo</button>
        </div>
      </div>`;
    }
    if (mensagem.pendente) {
      return `<div class="ia-chat-bolha ia-chat-bolha-assistente"><p class="assistente-status">${escapeHtml(
        mensagem.texto
      )}</p></div>`;
    }
    if (mensagem.erro) {
      return `<div class="ia-chat-bolha ia-chat-bolha-assistente"><p class="mensagem-erro">${escapeHtml(
        textoVisivel(mensagem.texto) || "Falha na IA."
      )}</p></div>`;
    }
    const acoes = mensagem.comAcoes ? this._htmlAcoes(mensagem.modoCriativo) : "";
    return `<div class="ia-chat-bolha ia-chat-bolha-assistente">
      ${acoes}
      <div class="assistente-markdown">${formatarTextoIa(mensagem.texto)}</div>
    </div>`;
  }

  /**
   * @param {string} modoCriativo
   * @returns {string}
   */
  _htmlAcoes(modoCriativo) {
    const campanhaBtn = MODOS_CAMPANHA.has(modoCriativo)
      ? `<button type="button" class="btn btn-primario btn-sm" data-acao-assistente="campanha">Salvar campanha</button>`
      : "";
    return `<div class="assistente-acoes">
      ${campanhaBtn}
      <button type="button" class="btn btn-secundario btn-sm" data-acao-assistente="copiar">Copiar</button>
      <button type="button" class="btn btn-secundario btn-sm" data-acao-assistente="word">Baixar Word</button>
    </div>`;
  }

  /**
   * @returns {Promise<void>}
   */
  async enviar() {
    if (this.carregando) return;
    const mensagem = (this.textarea?.value || "").trim();
    if (mensagem.length < 3) {
      notificar("Escreva uma pergunta um pouco mais completa.", "alerta");
      return;
    }
    if (!window.pdvAPI?.consultarAssistente) {
      notificar("Assistente indisponível nesta instalação.", "erro");
      return;
    }
    const thread = this._threadAtiva();
    if (!thread) return;

    this.carregando = true;
    if (this.btn) {
      this.btn.disabled = true;
      this.btn.textContent = "Pensando…";
    }

    thread.mensagens.forEach((item) => {
      item.comAcoes = false;
    });
    thread.mensagens.push({ id: criarId(), papel: "usuario", texto: mensagem });
    if (thread.titulo === "Nova conversa") {
      thread.titulo = mensagem.length > 42 ? `${mensagem.slice(0, 42)}…` : mensagem;
    }
    const pendenteId = criarId();
    thread.mensagens.push({
      id: pendenteId,
      papel: "assistente",
      texto: "Consultando a IA…",
      pendente: true,
    });
    if (this.textarea) this.textarea.value = "";
    this._renderThreads();
    this._renderMensagens();

    const modoCriativo = this.modo;
    try {
      const contexto = this.obterContexto() || {};
      const resultado = await window.pdvAPI.consultarAssistente({
        modo: modoCriativo,
        mensagem: `${this._prefixoPrompt()}${mensagem}`,
        contexto,
        modoOperacao: this._modoOperacao(),
        agente: true,
      });
      if (!resultado?.ok) {
        throw new Error(resultado?.mensagem || "Falha no assistente.");
      }
      const texto = String(resultado.texto || "");
      const alvo = thread.mensagens.find((item) => item.id === pendenteId);
      if (alvo) {
        alvo.pendente = false;
        alvo.texto = texto || "Sem resposta da IA.";
        alvo.comAcoes = Boolean(texto);
        alvo.modoCriativo = modoCriativo;
      }
    } catch (erro) {
      const visivel = textoVisivel(erro?.message) || "Falha na IA.";
      const alvo = thread.mensagens.find((item) => item.id === pendenteId);
      if (alvo) {
        alvo.pendente = false;
        alvo.erro = true;
        alvo.texto = visivel;
      }
      notificar(visivel, "erro");
    } finally {
      this.carregando = false;
      if (this.btn) {
        this.btn.disabled = false;
        this.btn.textContent = "Enviar";
      }
      this._renderMensagens();
      void this._atualizarJournal();
    }
  }

  /**
   * @param {object} dados
   */
  async _mostrarConfirmacao(dados) {
    const token = String(dados?.token || "");
    if (!token || !this.confirmCard) return;
    if (this.confirmToken && this.confirmToken !== token && window.pdvAPI?.iaConfirmarAcaoResposta) {
      const anterior = this.confirmToken;
      this.confirmToken = "";
      try {
        await window.pdvAPI.iaConfirmarAcaoResposta(anterior, false);
      } catch {
        /* a confirmação anterior expira no processo principal */
      }
    }
    this.confirmToken = token;
    const resumo =
      textoVisivel(dados?.resumo) || "A IA quer executar uma ação na loja.";
    this.confirmCard.classList.remove("oculto");
    this.confirmCard.innerHTML = `
      <p>Confirme esta ação antes de continuar.</p>
      <p>${escapeHtml(resumo)}</p>
      <div class="ia-chat-confirm-acoes">
        <button type="button" class="btn btn-primario btn-sm" data-ia-confirm="sim">Confirmar</button>
        <button type="button" class="btn btn-secundario btn-sm" data-ia-confirm="nao">Cancelar</button>
      </div>`;
  }

  /**
   * @param {boolean} aceitar
   */
  async _responderConfirmacao(aceitar) {
    const token = this.confirmToken;
    if (!token) return;
    this.confirmToken = "";
    this.confirmCard?.classList.add("oculto");
    if (this.confirmCard) this.confirmCard.innerHTML = "";
    if (!window.pdvAPI?.iaConfirmarAcaoResposta) return;
    try {
      const res = await window.pdvAPI.iaConfirmarAcaoResposta(token, aceitar);
      if (!res?.ok) {
        notificar(textoVisivel(res?.mensagem) || "Não foi possível confirmar.", "erro");
      }
    } catch (erro) {
      notificar(textoVisivel(erro?.message) || "Não foi possível confirmar.", "erro");
    }
  }

  async _atualizarJournal() {
    if (!this.journalEl) return;
    if (!window.pdvAPI?.iaListarJournal) {
      this._pintarJournal([]);
      return;
    }
    try {
      const res = await window.pdvAPI.iaListarJournal(30);
      this._pintarJournal(Array.isArray(res?.itens) ? res.itens : []);
    } catch {
      this._pintarJournal([]);
    }
  }

  /**
   * @param {object[]} itens
   */
  _pintarJournal(itens) {
    if (!this.journalEl) return;
    if (!itens.length) {
      this.journalEl.innerHTML = `<p class="ia-chat-vazio">Nenhuma ação registrada.</p>`;
      return;
    }
    this.journalEl.innerHTML = itens
      .map((item) => {
        const resumo = textoVisivel(item?.resumo) || "Ação registrada";
        const quando = formatarQuando(item?.ts);
        const meta = [quando, item?.desfeito ? "Desfeito" : ""].filter(Boolean).join(" · ");
        const desfazer =
          item?.id && item?.reversivel && !item?.desfeito
            ? `<button type="button" class="btn btn-secundario btn-sm" data-journal-desfazer="${escapeHtml(
                String(item.id)
              )}">Desfazer</button>`
            : "";
        return `<article class="ia-chat-journal-item">
          <p class="ia-chat-journal-resumo">${escapeHtml(resumo)}</p>
          ${meta ? `<p class="ia-chat-journal-meta">${escapeHtml(meta)}</p>` : ""}
          ${desfazer}
        </article>`;
      })
      .join("");
  }

  /**
   * @param {string} id
   */
  async _desfazerJournal(id) {
    if (!id || !window.pdvAPI?.iaDesfazer) return;
    try {
      const res = await window.pdvAPI.iaDesfazer(id);
      if (!res?.ok) {
        notificar(textoVisivel(res?.mensagem) || "Não foi possível desfazer.", "erro");
        return;
      }
      notificar("Registro marcado como desfeito.", "sucesso");
      await this._atualizarJournal();
    } catch (erro) {
      notificar(textoVisivel(erro?.message) || "Não foi possível desfazer.", "erro");
    }
  }

  _salvarCampanha() {
    const ultima = this._ultimaComAcoes();
    const texto = ultima?.texto || "";
    if (!texto) {
      notificar("Nenhuma resposta para salvar.", "alerta");
      return;
    }
    const modo = ultima?.modoCriativo || this.modo;
    try {
      const lojaId = obterLojaId();
      const titulo =
        modo === "concorrencia"
          ? "Concorrência"
          : MODOS.find((m) => m.id === modo)?.titulo || "Campanha";
      salvarCampanha(lojaId, { titulo, texto, modo });
      notificar("Campanha salva em Números → Dicas do dia.", "sucesso");
      window.dispatchEvent(new CustomEvent("cybhor-campanha-salva"));
    } catch (erro) {
      notificar(erro.message || "Falha ao salvar campanha.", "erro");
    }
  }

  /** @returns {string} */
  _obterNomeLoja() {
    const ctx = this.obterContexto?.() || {};
    const nome = String(ctx.nomeLoja || "").trim();
    return nome || "CybhorIA";
  }

  async _copiarResposta() {
    const texto = this._ultimaComAcoes()?.texto || "";
    if (!texto) {
      notificar("Nenhuma resposta para copiar.", "alerta");
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
      } else {
        const area = document.createElement("textarea");
        area.value = texto;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      notificar("Resposta copiada.", "sucesso");
    } catch {
      notificar("Não foi possível copiar a resposta.", "erro");
    }
  }

  _baixarWord() {
    const texto = this._ultimaComAcoes()?.texto || "";
    if (!texto) {
      notificar("Nenhuma resposta para baixar.", "alerta");
      return;
    }

    const nomeLoja = this._obterNomeLoja();
    const titulo = nomeLoja === "CybhorIA" ? "CybhorIA" : `${nomeLoja} — CybhorIA`;
    const corpoHtml = textoParaHtmlWord(texto);
    const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(titulo)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 12pt; line-height: 1.5; color: #111; }
  h1 { font-size: 16pt; margin: 0 0 16pt; }
  h3 { font-size: 13pt; margin: 14pt 0 6pt; }
  h4 { font-size: 12pt; margin: 12pt 0 4pt; }
  p { margin: 0 0 10pt; }
  ul { margin: 0 0 10pt; padding-left: 24pt; }
  li { margin: 0 0 4pt; }
</style>
</head>
<body>
  <h1>${escapeHtml(titulo)}</h1>
  ${corpoHtml}
</body>
</html>`;

    const blob = new Blob(["\ufeff", html], {
      type: "application/msword",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const base =
      nomeLoja === "CybhorIA"
        ? "CybhorIA"
        : `${sanitizarNomeArquivo(nomeLoja)}-CybhorIA`;
    link.href = url;
    link.download = `${base}.doc`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notificar("Documento Word baixado.", "sucesso");
  }
}

/**
 * Remove caracteres inválidos em nomes de arquivo no Windows.
 * @param {string} nome
 * @returns {string}
 */
function sanitizarNomeArquivo(nome) {
  const limpo = String(nome || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return limpo || "CybhorIA";
}

/**
 * Corpo HTML do .doc a partir do texto puro (com markdown leve).
 * @param {string} texto
 * @returns {string}
 */
function textoParaHtmlWord(texto) {
  return formatarTextoIa(texto);
}

/**
 * Formatação leve de markdown (negrito, listas, quebras).
 * Processa linha a linha para não aninhar blocos dentro de &lt;p&gt;
 * (o que fazia o navegador “consertar” o DOM e cortar/ocultar trechos).
 * @param {string} texto
 * @returns {string}
 */
function formatarTextoIa(texto) {
  const linhas = String(texto || "").replace(/\r\n/g, "\n").split("\n");
  const partes = [];
  /** @type {string[]} */
  let lista = [];
  /** @type {string[]} */
  let paragrafo = [];

  const flushLista = () => {
    if (!lista.length) return;
    partes.push(`<ul>${lista.join("")}</ul>`);
    lista = [];
  };

  const flushParagrafo = () => {
    if (!paragrafo.length) return;
    const html = paragrafo
      .map((l) => formatarInline(escapeHtml(l)))
      .join("<br>");
    partes.push(`<p>${html}</p>`);
    paragrafo = [];
  };

  for (const linhaBruta of linhas) {
    const linha = linhaBruta.trimEnd();
    const itemLista = linha.match(/^\s*[-*]\s+(.+)$/);
    const h3 = linha.match(/^\s*###\s+(.+)$/);
    const h2 = linha.match(/^\s*##\s+(.+)$/);
    const h1 = linha.match(/^\s*#\s+(.+)$/);

    if (itemLista) {
      flushParagrafo();
      lista.push(`<li>${formatarInline(escapeHtml(itemLista[1]))}</li>`);
      continue;
    }

    flushLista();

    if (h3) {
      flushParagrafo();
      partes.push(`<h4>${formatarInline(escapeHtml(h3[1]))}</h4>`);
      continue;
    }
    if (h2 || h1) {
      flushParagrafo();
      const titulo = (h2 || h1)[1];
      partes.push(`<h3>${formatarInline(escapeHtml(titulo))}</h3>`);
      continue;
    }

    if (linha.trim() === "") {
      flushParagrafo();
      continue;
    }

    paragrafo.push(linha);
  }

  flushLista();
  flushParagrafo();
  return partes.join("") || "<p></p>";
}

/**
 * @param {string} seguroHtml já escapado
 * @returns {string}
 */
function formatarInline(seguroHtml) {
  return seguroHtml.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
