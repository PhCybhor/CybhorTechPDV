from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import httpx

from app import db
from app.config import get_settings
from app.errors import ErroNegocio
from app.mercado_pago import (
    ROTULOS_METODOS,
    configuracao_brick_pagamento,
    montar_corpo_pagamento,
)

logger = logging.getLogger(__name__)
MP_API = "https://api.mercadopago.com"


def _chamar_mercado_pago(
    caminho: str, *, method: str = "GET", body: Optional[Dict[str, Any]] = None
) -> Any:
    settings = get_settings()
    if not settings.mp_access_token:
        raise ErroNegocio("Pagamentos indisponiveis no momento.", 503)

    headers = {
        "Authorization": f"Bearer {settings.mp_access_token}",
        "Content-Type": "application/json",
    }
    if body is not None:
        headers["X-Idempotency-Key"] = str(uuid.uuid4())

    with httpx.Client(timeout=30.0) as client:
        resposta = client.request(
            method, f"{MP_API}{caminho}", headers=headers, json=body
        )

    try:
        dados = resposta.json()
    except Exception:
        dados = {}

    if resposta.is_error:
        logger.error("Mercado Pago respondeu erro: %s %s", resposta.status_code, dados)
        msg = None
        if isinstance(dados, dict):
            msg = dados.get("message")
            if not msg:
                cause = dados.get("cause") or []
                if cause:
                    msg = cause[0].get("description")
        raise ErroNegocio(msg or "Falha ao comunicar com o Mercado Pago.", 502)
    return dados


def ativar_assinatura_loja(loja_id: str) -> None:
    db.executar(
        """
        UPDATE assinaturas
        SET status = 'ativa',
            valida_ate = (
              GREATEST(COALESCE(valida_ate, CURRENT_DATE), CURRENT_DATE)
              + interval '1 month'
            )::date,
            atualizado_em = now()
        WHERE loja_id = %s
        """,
        (loja_id,),
    )
    db.executar(
        "UPDATE lojas SET ativa = TRUE, atualizado_em = now() WHERE id = %s",
        (loja_id,),
    )


def registrar_pagamento(loja_id: str, pagamento: Dict[str, Any]) -> None:
    db.executar(
        """
        INSERT INTO pagamentos (loja_id, mp_payment_id, status, valor, payload)
        VALUES (%s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (mp_payment_id)
        DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload
        """,
        (
            loja_id,
            str(pagamento["id"]),
            pagamento["status"],
            pagamento.get("transaction_amount"),
            json.dumps(
                {
                    "status": pagamento.get("status"),
                    "status_detail": pagamento.get("status_detail"),
                    "date_approved": pagamento.get("date_approved"),
                }
            ),
        ),
    )
    if pagamento.get("status") == "approved":
        ativar_assinatura_loja(loja_id)


def sincronizar_pagamento_loja(loja_id: str) -> None:
    settings = get_settings()
    if not settings.mp_access_token:
        return
    try:
        busca = _chamar_mercado_pago(
            f"/v1/payments/search?sort=date_created&criteria=desc"
            f"&external_reference={quote(loja_id)}&limit=5"
        )
        if not isinstance(busca, dict):
            return
        pagamentos = busca.get("results") or []
        aprovado = next((p for p in pagamentos if p.get("status") == "approved"), None)
        if aprovado:
            registrar_pagamento(loja_id, aprovado)
    except Exception as erro:
        logger.error("Falha ao sincronizar pagamento MP: %s", erro)


def listar_metodos_pagamento_mp() -> List[Dict[str, Any]]:
    metodos = _chamar_mercado_pago("/v1/payment_methods")
    lista = metodos if isinstance(metodos, list) else []
    return [
        {
            "id": m["id"],
            "nome": m.get("name"),
            "tipo": m.get("payment_type_id"),
            "thumbnail": m.get("secure_thumbnail") or m.get("thumbnail"),
        }
        for m in lista
        if isinstance(m, dict) and m.get("status") == "active"
    ]


