#!/usr/bin/env python3
"""Popula (ou atualiza) contas de teste do CybhorPDV.

Uso (na pasta backend/):
  python3 scripts/seed_contas_teste.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402
from app.db import close_pool, consultar, executar, init_pool  # noqa: E402
from app.security import gerar_hash_senha, gerar_salt  # noqa: E402

# Credenciais fixas de desenvolvimento — NÃO usar em produção.
ADMIN_SISTEMA = {
    "nome": "Admin Cybhor",
    "email": "admin@cybhor.local",
    "senha": "admin1234",
}

LOJA_TESTE = {
    "codigo": "TESTE01",
    "nome": "Loja Teste PDV",
    "cnpj": "00.000.000/0001-91",
    "endereco": "Rua Teste, 100",
    "telefone": "(11) 99999-0000",
    "email": "loja@cybhor.local",
    "responsavel_nome": "Pedro",
    "responsavel_sobrenome": "Teste",
}

FUNCIONARIOS_LOJA = [
    {
        "nome": "Admin Loja",
        "usuario": "admin",
        "senha": "admin1234",
        "cargo": "admin",
    },
    {
        "nome": "Operador Caixa",
        "usuario": "operador",
        "senha": "operador123",
        "cargo": "operador",
    },
]

PRODUTOS = [
    ("Arroz 5kg", "7891000100103", 24.90, 50, "Mercearia"),
    ("Feijão 1kg", "7891000100202", 8.50, 80, "Mercearia"),
    ("Refrigerante 2L", "7891000100301", 9.90, 40, "Bebidas"),
    ("Pão Francês (kg)", "7891000100400", 14.00, 20, "Padaria"),
    ("Café 500g", "7891000100509", 18.75, 30, "Mercearia"),
]


def upsert_admin_sistema() -> None:
    salt = gerar_salt()
    senha_hash = gerar_hash_senha(ADMIN_SISTEMA["senha"], salt)
    executar(
        """
        INSERT INTO administradores_sistema (nome, email, salt, senha_hash)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (email)
        DO UPDATE SET nome = EXCLUDED.nome, salt = EXCLUDED.salt,
                      senha_hash = EXCLUDED.senha_hash
        """,
        (
            ADMIN_SISTEMA["nome"],
            ADMIN_SISTEMA["email"],
            salt,
            senha_hash,
        ),
    )


def upsert_loja_teste() -> str:
    existentes = consultar(
        "SELECT id FROM lojas WHERE codigo = %s", (LOJA_TESTE["codigo"],)
    )
    if existentes:
        loja_id = str(existentes[0]["id"])
        executar(
            """
            UPDATE lojas SET
              nome = %s, cnpj = %s, endereco = %s, telefone = %s, email = %s,
              responsavel_nome = %s, responsavel_sobrenome = %s,
              ativa = TRUE, atualizado_em = now()
            WHERE id = %s
            """,
            (
                LOJA_TESTE["nome"],
                LOJA_TESTE["cnpj"],
                LOJA_TESTE["endereco"],
                LOJA_TESTE["telefone"],
                LOJA_TESTE["email"],
                LOJA_TESTE["responsavel_nome"],
                LOJA_TESTE["responsavel_sobrenome"],
                loja_id,
            ),
        )
    else:
        rows = consultar(
            """
            INSERT INTO lojas (
              nome, cnpj, endereco, telefone, email,
              responsavel_nome, responsavel_sobrenome, codigo, ativa
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, TRUE)
            RETURNING id
            """,
            (
                LOJA_TESTE["nome"],
                LOJA_TESTE["cnpj"],
                LOJA_TESTE["endereco"],
                LOJA_TESTE["telefone"],
                LOJA_TESTE["email"],
                LOJA_TESTE["responsavel_nome"],
                LOJA_TESTE["responsavel_sobrenome"],
                LOJA_TESTE["codigo"],
            ),
        )
        loja_id = str(rows[0]["id"])

    executar(
        """
        INSERT INTO assinaturas (loja_id, status, valor_mensal, valida_ate)
        VALUES (%s, 'ativa', 0, CURRENT_DATE + INTERVAL '1 year')
        ON CONFLICT (loja_id)
        DO UPDATE SET status = 'ativa', valor_mensal = 0,
                      valida_ate = CURRENT_DATE + INTERVAL '1 year',
                      atualizado_em = now()
        """,
        (loja_id,),
    )
    return loja_id


def upsert_funcionarios(loja_id: str) -> None:
    for func in FUNCIONARIOS_LOJA:
        salt = gerar_salt()
        senha_hash = gerar_hash_senha(func["senha"], salt)
        executar(
            """
            INSERT INTO funcionarios (loja_id, nome, usuario, salt, senha_hash, cargo)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (loja_id, usuario)
            DO UPDATE SET nome = EXCLUDED.nome, salt = EXCLUDED.salt,
                          senha_hash = EXCLUDED.senha_hash, cargo = EXCLUDED.cargo,
                          atualizado_em = now()
            """,
            (
                loja_id,
                func["nome"],
                func["usuario"],
                salt,
                senha_hash,
                func["cargo"],
            ),
        )


def upsert_produtos(loja_id: str) -> None:
    for nome, codigo, preco, estoque, categoria in PRODUTOS:
        existentes = consultar(
            """
            SELECT id FROM produtos
            WHERE loja_id = %s AND codigo_barras = %s
            """,
            (loja_id, codigo),
        )
        if existentes:
            executar(
                """
                UPDATE produtos SET
                  nome = %s, preco = %s, estoque = %s, categoria = %s,
                  atualizado_em = now()
                WHERE id = %s
                """,
                (nome, preco, estoque, categoria, str(existentes[0]["id"])),
            )
        else:
            executar(
                """
                INSERT INTO produtos
                  (loja_id, nome, codigo_barras, preco, estoque, categoria)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (loja_id, nome, codigo, preco, estoque, categoria),
            )


