from __future__ import annotations

import os
from typing import Any, Dict

import psycopg2

from app import db
from app.assinatura import avaliar_assinatura
from app.errors import ErroNegocio
from app.security import gerar_hash_senha, gerar_salt, validar_tamanho_senha

ALFABETO_CODIGO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"


def gerar_codigo_loja() -> str:
    bytes_rand = os.urandom(6)
    return "".join(ALFABETO_CODIGO[b % len(ALFABETO_CODIGO)] for b in bytes_rand)


def criar_loja_com_admin(
    *,
    loja: Dict[str, Any],
    admin: Dict[str, Any],
    aguardar_pagamento: bool = False,
    cpf: str = "",
    dias_validade: int | None = None,
    plano: str = "",
    trial_cpf: str = "",
) -> Dict[str, str]:
    nome = (loja or {}).get("nome", "").strip()
    if len(nome) < 2:
        raise ErroNegocio("Informe o nome da loja.")

    primeiro_nome = (admin.get("nome") or admin.get("primeiroNome") or "").strip()
    sobrenome = (admin.get("sobrenome") or "").strip()
    nome_admin = f"{primeiro_nome} {sobrenome}".strip()
    usuario = (admin.get("usuario") or "").strip().lower()
    email = ((loja or {}).get("email") or admin.get("email") or "").strip().lower()

    if len(primeiro_nome) < 2:
        raise ErroNegocio("Informe seu nome.")
    if len(sobrenome) < 2:
        raise ErroNegocio("Informe seu sobrenome.")
    if len(nome_admin) < 2:
        raise ErroNegocio("Informe o nome do administrador.")
    if len(usuario) < 3:
        raise ErroNegocio("O usuario deve ter ao menos 3 caracteres.")
    senha = validar_tamanho_senha(admin.get("senha") or "")
    if "@" not in email:
        raise ErroNegocio("Informe um e-mail valido.")

    salt = gerar_salt()
    senha_hash = gerar_hash_senha(senha, salt)

    with db.transacao() as cur:
        codigo = gerar_codigo_loja()
        for _ in range(5):
            cur.execute("SELECT 1 FROM lojas WHERE codigo = %s", (codigo,))
            if cur.fetchone() is None:
                break
            codigo = gerar_codigo_loja()

        cur.execute(
            """
            INSERT INTO lojas (nome, cnpj, endereco, telefone, email, cpf,
                               responsavel_nome, responsavel_sobrenome, codigo, ativa)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                nome,
                (loja.get("cnpj") or "").strip(),
                (loja.get("endereco") or "").strip(),
                (loja.get("telefone") or "").strip(),
                email,
                cpf or "",
                primeiro_nome,
                sobrenome,
                codigo,
                not aguardar_pagamento,
            ),
        )
        loja_id = str(cur.fetchone()["id"])

        cur.execute(
            """
            INSERT INTO funcionarios (loja_id, nome, usuario, salt, senha_hash, cargo)
            VALUES (%s, %s, %s, %s, %s, 'admin')
            """,
            (loja_id, nome_admin, usuario, salt, senha_hash),
        )
        if aguardar_pagamento:
            cur.execute(
                """
                INSERT INTO assinaturas (loja_id, status, valida_ate)
                VALUES (%s, 'pendente', NULL)
                """,
                (loja_id,),
            )
        elif dias_validade:
            cur.execute(
                """
                INSERT INTO assinaturas (loja_id, status, valida_ate, plano, valor_mensal)
                VALUES (%s, 'ativa', (CURRENT_DATE + (%s * interval '1 day'))::date, %s, 0)
                """,
                (loja_id, int(dias_validade), plano or "teste"),
            )
            if trial_cpf:
                try:
                    cur.execute(
                        "INSERT INTO trials_cpf (cpf, loja_id) VALUES (%s, %s)",
                        (trial_cpf, loja_id),
                    )
                except psycopg2.Error as exc:
                    if getattr(exc, "pgcode", None) == "23505":
                        raise ErroNegocio(
                            "Este CPF ja usou o teste gratis de 30 dias. Escolha um plano pago.",
                            409,
                        ) from exc
                    raise
        else:
            cur.execute(
                """
                INSERT INTO assinaturas (loja_id, status, valida_ate)
                VALUES (%s, 'ativa', (CURRENT_DATE + interval '1 year')::date)
                """,
                (loja_id,),
            )

    return {"lojaId": loja_id, "codigo": codigo}


def buscar_loja_por_codigo(codigo: str) -> Dict[str, str]:
    codigo_limpo = "".join(c for c in (codigo or "").strip().upper() if c.isalnum())
    if len(codigo_limpo) < 6:
        raise ErroNegocio("Codigo da loja invalido.")

    rows = db.consultar(
        "SELECT id, nome, ativa FROM lojas WHERE codigo = %s", (codigo_limpo,)
    )
    if not rows:
        raise ErroNegocio("Loja nao encontrada. Confira o codigo.", 404)

    loja = rows[0]
    if not loja["ativa"]:
        raise ErroNegocio("Loja desativada. Fale com o suporte.", 403)

    return {"lojaId": str(loja["id"]), "nome": loja["nome"]}


def obter_perfil(loja_id: str) -> Dict[str, Any]:
    rows = db.consultar(
        """
        SELECT l.id, l.nome, l.cnpj, l.endereco, l.telefone, l.codigo,
               a.plano, a.status AS "assinaturaStatus", a.valida_ate AS "validaAte"
        FROM lojas l
        LEFT JOIN assinaturas a ON a.loja_id = l.id
        WHERE l.id = %s
        """,
        (loja_id,),
    )
    if not rows:
        raise ErroNegocio("Loja nao encontrada.", 404)
    row = rows[0]
    row["id"] = str(row["id"])
    if row.get("validaAte") is not None:
        row["validaAte"] = str(row["validaAte"])
    situacao = avaliar_assinatura(row.get("assinaturaStatus"), row.get("validaAte"))
    row["assinaturaAtrasada"] = situacao["atrasada"]
    row["assinaturaBloqueada"] = situacao["bloqueada"]
    row["assinaturaRotulo"] = situacao["rotulo"]
    row["assinaturaMensagem"] = situacao["mensagem"]
    row["assinaturaStatusExibicao"] = situacao["statusExibicao"]
    return row


def regenerar_codigo_loja(loja_id: str) -> Dict[str, str]:
    """Gera uma nova chave de conexao para a loja (invalida a anterior)."""
    existente = db.consultar("SELECT id FROM lojas WHERE id = %s", (loja_id,))
    if not existente:
        raise ErroNegocio("Loja nao encontrada.", 404)

    with db.transacao() as cur:
        codigo = gerar_codigo_loja()
        for _ in range(8):
            cur.execute(
                "SELECT 1 FROM lojas WHERE codigo = %s AND id <> %s",
                (codigo, loja_id),
            )
            if cur.fetchone() is None:
                break
            codigo = gerar_codigo_loja()
        cur.execute(
            "UPDATE lojas SET codigo = %s, atualizado_em = now() WHERE id = %s",
            (codigo, loja_id),
        )
    return {"codigo": codigo}


def ativar_por_codigo(codigo: str) -> Dict[str, Any]:
    """Usa o código da loja como chave de ativação do desktop."""
    loja = buscar_loja_por_codigo(codigo)
    perfil = obter_perfil(loja["lojaId"])
    return {
        "ok": True,
        "lojaId": loja["lojaId"],
        "email": "",
        "nomeLoja": perfil["nome"],
    }


def obter_ou_criar_loja_desenvolvimento() -> Dict[str, Any]:
    rows = db.consultar(
        "SELECT id, nome FROM lojas WHERE codigo = 'DEVLOCAL' LIMIT 1"
    )
    if rows:
        return {
            "ok": True,
            "lojaId": str(rows[0]["id"]),
            "email": "dev@cybhor.local",
            "nomeLoja": rows[0]["nome"],
        }

    with db.transacao() as cur:
        cur.execute(
            """
            INSERT INTO lojas
                (nome, email, responsavel_nome, responsavel_sobrenome, codigo, ativa)
            VALUES ('Loja desenvolvimento', 'dev@cybhor.local',
                    'Administrador', 'Local', 'DEVLOCAL', TRUE)
            RETURNING id
            """
        )
        loja_id = str(cur.fetchone()["id"])
        cur.execute(
            """
            INSERT INTO assinaturas (loja_id, status, valor_mensal)
            VALUES (%s, 'ativa', 0)
            """,
            (loja_id,),
        )
    return {
        "ok": True,
        "lojaId": loja_id,
        "email": "dev@cybhor.local",
        "nomeLoja": "Loja desenvolvimento",
    }