def _listar_metodos_seguro() -> List[Dict[str, Any]]:
    settings = get_settings()
    if not settings.mp_access_token:
        return []
    try:
        # chamar_mercado_pago espera dict; payment_methods retorna list
        headers = {
            "Authorization": f"Bearer {settings.mp_access_token}",
            "Content-Type": "application/json",
        }
        with httpx.Client(timeout=30.0) as client:
            resposta = client.get(f"{MP_API}/v1/payment_methods", headers=headers)
        dados = resposta.json()
        if resposta.is_error or not isinstance(dados, list):
            return []
        return [
            {
                "id": m["id"],
                "nome": m.get("name"),
                "tipo": m.get("payment_type_id"),
                "thumbnail": m.get("secure_thumbnail") or m.get("thumbnail"),
            }
            for m in dados
            if m.get("status") == "active"
        ]
    except Exception as erro:
        logger.error("Nao foi possivel listar metodos MP: %s", erro)
        return []


def obter_configuracao_pagamento_site() -> Dict[str, Any]:
    return {
        "customization": configuracao_brick_pagamento(),
        "metodosDisponiveis": _listar_metodos_seguro(),
        "metodosHabilitados": [
            {"chave": k, "rotulo": v} for k, v in ROTULOS_METODOS.items()
        ],
    }


def criar_checkout_assinatura(
    loja_id: str, opcoes: Optional[Dict[str, Any]] = None
) -> Dict[str, str]:
    opcoes = opcoes or {}
    settings = get_settings()
    loja = db.consultar(
        """
        SELECT id, nome, email, responsavel_nome, responsavel_sobrenome
        FROM lojas WHERE id = %s
        """,
        (loja_id,),
    )
    if not loja:
        raise ErroNegocio("Loja nao encontrada.", 404)

    registro = loja[0]
    nome_loja = registro["nome"]
    site_base = (settings.url_publica_site or "").rstrip("/")
    api_base = (settings.url_publica_api or site_base).rstrip("/")

    preferencia_body: Dict[str, Any] = {
        "items": [
            {
                "id": "cybhorpdv-mensal",
                "title": f"CybhorPDV — assinatura mensal ({nome_loja})",
                "description": (
                    "Acesso ao sistema PDV CybhorPDV por 1 mes. "
                    "Codigo individual da loja liberado apos pagamento."
                ),
                "quantity": 1,
                "currency_id": "BRL",
                "unit_price": settings.assinatura_valor_mensal,
                "category_id": "services",
            }
        ],
        "external_reference": loja_id,
        "statement_descriptor": "CYBHORPDV",
        "payment_methods": {
            "installments": 12,
            "default_installments": 1,
        },
        "metadata": {
            "loja_id": loja_id,
            "produto": "assinatura-mensal",
        },
    }
    if api_base.startswith("https://"):
        preferencia_body["notification_url"] = f"{api_base}/api/pagamentos/webhook"

    payer: Dict[str, Any] = {}
    email = (opcoes.get("email") or registro.get("email") or "").strip()
    if email:
        payer["email"] = email
    if registro.get("responsavel_nome"):
        payer["name"] = registro["responsavel_nome"]
    if registro.get("responsavel_sobrenome"):
        payer["surname"] = registro["responsavel_sobrenome"]
    if payer:
        preferencia_body["payer"] = payer

    if opcoes.get("origemSite") and opcoes.get("tokenAtivacao"):
        token = quote(str(opcoes["tokenAtivacao"]))
        url_sucesso = f"{site_base}/sucesso.html?token={token}"
        preferencia_body["back_urls"] = {
            "success": url_sucesso,
            "failure": f"{site_base}/falha.html",
            "pending": f"{url_sucesso}&pendente=1",
        }
        preferencia_body["metadata"]["token_ativacao"] = opcoes["tokenAtivacao"]
        if site_base.startswith("https://"):
            preferencia_body["auto_return"] = "approved"

    preferencia = _chamar_mercado_pago(
        "/checkout/preferences", method="POST", body=preferencia_body
    )
    if not isinstance(preferencia, dict) or not preferencia.get("id"):
        raise ErroNegocio("Falha ao criar checkout no Mercado Pago.", 502)

    init_point = preferencia.get("init_point") or preferencia.get("sandbox_init_point")
    if not init_point:
        raise ErroNegocio("Mercado Pago nao devolveu o link de pagamento.", 502)

    db.executar(
        """
        UPDATE assinaturas
        SET mp_preference_id = %s, valor_mensal = %s, atualizado_em = now()
        WHERE loja_id = %s
        """,
        (preferencia["id"], settings.assinatura_valor_mensal, loja_id),
    )
    return {
        "checkoutUrl": init_point,
        "preferenciaId": preferencia["id"],
    }


