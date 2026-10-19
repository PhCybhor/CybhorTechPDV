function registrar(nivel, escrever, mensagem, detalhe) {
  const linha = `${new Date().toISOString()} ${nivel} cybhorpdv ${mensagem}`;
  if (detalhe === undefined) {
    escrever(linha);
  } else {
    escrever(linha, detalhe);
  }
}

/** Log mínimo em stdout/stderr (capturado pelo Docker). Nunca passe PII ou segredos. */
export const logger = {
  info: (mensagem) => registrar('INFO', console.info, mensagem),
  warn: (mensagem) => registrar('WARN', console.warn, mensagem),
  error: (mensagem, erro) => registrar('ERROR', console.error, mensagem, erro),
};
