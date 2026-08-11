from __future__ import annotations


class ErroNegocio(Exception):
    """Erro de negócio: mensagem segura para o cliente."""

    def __init__(self, mensagem: str, status: int = 400) -> None:
        super().__init__(mensagem)
        self.mensagem = mensagem
        self.status = status
