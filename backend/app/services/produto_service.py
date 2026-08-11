from __future__ import annotations

from typing import Any, Dict, List

from app import db
from app.errors import ErroNegocio


def _validar_produto(dados: Dict[str, Any]) -> Dict[str, Any]:
    nome = (dados.get("nome") or "").strip()
    try:
        preco = float(dados.get("preco"))
    except (TypeError, ValueError):
        raise ErroNegocio("Preco invalido.")
    try:
        estoque = int(dados.get("estoque"))
    except (TypeError, ValueError):
        raise ErroNegocio("Estoque invalido.")

    if len(nome) < 2:
        raise ErroNegocio("Informe o nome do produto.")
    if preco < 0:
        raise ErroNegocio("Preco invalido.")
    if estoque < 0:
        raise ErroNegocio("Estoque invalido.")

    return {
        "nome": nome,
        "preco": preco,
        "estoque": estoque,
        "codigoBarras": (dados.get("codigoBarras") or "").strip(),
        "categoria": (dados.get("categoria") or "").strip(),
    }


def listar(loja_id: str) -> List[Dict[str, Any]]:
    rows = db.consultar(
        """
        SELECT id, nome, codigo_barras AS "codigoBarras", preco, estoque, categoria,
               criado_em AS "criadoEm", atualizado_em AS "atualizadoEm"
        FROM produtos WHERE loja_id = %s ORDER BY nome
        """,
        (loja_id,),
    )
    for r in rows:
        r["id"] = str(r["id"])
        r["preco"] = float(r["preco"])
    return rows


def criar(loja_id: str, dados: Dict[str, Any]) -> Dict[str, str]:
    p = _validar_produto(dados)
    rows = db.consultar(
        """
        INSERT INTO produtos (loja_id, nome, codigo_barras, preco, estoque, categoria)
        VALUES (%s, %s, %s, %s, %s, %s) RETURNING id
        """,
        (loja_id, p["nome"], p["codigoBarras"], p["preco"], p["estoque"], p["categoria"]),
    )
    return {"id": str(rows[0]["id"])}


def atualizar(loja_id: str, produto_id: str, dados: Dict[str, Any]) -> None:
    p = _validar_produto(dados)
    afetadas = db.executar(
        """
        UPDATE produtos
        SET nome = %s, codigo_barras = %s, preco = %s, estoque = %s, categoria = %s,
            atualizado_em = now()
        WHERE id = %s AND loja_id = %s
        """,
        (
            p["nome"],
            p["codigoBarras"],
            p["preco"],
            p["estoque"],
            p["categoria"],
            produto_id,
            loja_id,
        ),
    )
    if afetadas == 0:
        raise ErroNegocio("Produto nao encontrado.", 404)


def remover(loja_id: str, produto_id: str) -> None:
    afetadas = db.executar(
        "DELETE FROM produtos WHERE id = %s AND loja_id = %s",
        (produto_id, loja_id),
    )
    if afetadas == 0:
        raise ErroNegocio("Produto nao encontrado.", 404)