def sincronizar_devlocal() -> None:
    """Garante admin conhecido na loja DEVLOCAL, se ela existir."""
    rows = consultar("SELECT id FROM lojas WHERE codigo = 'DEVLOCAL' LIMIT 1")
    if not rows:
        return
    loja_id = str(rows[0]["id"])
    salt = gerar_salt()
    senha_hash = gerar_hash_senha("admin1234", salt)
    executar(
        """
        INSERT INTO funcionarios (loja_id, nome, usuario, salt, senha_hash, cargo)
        VALUES (%s, 'Admin Dev', 'admin', %s, %s, 'admin')
        ON CONFLICT (loja_id, usuario)
        DO UPDATE SET nome = EXCLUDED.nome, salt = EXCLUDED.salt,
                      senha_hash = EXCLUDED.senha_hash, cargo = 'admin',
                      atualizado_em = now()
        """,
        (loja_id, salt, senha_hash),
    )
    executar(
        """
        INSERT INTO assinaturas (loja_id, status, valor_mensal)
        VALUES (%s, 'ativa', 0)
        ON CONFLICT (loja_id)
        DO UPDATE SET status = 'ativa', atualizado_em = now()
        """,
        (loja_id,),
    )


def main() -> None:
    get_settings().validar_obrigatorias()
    if get_settings().em_producao:
        print(
            "Recusado: seed de contas de teste nao pode rodar com NODE_ENV=production."
        )
        sys.exit(1)

    init_pool()
    try:
        upsert_admin_sistema()
        loja_id = upsert_loja_teste()
        upsert_funcionarios(loja_id)
        upsert_produtos(loja_id)
        sincronizar_devlocal()
        # Garante assinatura ativa nas lojas de desenvolvimento existentes.
        executar(
            """
            UPDATE assinaturas
            SET status = 'ativa',
                valida_ate = COALESCE(valida_ate, CURRENT_DATE + INTERVAL '1 year'),
                atualizado_em = now()
            WHERE status <> 'ativa' OR valida_ate IS NULL
            """
        )
    finally:
        close_pool()

    print("Contas de teste prontas.\n")
    print("=== Admin do sistema (painel /admin) ===")
    print(f"  email: {ADMIN_SISTEMA['email']}")
    print(f"  senha: {ADMIN_SISTEMA['senha']}")
    print("\n=== Loja PDV ===")
    print(f"  codigo: {LOJA_TESTE['codigo']}")
    print(f"  nome:   {LOJA_TESTE['nome']}")
    for func in FUNCIONARIOS_LOJA:
        print(f"  {func['cargo']}: usuario={func['usuario']} senha={func['senha']}")
    print("\n=== Loja DEVLOCAL (se existir) ===")
    print("  usuario=admin senha=admin1234")


if __name__ == "__main__":
    main()
