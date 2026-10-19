/**
 * Erro de negócio: a mensagem é segura para ser devolvida ao cliente.
 * Também substitui o HTTPException do FastAPI (401/403 de autenticação).
 */
export class ErroNegocio extends Error {
  /**
   * @param {string} mensagem texto exibido ao cliente em `{ erro }`.
   * @param {number} [status=400] código HTTP.
   */
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.name = 'ErroNegocio';
    this.mensagem = mensagem;
    this.status = status;
  }
}
