from __future__ import annotations

from app.errors import ErroNegocio


def somente_digitos(valor: str) -> str:
    return "".join(c for c in (valor or "") if c.isdigit())


def validar_cpf(valor: str) -> str:
    """Normaliza e valida CPF (11 digitos + DV). Um CPF por teste gratis."""
    cpf = somente_digitos(valor)
    if len(cpf) != 11 or cpf == cpf[0] * 11:
        raise ErroNegocio("Informe um CPF valido.")

    def _digito(base: str) -> str:
        pesos = range(len(base) + 1, 1, -1)
        soma = sum(int(n) * p for n, p in zip(base, pesos))
        resto = (soma * 10) % 11
        return "0" if resto == 10 else str(resto)

    if cpf[9] != _digito(cpf[:9]) or cpf[10] != _digito(cpf[:10]):
        raise ErroNegocio("Informe um CPF valido.")
    return cpf
