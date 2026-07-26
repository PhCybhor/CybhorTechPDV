/**
 * Áreas de atuação da equipe (multi-seleção).
 * Uma pessoa pode atuar em Caixa + RH + Marketing ao mesmo tempo.
 */

export const AREAS_EQUIPE = Object.freeze([
  {
    id: "caixa",
    rotulo: "Caixa",
    descricao: "PDV, troco, atendimento e fechamento",
  },
  {
    id: "rh",
    rotulo: "RH",
    descricao: "Admissão, folha, CLT/PJ e clima da equipe",
  },
  {
    id: "marketing",
    rotulo: "Marketing",
    descricao: "Criativos, promoções, redes e vitrine",
  },
]);

const IDS_VALIDOS = new Set(AREAS_EQUIPE.map((a) => a.id));

/**
 * Normaliza lista de áreas (únicas, só IDs válidos).
 * @param {unknown} valor
 * @returns {string[]}
 */
export function normalizarAreas(valor) {
  const bruto = Array.isArray(valor)
    ? valor
    : typeof valor === "string"
      ? valor.split(/[,;|]/)
      : [];
  const limpos = [
    ...new Set(
      bruto
        .map((a) => String(a || "").trim().toLowerCase())
        .filter((a) => IDS_VALIDOS.has(a))
    ),
  ];
  return limpos;
}

/**
 * @param {string} id
 * @returns {string}
 */
export function rotuloArea(id) {
  return AREAS_EQUIPE.find((a) => a.id === id)?.rotulo || id;
}

/**
 * @param {Array<string>|undefined} areas
 * @returns {string}
 */
export function formatarAreas(areas) {
  const lista = normalizarAreas(areas);
  if (lista.length === 0) return "Sem área";
  return lista.map(rotuloArea).join(" · ");
}

/**
 * Guias práticos por área (RH, Marketing, Caixa).
 */
export const GUIAS_POR_AREA = Object.freeze({
  caixa: {
    titulo: "Auxiliar de Caixa",
    resumo: "Venda rápida, troco certo e bom atendimento no PDV.",
    checklist: [
      "Conferir troco na tela antes de entregar",
      "Usar F2 busca, F5–F8 pagamento e F12 finalizar",
      "Favoritar produtos do dia a dia (★)",
      "Avisar admin se estoque zerar",
      "Não compartilhar senha do login",
      "Fechar o caixa com o admin no fim do turno",
    ],
    dicas: [
      "Digite água*3 na busca para adicionar quantidade.",
      "F9 repete o último item — ótimo com leitor.",
      "No dinheiro, use Exato / +10 / +50 para o troco.",
      "Se o cliente hesitar, sugira o mais vendido da semana.",
    ],
    promptsIa: [
      "Monte um script curto de atendimento no caixa para upsell sem ser invasivo.",
      "Quais atalhos do PDV priorizar no treinamento de um caixa novo?",
    ],
  },
  rh: {
    titulo: "Auxiliar de RH",
    resumo: "Contratação, vínculo CLT/PJ, rotina e clima da equipe.",
    checklist: [
      "Definir áreas de atuação (pode ser mais de uma)",
      "Escolher vínculo CLT, PJ ou MEI com checklist legal",
      "Registrar salário/contrato no auxiliar de pagamento",
      "Entregar acesso (usuário/senha) sem reutilizar senhas",
      "Combinar escala, folgas e responsável do turno",
      "Revisar encargos no simulador antes de fechar proposta",
    ],
    dicas: [
      "PJ com horário fixo e chefia pode virar vínculo CLT — use o checklist.",
      "Salve o vínculo no cadastro para não perder a memória da loja.",
      "Lance a folha como despesa do mês para ver o lucro líquido real.",
      "Uma pessoa pode ser Caixa + Marketing: marque as duas áreas.",
    ],
    promptsIa: [
      "Monte um roteiro de entrevista para caixa de mercearia.",
      "Quais documentos pedir na admissão CLT de um operador?",
    ],
  },
  marketing: {
    titulo: "Auxiliar de Marketing",
    resumo: "Promoções, criativos, vitrine e atração de clientes.",
    checklist: [
      "Definir oferta da semana (preço + margem mínima)",
      "Criar 3 textos curtos (WhatsApp, Instagram, vitrine)",
      "Alinhar estoque antes de anunciar promoção",
      "Combinar combo com o caixa (script de oferta)",
      "Registrar custo de anúncio em Despesas (marketing)",
      "Medir o que vendeu mais após a campanha",
    ],
    dicas: [
      "Use o CybhorIA no modo Criativos / Promoções / Copy thief.",
      "Promoção sem estoque gera fila e reclamação — confira antes.",
      "Anúncio local (bairro) costuma converter mais que alcance amplo.",
      "Peça ao caixa os 5 mais vendidos antes de montar o combo.",
    ],
    promptsIa: [
      "Crie 3 posts de promoção para o fim de semana da minha loja.",
      "Sugira um combo com boa margem usando bebidas e snacks.",
    ],
  },
});

/**
 * HTML de checkboxes multi-área.
 * @param {string} nameAttr
 * @param {string[]} [selecionadas=[]]
 * @returns {string}
 */
export function htmlCheckboxesAreas(nameAttr, selecionadas = []) {
  const set = new Set(normalizarAreas(selecionadas));
  return AREAS_EQUIPE.map(
    (area) => `
    <label class="area-chip ${set.has(area.id) ? "ativo" : ""}">
      <input
        type="checkbox"
        name="${nameAttr}"
        value="${area.id}"
        ${set.has(area.id) ? "checked" : ""}
      />
      <span class="area-chip-titulo">${area.rotulo}</span>
      <span class="area-chip-desc">${area.descricao}</span>
    </label>`
  ).join("");
}

/**
 * Lê checkboxes de áreas dentro de um container.
 * @param {ParentNode} raiz
 * @param {string} nameAttr
 * @returns {string[]}
 */
export function lerAreasDoForm(raiz, nameAttr) {
  if (!raiz) return [];
  const checks = raiz.querySelectorAll(
    `input[type="checkbox"][name="${nameAttr}"]:checked`
  );
  return normalizarAreas([...checks].map((el) => el.value));
}
