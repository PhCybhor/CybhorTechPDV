/**
 * Log do servidor em uma linha JSON por evento (fácil de filtrar no painel da hospedagem).
 * Único ponto do código que escreve no console.
 */
function registrar(nivel, mensagem, extras = {}) {
  const linha = JSON.stringify({ nivel, mensagem, momento: new Date().toISOString(), ...extras });
  if (nivel === "erro") {
    console.error(linha);
  } else if (nivel === "aviso") {
    console.warn(linha);
  } else {
    console.info(linha);
  }
}

function detalharErro(erro) {
  if (erro === null || erro === undefined) return {};
  if (!(erro instanceof Error)) return { erro: String(erro) };
  return { erro: erro.message, pilha: erro.stack };
}

export const logger = {
  info: (mensagem, extras) => registrar("info", mensagem, extras),
  aviso: (mensagem, extras) => registrar("aviso", mensagem, extras),
  erro: (mensagem, erro, extras = {}) => registrar("erro", mensagem, { ...extras, ...detalharErro(erro) }),
};
