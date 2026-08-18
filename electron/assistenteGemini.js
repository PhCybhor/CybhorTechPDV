"use strict";

const { requisitarJson } = require("./httpJson");

/**
 * Cliente Gemini (Google AI Studio) no processo principal — a chave nunca vai ao renderer.
 */

const MODES_SYSTEM = {
  criativos: `Você é um copywriter de varejo brasileiro. Crie textos curtos e persuasivos para Instagram, WhatsApp Status e anúncios locais. Use português do Brasil, tom próximo e concreto. Entregue 3 opções numeradas com: gancho, corpo e CTA.`,
  organizacao: `Você é especialista em merchandising e layout de loja física (gôndolas, checkout, fluxo). Sugira organização prática por categoria, giro e impulso. Liste passos acionáveis e o "porquê" de cada um.`,
  pesquisa_area: `Você é consultor de inteligência de mercado para pequenos varejos no Brasil. Ajude a pesquisar o bairro/região: perfil de cliente, concorrentes, horários, ticket médio, sazonalidade. Faça perguntas quando faltar dado e dê hipóteses + plano de validação.`,
  precificacao: `Você é consultor de precificação no varejo. Use custo, margem, concorrência e percepção de valor. Sugira faixas de preço, markup e alertas de margem baixa. Seja objetivo com números em R$.`,
  compras: `Você analisa giro de estoque e sugere o que comprar, o que pausar e o que liquidar. Priorize produtos de alto giro e margem. Evite excesso de estoque parado.`,
  promocoes: `Você cria combos, promoções e ofertas do dia/semana para PDV. Inclua regra simples (ex: leve 3 pague 2), margem mínima e texto de vitrine.`,
  concorrencia: `Você faz "copy thief" ético: analisa o que lojas concorrentes fazem bem (preço, vitrine, atendimento, criativos, mix) e adapta ideias originais para a loja do usuário — sem copiar marca/texto literal. Entregue: o que observar, o que adaptar, o que evitar.`,
  folha: `Você é consultor trabalhista/tributário para pequenos varejos no Brasil (2026). Explique diferenças CLT vs PJ/MEI, encargos (INSS, IRRF, FGTS, 13º, férias), riscos de pejotização e boas práticas. Deixe claro que não substitui contador/advogado. Use português do Brasil e tópicos objetivos.`,
  caixa: `Você é treinador de operadores de caixa de varejo no Brasil. Foque em atendimento, troco, upsell ético, atalhos de PDV e prevenção de erros. Respostas práticas e curtas.`,
  rh: `Você é consultor de RH para pequenos varejos. Ajude com admissão, escala, clima, feedback e vínculos CLT/PJ. Deixe claro que não substitui advogado/contador.`,
  marketing: `Você é especialista em marketing local para mercearias e PDV. Crie campanhas, vitrine, WhatsApp e Instagram com margem e estoque em mente.`,
  nomes_produtos: `Você é especialista em cadastro de produtos de varejo no Brasil. Receberá uma lista de produtos com id e nomeAtual. Sugira nomes limpos, claros e padronizados para o PDV (sem gíria confusa, sem abreviações obscuras, com marca só se ajudar). Responda APENAS com um JSON array válido, sem markdown, no formato: [{"id":"...","nomeAtual":"...","nomeSugerido":"...","motivo":"..."}]. Inclua só itens que realmente precisam de correção. Se nada precisar, retorne [].`,
  cardapio_semana: `Você monta um "cardápio da semana" para o varejo: 7 posts (um por dia) com gancho, legenda curta, sugestão de preço/oferta e CTA. Português do Brasil, tom de bairro.`,
  crise: `O dia de vendas está fraco. Entregue exatamente 10 ações práticas e ordenadas por impacto×esforço para as próximas 2–4 horas (balcão, WhatsApp, vitrine, preço). Sem enrolação.`,
  placa_oferta: `Gere texto pronto para placa de oferta (impressão A4 ou Canva): título curto, preço grande em palavras, 2 bullets de benefício e rodapé legal simples. Formato claro para copiar.`,
  treino_caixa: `Crie um quiz de 5 perguntas (múltipla escolha) para treinar operador de caixa: troco, fiado, desconto, upsell e atendimento. Inclua gabarito no final.`,
  livre: `Você é o assistente CybhorIA do lojista: lucros, estoque, vendas, criativos, organização e mercado local. Respostas práticas, em português do Brasil, em tópicos curtos.`,
};

/**
 * @param {{ modo?: string, mensagem?: string, contexto?: object }} payload
 * @returns {Promise<{ ok: boolean, texto?: string, mensagem?: string }>}
 */
