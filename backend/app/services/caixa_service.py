from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List

from app.errors import ErroNegocio
from app.services import dados_service


FORMAS_SIMPLES = frozenset({"dinheiro", "credito", "debito", "pix", "fiado", "misto"})


def _qtd(valor: Any) -> float:
    try:
        n = float(valor)
    except (TypeError, ValueError):
        raise ErroNegocio("Quantidade invalida em um dos itens.")
    if n <= 0:
        raise ErroNegocio("Quantidade invalida em um dos itens.")
    return n


def _money(valor: Any, campo: str) -> float:
    try:
        n = float(valor or 0)
    except (TypeError, ValueError):
        raise ErroNegocio(f"{campo} invalido.")
    if n < 0:
        raise ErroNegocio(f"{campo} invalido.")
    return n


def _normalizar_pagamentos(
    forma_pagamento: Any,
    formas_pagamento: Any,
    total: float,
    fiado: bool,
) -> Dict[str, Any]:
    if fiado:
        return {
            "formaPagamento": "fiado",
            "formasPagamento": [{"tipo": "fiado", "valor": total}],
        }

    if isinstance(formas_pagamento, list) and len(formas_pagamento) >= 2:
        partes = []
        for p in formas_pagamento:
            if not isinstance(p, dict):
                continue
            tipo = str(p.get("tipo") or "").strip().lower()
            try:
                valor = round(float(p.get("valor") or 0), 2)
            except (TypeError, ValueError):
                continue
            if tipo and valor > 0:
                partes.append({"tipo": tipo, "valor": valor})
        soma = round(sum(p["valor"] for p in partes), 2)
        if len(partes) < 2:
            raise ErroNegocio("Pagamento dividido precisa de pelo menos 2 formas.")
        if abs(soma - total) > 0.05:
            raise ErroNegocio(
                f"Soma das formas ({soma:.2f}) deve fechar o total ({total:.2f})."
            )
        return {"formaPagamento": "misto", "formasPagamento": partes}

    forma = str(forma_pagamento or "dinheiro").strip().lower() or "dinheiro"
    if forma not in FORMAS_SIMPLES:
        raise ErroNegocio("Forma de pagamento invalida.")
    return {
        "formaPagamento": forma,
        "formasPagamento": [{"tipo": forma, "valor": total}],
    }


