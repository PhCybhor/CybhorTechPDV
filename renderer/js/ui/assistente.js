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

/**
 * Assistente CybhorIA (Gemini via IPC).
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
    this.modo = "criativos";
    this.carregando = false;
    /** @type {string} */
    this.ultimaRespostaTexto = "";

    this.chipsEl = raiz.querySelector("#assistente-modos");
    this.textarea = raiz.querySelector("#assistente-mensagem");
    this.btn = raiz.querySelector("#btn-assistente-enviar");
    this.respostaEl = raiz.querySelector("#assistente-resposta");
    this.dicaEl = raiz.querySelector("#assistente-dica");

    this._renderChips();
    this._aplicarModo("criativos");

    this.btn?.addEventListener("click", () => this.enviar());
    this.textarea?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.enviar();
      }
    });

    this.respostaEl?.addEventListener("click", (e) => {
      const botao = e.target.closest("[data-acao-assistente]");
      if (!botao || !this.respostaEl?.contains(botao)) return;
      const acao = botao.getAttribute("data-acao-assistente");
      if (acao === "copiar") this._copiarResposta();
      if (acao === "word") this._baixarWord();
      if (acao === "campanha") this._salvarCampanha();
    });
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

    this.chipsEl.addEventListener("click", (e) => {
      const botao = e.target.closest("[data-modo]");
      if (!botao) return;
      this._aplicarModo(botao.dataset.modo);
    });
  }

  _aplicarModo(modoId) {
    const modo = MODOS.find((m) => m.id === modoId) || MODOS[0];
    this.modo = modo.id;
    this.chipsEl?.querySelectorAll("[data-modo]").forEach((el) => {
      el.classList.toggle("ativo", el.dataset.modo === modo.id);
    });
    if (this.dicaEl) this.dicaEl.textContent = modo.dica;
    if (this.textarea) this.textarea.placeholder = modo.placeholder;
  }

  /**
   * Abre um modo e opcionalmente preenche a pergunta.
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

    this.carregando = true;
    this.ultimaRespostaTexto = "";
    if (this.btn) {
      this.btn.disabled = true;
      this.btn.textContent = "Pensando…";
    }
    if (this.respostaEl) {
      this.respostaEl.innerHTML =
        '<p class="assistente-status">Consultando a IA…</p>';
    }

    try {
      const contexto = this.obterContexto() || {};
      const resultado = await window.pdvAPI.consultarAssistente({
        modo: this.modo,
        mensagem,
        contexto,
      });

      if (!resultado?.ok) {
        throw new Error(resultado?.mensagem || "Falha no assistente.");
      }

      this._exibirResposta(resultado.texto || "");
    } catch (erro) {
      this.ultimaRespostaTexto = "";
      if (this.respostaEl) {
        this.respostaEl.innerHTML = `<p class="mensagem-erro" style="display:block">${escapeHtml(
          erro.message || "Erro"
        )}</p>`;
      }
      notificar(erro.message || "Falha na IA.", "erro");
    } finally {
      this.carregando = false;
      if (this.btn) {
        this.btn.disabled = false;
        this.btn.textContent = "Perguntar à IA";
      }
    }
  }

  /**
   * @param {string} texto
   */
  _exibirResposta(texto) {
    this.ultimaRespostaTexto = String(texto || "");
    if (!this.respostaEl) return;

    const campanhaBtn =
      this.modo === "concorrencia" ||
      this.modo === "promocoes" ||
      this.modo === "criativos" ||
      this.modo === "marketing"
        ? `<button type="button" class="btn btn-primario btn-sm" data-acao-assistente="campanha">
            Salvar campanha
          </button>`
        : "";

    this.respostaEl.innerHTML = `
      <div class="assistente-resposta-cabecalho">
        <div class="assistente-acoes">
          ${campanhaBtn}
          <button type="button" class="btn btn-secundario btn-sm" data-acao-assistente="copiar">
            Copiar
          </button>
          <button type="button" class="btn btn-secundario btn-sm" data-acao-assistente="word">
            Baixar Word
          </button>
        </div>
      </div>
      <div class="assistente-markdown">${formatarTextoIa(
        this.ultimaRespostaTexto
      )}</div>`;
  }

  _salvarCampanha() {
    const texto = this.ultimaRespostaTexto;
    if (!texto) {
      notificar("Nenhuma resposta para salvar.", "alerta");
      return;
    }
    try {
      const lojaId = obterLojaId();
      const titulo =
        this.modo === "concorrencia"
          ? "Concorrência"
          : MODOS.find((m) => m.id === this.modo)?.titulo || "Campanha";
      salvarCampanha(lojaId, { titulo, texto, modo: this.modo });
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
    const texto = this.ultimaRespostaTexto;
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
    const texto = this.ultimaRespostaTexto;
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