async function consultarAssistente(payload = {}) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    return {
      ok: false,
      mensagem:
        "Configure GEMINI_API_KEY no arquivo .env (chave do Google AI Studio).",
    };
  }

  const modo = String(payload.modo || "livre").trim();
  const mensagem = String(payload.mensagem || "").trim();
  if (mensagem.length < 3) {
    return { ok: false, mensagem: "Escreva uma pergunta com pelo menos 3 caracteres." };
  }
  const limiteMsg = modo === "nomes_produtos" ? 12000 : 4000;
  if (mensagem.length > limiteMsg) {
    return { ok: false, mensagem: `Mensagem muito longa (máx. ${limiteMsg} caracteres).` };
  }

  const system =
    MODES_SYSTEM[modo] || MODES_SYSTEM.livre;
  const contexto = payload.contexto && typeof payload.contexto === "object"
    ? payload.contexto
    : {};

  const blocoContexto = [
    contexto.nomeLoja ? `Loja: ${contexto.nomeLoja}` : null,
    contexto.endereco ? `Endereço/região: ${contexto.endereco}` : null,
    Number.isFinite(contexto.receitaMes)
      ? `Receita do mês: R$ ${Number(contexto.receitaMes).toFixed(2)}`
      : null,
    Number.isFinite(contexto.lucroBrutoMes)
      ? `Lucro bruto (mês): R$ ${Number(contexto.lucroBrutoMes).toFixed(2)}`
      : null,
    Number.isFinite(contexto.despesasMes)
      ? `Despesas do mês: R$ ${Number(contexto.despesasMes).toFixed(2)}`
      : null,
    Number.isFinite(contexto.lucroLiquidoMes)
      ? `Lucro líquido (mês): R$ ${Number(contexto.lucroLiquidoMes).toFixed(2)}`
      : null,
    Array.isArray(contexto.maisVendidos) && contexto.maisVendidos.length
      ? `Mais vendidos: ${contexto.maisVendidos
          .slice(0, 8)
          .map((p) => `${p.nome} (${p.quantidade})`)
          .join("; ")}`
      : null,
    Array.isArray(contexto.estoqueBaixo) && contexto.estoqueBaixo.length
      ? `Estoque baixo: ${contexto.estoqueBaixo
          .slice(0, 8)
          .map((p) => `${p.nome} (${p.estoque})`)
          .join("; ")}`
      : null,
    Array.isArray(contexto.categorias) && contexto.categorias.length
      ? `Categorias: ${contexto.categorias.slice(0, 20).join(", ")}`
      : null,
    Number.isFinite(contexto.produtosSemCusto)
      ? `Produtos sem custo cadastrado: ${contexto.produtosSemCusto}`
      : null,
    contexto.equipePorArea
      ? `Equipe por área — Caixa: ${contexto.equipePorArea.caixa || 0}, RH: ${
          contexto.equipePorArea.rh || 0
        }, Marketing: ${contexto.equipePorArea.marketing || 0}`
      : null,
    Array.isArray(contexto.fornecedores) && contexto.fornecedores.length
      ? `Fornecedores: ${contexto.fornecedores
          .map((f) => {
            const tipos = f.tiposMercadoria || f.nicho || "";
            return `${f.nome} [${tipos}]${f.contato ? ` (${f.contato})` : ""}`;
          })
          .join("; ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = [
    system,
    blocoContexto ? `\nContexto da loja (use se relevante):\n${blocoContexto}` : "",
    `\nPedido do lojista:\n${mensagem}`,
  ].join("\n");

  const modelo =
    String(process.env.GEMINI_MODEL || "gemini-2.5-flash").trim() ||
    "gemini-2.5-flash";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelo
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const resposta = await requisitarJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: modo === "nomes_produtos" ? 0.3 : 0.7,
          maxOutputTokens: modo === "nomes_produtos" ? 4096 : 2048,
        },
      }),
    });

    const corpo = resposta.dados || {};
    if (!resposta.ok) {
      const detalhe =
        corpo?.error?.message ||
        `Falha na API Gemini (HTTP ${resposta.status}).`;
      return { ok: false, mensagem: detalhe };
    }

    const partes =
      corpo?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean) ||
      [];
    const texto = partes.join("\n").trim();
    if (!texto) {
      return {
        ok: false,
        mensagem: "A IA não retornou texto. Tente reformular a pergunta.",
      };
    }

    return { ok: true, texto };
  } catch (erro) {
    return {
      ok: false,
      mensagem: erro?.message || "Não foi possível falar com a IA.",
    };
  }
}

module.exports = { consultarAssistente, MODES_SYSTEM };