def finalizar_venda(
    loja_id: str, funcionario: Dict[str, str], dados: Dict[str, Any]
) -> Dict[str, Any]:
    """Registra venda e baixa estoque no JSONB com lock — sem corrida no caixa."""
    itens = dados.get("itens") if isinstance(dados.get("itens"), list) else []
    if not itens:
        raise ErroNegocio("A venda precisa de ao menos um item.")

    desconto = _money(dados.get("desconto"), "Desconto")
    fiado = bool(dados.get("fiado"))
    cliente_id = dados.get("clienteId") or None
    cliente_nome = dados.get("clienteNome") or None

    venda_id = uuid.uuid4().hex
    criado_em = int(time.time() * 1000)

    with dados_service.db.transacao() as cur:
        produtos = dados_service._carregar_recurso(cur, loja_id, "produtos")
        vendas = dados_service._carregar_recurso(cur, loja_id, "vendas")

        subtotal = 0.0
        itens_venda: List[Dict[str, Any]] = []

        for item in itens:
            if not isinstance(item, dict):
                raise ErroNegocio("Item de venda invalido.")
            produto_id = str(item.get("produtoId") or "").strip()
            if not produto_id:
                raise ErroNegocio("Produto invalido na venda.")
            quantidade = _qtd(item.get("quantidade"))

            produto = produtos.get(produto_id)
            if not isinstance(produto, dict):
                raise ErroNegocio("Produto nao encontrado na loja.", 404)

            estoque_atual = float(produto.get("estoque") or 0)
            if estoque_atual + 1e-9 < quantidade:
                nome = produto.get("nome") or produto_id
                raise ErroNegocio(f'Estoque insuficiente para "{nome}".')

            # Preco vem do cadastro (nao confia no cliente para o valor unitario).
            try:
                preco_cadastro = float(produto.get("preco") or 0)
            except (TypeError, ValueError):
                preco_cadastro = 0.0
            try:
                preco_enviado = float(item.get("precoUnitario"))
            except (TypeError, ValueError):
                preco_enviado = preco_cadastro
            # Aceita preco do carrinho (promocao/kg) se for finito e >= 0.
            preco_unitario = (
                preco_enviado
                if preco_enviado >= 0 and preco_enviado == preco_enviado
                else preco_cadastro
            )

            subtotal_item = preco_unitario * quantidade
            subtotal += subtotal_item

            custo_raw = item.get("custoUnitario", produto.get("custo"))
            try:
                custo_unitario = (
                    None
                    if custo_raw is None or custo_raw == ""
                    else float(custo_raw)
                )
            except (TypeError, ValueError):
                custo_unitario = None
            if custo_unitario is not None and (
                not (custo_unitario == custo_unitario) or custo_unitario < 0
            ):
                custo_unitario = None

            itens_venda.append(
                {
                    "produtoId": produto_id,
                    "nome": produto.get("nome") or item.get("nome") or "",
                    "quantidade": quantidade,
                    "precoUnitario": preco_unitario,
                    "subtotal": subtotal_item,
                    "custoUnitario": custo_unitario,
                }
            )
            produto["estoque"] = max(0.0, estoque_atual - quantidade)
            produto["atualizadoEm"] = criado_em
            produtos[produto_id] = produto

        desconto_aplicado = min(desconto, subtotal)
        total = subtotal - desconto_aplicado
        pagamentos = _normalizar_pagamentos(
            dados.get("formaPagamento"),
            dados.get("formasPagamento"),
            total,
            fiado,
        )

        venda = {
            "itens": itens_venda,
            "subtotal": subtotal,
            "desconto": desconto_aplicado,
            "total": total,
            "formaPagamento": pagamentos["formaPagamento"],
            "formasPagamento": pagamentos["formasPagamento"],
            "funcionarioId": funcionario.get("id"),
            "funcionarioNome": funcionario.get("nome"),
            "clienteId": cliente_id,
            "clienteNome": cliente_nome,
            "fiado": fiado,
            "criadoEm": criado_em,
            "cancelada": False,
        }
        vendas[venda_id] = venda

        dados_service._salvar_recurso(cur, loja_id, "produtos", produtos)
        dados_service._salvar_recurso(cur, loja_id, "vendas", vendas)

    return {
        "id": venda_id,
        "total": total,
        "subtotal": subtotal,
        "desconto": desconto_aplicado,
        "formaPagamento": pagamentos["formaPagamento"],
        "formasPagamento": pagamentos["formasPagamento"],
        "funcionarioNome": funcionario.get("nome"),
        "itens": itens_venda,
        "criadoEm": criado_em,
        "cancelada": False,
        "clienteId": cliente_id,
        "clienteNome": cliente_nome,
        "fiado": fiado,
    }


def cancelar_venda(
    loja_id: str,
    *,
    venda_id: str,
    motivo: str = "",
    cancelado_por_nome: str = "",
) -> Dict[str, Any]:
    """Cancela venda e devolve estoque atomicamente (com lock)."""
    if not venda_id:
        raise ErroNegocio("Venda invalida.")

    agora = int(time.time() * 1000)
    with dados_service.db.transacao() as cur:
        vendas = dados_service._carregar_recurso(cur, loja_id, "vendas")
        venda = vendas.get(venda_id)
        if not isinstance(venda, dict):
            raise ErroNegocio("Venda nao encontrada.", 404)
        if venda.get("cancelada"):
            raise ErroNegocio("Esta venda ja esta cancelada.")

        produtos = dados_service._carregar_recurso(cur, loja_id, "produtos")
        for item in venda.get("itens") or []:
            if not isinstance(item, dict):
                continue
            produto_id = item.get("produtoId")
            if not produto_id:
                continue
            produto = produtos.get(str(produto_id))
            if not isinstance(produto, dict):
                continue
            try:
                qtd = float(item.get("quantidade") or 0)
            except (TypeError, ValueError):
                qtd = 0
            if qtd <= 0:
                continue
            try:
                estoque_atual = float(produto.get("estoque") or 0)
            except (TypeError, ValueError):
                estoque_atual = 0
            produto["estoque"] = estoque_atual + qtd
            produto["atualizadoEm"] = agora
            produtos[str(produto_id)] = produto

        venda["cancelada"] = True
        venda["canceladoEm"] = agora
        venda["canceladoPor"] = cancelado_por_nome or "admin"
        venda["motivoCancelamento"] = str(motivo or "").strip()
        vendas[venda_id] = venda

        dados_service._salvar_recurso(cur, loja_id, "produtos", produtos)
        dados_service._salvar_recurso(cur, loja_id, "vendas", vendas)

    return {"id": venda_id, **venda}
