from __future__ import annotations

import hashlib
import hmac
import os

from app.errors import ErroNegocio

ITERACOES = 150_000
TAMANHO_CHAVE_BYTES = 32
SENHA_MIN = 8
SENHA_MAX = 128


def gerar_salt() -> str:
    return os.urandom(16).hex()


def validar_tamanho_senha(senha: str) -> str:
    """Rejeita senhas curtas ou gigantes (DoS via PBKDF2) antes do hash."""
    texto = senha or ""
    if len(texto) < SENHA_MIN:
        raise ErroNegocio(f"A senha deve ter ao menos {SENHA_MIN} caracteres.")
    if len(texto) > SENHA_MAX:
        raise ErroNegocio(f"A senha deve ter no maximo {SENHA_MAX} caracteres.")
    return texto


def gerar_hash_senha(senha: str, salt: str) -> str:
    """PBKDF2-SHA256 — salt é a string hex (UTF-8), igual ao desktop."""
    chave = hashlib.pbkdf2_hmac(
        "sha256",
        senha.encode("utf-8"),
        salt.encode("utf-8"),
        ITERACOES,
        dklen=TAMANHO_CHAVE_BYTES,
    )
    return chave.hex()


def verificar_senha(senha: str, salt: str, hash_esperado: str) -> bool:
    if not senha or len(senha) > SENHA_MAX:
        return False
    if not salt or not hash_esperado:
        return False
    hash_atual = gerar_hash_senha(senha, salt)
    try:
        return hmac.compare_digest(hash_atual, hash_esperado)
    except (TypeError, ValueError):
        return False
