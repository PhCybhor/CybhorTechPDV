#!/usr/bin/env python3
"""Cria (ou atualiza a senha de) um administrador do SISTEMA.

Uso: python scripts/criar_admin_sistema.py "Seu Nome" email@dominio.com "senha-forte"
"""
from __future__ import annotations

import sys
from pathlib import Path

# Permite importar o pacote app/ ao rodar o script diretamente.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402
from app.db import close_pool, executar, init_pool  # noqa: E402
from app.security import gerar_hash_senha, gerar_salt  # noqa: E402


def main() -> None:
    if len(sys.argv) < 4:
        print(
            'Uso: python scripts/criar_admin_sistema.py "Nome" email@dominio.com "senha (min 8)"'
        )
        sys.exit(1)

    nome, email, senha = sys.argv[1], sys.argv[2], sys.argv[3]
    if len(senha) < 8:
        print("A senha deve ter ao menos 8 caracteres.")
        sys.exit(1)

    get_settings().validar_obrigatorias()
    init_pool()
    salt = gerar_salt()
    senha_hash = gerar_hash_senha(senha, salt)
    executar(
        """
        INSERT INTO administradores_sistema (nome, email, salt, senha_hash)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (email)
        DO UPDATE SET nome = EXCLUDED.nome, salt = EXCLUDED.salt,
                      senha_hash = EXCLUDED.senha_hash
        """,
        (nome.strip(), email.strip().lower(), salt, senha_hash),
    )
    print(f"Administrador do sistema pronto: {email}")
    close_pool()


if __name__ == "__main__":
    main()
