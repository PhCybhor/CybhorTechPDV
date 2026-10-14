/**
 * Erro de negócio: a mensagem é segura para mostrar ao cliente.
 */
export class ErroNegocio extends Error {
  /**
   * @param {string} mensagem texto devolvido em {"erro": ...}.
   * @param {number} [status=400] status HTTP.
   */
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.name = "ErroNegocio";
    this.status = status;
  }
}

/** Corpo ou parâmetro com formato errado (equivalente ao 422 do FastAPI). */
export class ErroValidacao extends ErroNegocio {
  constructor() {
    super("Dados invalidos.", 422);
    this.name = "ErroValidacao";
  }
}