def criar_pagamento_transparente(
    loja_id: str,
    email: str,
    form_data: Dict[str, Any],
    pagador: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    pagador = pagador or {}
    settings = get_settings()
    loja = db.consultar(
        "SELECT id, nome, responsavel_nome, responsavel_sobrenome FROM lojas WHERE id = %s",
        (loja_id,),
    )
    if not loja:
        raise ErroNegocio("Loja nao encontrada.", 404)

    registro = loja[0]
    valor = settings.assinatura_valor_mensal
    payer_in = (form_data or {}).get("payer") or {}
    first_name = (
        payer_in.get("first_name")
        or pagador.get("firstName")
        or registro["responsavel_nome"]
        or ""
    )
    last_name = (
        payer_in.get("last_name")
        or pagador.get("lastName")
        or registro["responsavel_sobrenome"]
        or ""
    )
    if not form_data.get("payment_method_id"):
        raise ErroNegocio("Forma de pagamento nao informada.")

    try:
        corpo = montar_corpo_pagamento(
            loja_id=loja_id,
            valor=valor,
            nome_loja=registro["nome"],
            email=email,
            first_name=first_name,
            last_name=last_name,
            form_data=form_data or {},
        )
    except ValueError as exc:
        raise ErroNegocio(str(exc)) from exc

    api_base = (settings.url_publica_api or "").rstrip("/")
    if api_base.startswith("https://"):
        corpo["notification_url"] = f"{api_base}/api/pagamentos/webhook"
    corpo["statement_descriptor"] = "CYBHORPDV"

    pagamento = _chamar_mercado_pago("/v1/payments", method="POST", body=corpo)
    if not isinstance(pagamento, dict) or not pagamento.get("id"):
        raise ErroNegocio("Falha ao processar pagamento no Mercado Pago.", 502)
    registrar_pagamento(loja_id, pagamento)
    db.executar(
        "UPDATE assinaturas SET valor_mensal = %s, atualizado_em = now() WHERE loja_id = %s",
        (valor, loja_id),
    )
    return pagamento


def processar_webhook(notificacao: Dict[str, Any]) -> Dict[str, Any]:
    tipo = (notificacao.get("type") or notificacao.get("topic") or "").strip().lower()
    data = notificacao.get("data") if isinstance(notificacao.get("data"), dict) else {}
    payment_id = data.get("id") or notificacao.get("id") or notificacao.get("data.id")
    if tipo not in ("payment", "") or not payment_id:
        # IPN clássico: topic=payment&id=...
        if (notificacao.get("topic") or "").lower() != "payment":
            return {"ignorado": True}
        payment_id = notificacao.get("id")
        if not payment_id:
            return {"ignorado": True}

    pagamento = _chamar_mercado_pago(f"/v1/payments/{payment_id}")
    if not isinstance(pagamento, dict):
        return {"ignorado": True}
    loja_id = pagamento.get("external_reference")
    if not loja_id:
        return {"ignorado": True}

    registrar_pagamento(loja_id, pagamento)
    return {"processado": True, "status": pagamento.get("status")}


def obter_assinatura(loja_id: str) -> Dict[str, Any]:
    sincronizar_pagamento_loja(loja_id)
    rows = db.consultar(
        """
        SELECT status, plano, valor_mensal AS "valorMensal", valida_ate AS "validaAte"
        FROM assinaturas WHERE loja_id = %s
        """,
        (loja_id,),
    )
    if not rows:
        raise ErroNegocio("Assinatura nao encontrada.", 404)
    row = rows[0]
    row["valorMensal"] = float(row["valorMensal"] or 0)
    return row
