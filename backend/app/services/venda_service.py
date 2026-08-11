from __future__ import annotations

from typing import Any, Dict, List

from app import db
from app.errors import ErroNegocio


def registrar_venda(
    loja_id: str, funcionario: Dict[str, str], dados: Dict[str, Any]
) -> Dict[str, Any]:
    itens = dados.get("itens") if isinstance(dados.get("itens"), list) else []
    if not itens:
        raise ErroNegocio("A venda precisa de ao menos um item.")

    forma = (dados.get("formaPagamento") or "").strip().lower()
    if forma not in ("dinheiro", "credito", "debito", "pix"):
        raise ErroNegocio("Forma de pagamento invalida.")

    try:
        desconto = float(dados.get("desconto") or 0)
    except (TypeError, ValueError):
        raise ErroNegocio("Desconto invalido.")
    if desconto < 0:
        raise ErroNegocio("Desconto invalido.")

    with db.transacao() as cur:
        subtotal = 0.0
        itens_calculados: List[Dict[str, Any]] = []

        for item in itens:
            try:
                quantidade = int(item.get("quantidade"))
            except (TypeError, ValueError):
                raise ErroNegocio("Quantidade invalida em um dos itens.")
            if quantidade <= 0:
                raise ErroNegocio("Quantidade invalida em um dos itens.")

            cur.execute(
                """
                SELECT id, nome, preco, estoque FROM produtos
                WHERE id = %s AND loja_id = %s FOR UPDATE
                """,
                (item.get("produtoId"), loja_id),
            )
            produto = cur.fetchone()
            if not produto:
                raise ErroNegocio("Produto nao encontrado na loja.", 404)

            if produto["estoque"] < quantidade:
                raise ErroNegocio(f'Estoque insuficiente para "{produto["nome"]}".')

            preco_unitario = float(produto["preco"])
            subtotal_item = preco_unitario * quantidade
            subtotal += subtotal_item
            itens_calculados.append(
                {
                    "produtoId": str(produto["id"]),
                    "nome": produto["nome"],
                    "quantidade": quantidade,
                    "precoUnitario": preco_unitario,
                    "subtotal": subtotal_item,
                }
            )
            cur.execute(
                "UPDATE produtos SET estoque = estoque - %s, atualizado_em = now() WHERE id = %s",
                (quantidade, produto["id"]),
            )

        if desconto > subtotal:
            raise ErroNegocio("Desconto maior que o subtotal.")
        total = subtotal - desconto

        cur.execute(
            """
            INSERT INTO vendas (loja_id, funcionario_id, funcionario_nome,
                                subtotal, desconto, total, forma_pagamento)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id, criado_em AS "criadoEm"
            """,
            (
                loja_id,
                funcionario["id"],
                funcionario["nome"],
                subtotal,
                desconto,
                total,
                forma,
            ),
        )
        venda = cur.fetchone()
        venda_id = str(venda["id"])

        for item in itens_calculados:
            cur.execute(
                """
                INSERT INTO venda_itens
                    (venda_id, produto_id, nome, quantidade, preco_unitario, subtotal)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    venda_id,
                    item["produtoId"],
                    item["nome"],
                    item["quantidade"],
                    item["precoUnitario"],
                    item["subtotal"],
                ),
            )

        return {
            "id": venda_id,
            "criadoEm": venda["criadoEm"],
            "subtotal": subtotal,
            "desconto": desconto,
            "total": total,
            "formaPagamento": forma,
            "itens": itens_calculados,
        }


def listar_vendas(loja_id: str, limite: int = 100) -> List[Dict[str, Any]]:
    limite_seguro = min(max(int(limite or 100), 1), 500)
    vendas = db.consultar(
        """
        SELECT id, funcionario_id AS "funcionarioId", funcionario_nome AS "funcionarioNome",
               subtotal, desconto, total, forma_pagamento AS "formaPagamento",
               criado_em AS "criadoEm"
        FROM vendas WHERE loja_id = %s ORDER BY criado_em DESC LIMIT %s
        """,
        (loja_id, limite_seguro),
    )
    if not vendas:
        return []

    ids = [str(v["id"]) for v in vendas]
    itens = db.consultar(
        """
        SELECT venda_id AS "vendaId", produto_id AS "produtoId", nome, quantidade,
               preco_unitario AS "precoUnitario", subtotal
        FROM venda_itens WHERE venda_id = ANY(%s::uuid[])
        """,
        (ids,),
    )

    por_venda: Dict[str, List[Dict[str, Any]]] = {}
    for item in itens:
        vid = str(item["vendaId"])
        item["vendaId"] = vid
        if item.get("produtoId") is not None:
            item["produtoId"] = str(item["produtoId"])
        por_venda.setdefault(vid, []).append(item)

    resultado = []
    for v in vendas:
        v["id"] = str(v["id"])
        if v.get("funcionarioId") is not None:
            v["funcionarioId"] = str(v["funcionarioId"])
        for campo in ("subtotal", "desconto", "total"):
            v[campo] = float(v[campo])
        v["itens"] = por_venda.get(v["id"], [])
        resultado.append(v)
    return resultado
