/**
 * Escala de turnos e checklist abertura/fechamento (local por loja).
 */

const PREFIXO = "cybhor_turnos_";

function chave(lojaId) {
  return `${PREFIXO}${lojaId || "local"}`;
}

export function lerTurnos(lojaId) {
  try {
    const bruto = localStorage.getItem(chave(lojaId));
    if (!bruto) {
      return {
        escala: [],
        checklistAbertura: [
          { id: "fundo", texto: "Contar fundo / abrir caixa", ok: false },
          { id: "impressora", texto: "Testar impressora", ok: false },
          { id: "estoque", texto: "Conferir itens críticos", ok: false },
        ],
        checklistFechamento: [
          { id: "sangria", texto: "Registrar sangrias do dia", ok: false },
          { id: "gaveta", texto: "Conferir gaveta (contado × esperado)", ok: false },
          { id: "fechamento", texto: "Registrar fechamento no sistema", ok: false },
        ],
      };
    }
    return JSON.parse(bruto);
  } catch {
    return { escala: [], checklistAbertura: [], checklistFechamento: [] };
  }
}

export function salvarTurnos(lojaId, dados) {
  localStorage.setItem(chave(lojaId), JSON.stringify(dados));
}

export function adicionarEscala(lojaId, { funcionarioNome, turno, dia }) {
  const dados = lerTurnos(lojaId);
  dados.escala = dados.escala || [];
  dados.escala.unshift({
    id: `t_${Date.now().toString(36)}`,
    funcionarioNome,
    turno: turno || "manha",
    dia: dia || new Date().toISOString().slice(0, 10),
  });
  dados.escala = dados.escala.slice(0, 60);
  salvarTurnos(lojaId, dados);
  return dados;
}
