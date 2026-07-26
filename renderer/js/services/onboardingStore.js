const CHAVE = "cybhor_onboarding_v1";

const PASSOS = [
  { id: "produto", titulo: "Cadastre o 1º produto", rota: "produtos" },
  { id: "fundo", titulo: "Defina o fundo do caixa", rota: "relatorios", aba: "caixa" },
  { id: "venda", titulo: "Faça uma venda de teste", rota: "pdv" },
  { id: "fornecedor", titulo: "Cadastre um fornecedor", rota: "fornecedores" },
  { id: "ia", titulo: "Pergunte algo à CybhorIA", rota: "assistente" },
];

export function obterPassosOnboarding() {
  return PASSOS;
}

export function lerOnboarding() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return { feito: false, concluidos: [] };
    const d = JSON.parse(bruto);
    return {
      feito: Boolean(d.feito),
      concluidos: Array.isArray(d.concluidos) ? d.concluidos : [],
    };
  } catch {
    return { feito: false, concluidos: [] };
  }
}

export function marcarPassoOnboarding(id) {
  const atual = lerOnboarding();
  const set = new Set(atual.concluidos);
  set.add(id);
  const concluidos = Array.from(set);
  const feito = PASSOS.every((p) => concluidos.includes(p.id));
  localStorage.setItem(CHAVE, JSON.stringify({ feito, concluidos }));
  return { feito, concluidos };
}

export function pularOnboarding() {
  localStorage.setItem(
    CHAVE,
    JSON.stringify({ feito: true, concluidos: PASSOS.map((p) => p.id) })
  );
}

export function resetarOnboarding() {
  localStorage.removeItem(CHAVE);
}
