from __future__ import annotations

from typing import Any, Dict, List, Optional

ROTULOS_METODOS = {
    "creditCard": "Cartao de credito",
    "debitCard": "Cartao de debito",
    "prepaidCard": "Cartao pre-pago",
    "ticket": "Boleto bancario",
    "bankTransfer": "Pix",
    "mercadoPago": "Saldo Mercado Pago",
}

METODOS_BRASIL = {
    "creditCard": "all",
    "debitCard": "all",
    "prepaidCard": "all",
    "ticket": ["bolbradesco"],
    "bankTransfer": ["pix"],
    "mercadoPago": ["wallet_purchase"],
    "maxInstallments": 1,
}


def configuracao_brick_pagamento() -> Dict[str, Any]:
    return {
        "visual": {
            "style": {"theme": "dark"},
            "texts": {
                "paymentMethods": {
                    "creditCardTitle": "Cartao de credito",
                    "debitCardTitle": "Cartao de debito",
                    "ticketTitle": "Boleto bancario",
                    "bankTransferTitle": "Pix",
                }
            },
        },
        "paymentMethods": dict(METODOS_BRASIL),
    }


def montar_corpo_pagamento(
    *,
    loja_id: str,
    valor: float,
    nome_loja: str,
    email: str,
    first_name: str,
    last_name: str,
    form_data: Dict[str, Any],
) -> Dict[str, Any]:
    metodo = form_data.get("payment_method_id")
    if not metodo:
        raise ValueError("Forma de pagamento nao informada.")

    payer_in = form_data.get("payer") or {}
    payer: Dict[str, Any] = {
        "email": payer_in.get("email") or email,
        "first_name": first_name,
        "last_name": last_name,
    }

    ident = payer_in.get("identification") or {}
    if ident.get("type") and ident.get("number"):
        payer["identification"] = {
            "type": ident["type"],
            "number": "".join(c for c in str(ident["number"]) if c.isdigit()),
        }

    corpo: Dict[str, Any] = {
        "transaction_amount": valor,
        "description": f"CybhorPDV — assinatura mensal ({nome_loja})",
        "payment_method_id": metodo,
        "external_reference": loja_id,
        "payer": payer,
    }

    if form_data.get("token"):
        corpo["token"] = form_data["token"]
        corpo["installments"] = int(form_data.get("installments") or 1)
        if form_data.get("issuer_id"):
            corpo["issuer_id"] = int(form_data["issuer_id"])

    if metodo == "bolbradesco":
        from datetime import datetime, timedelta, timezone

        vencimento = datetime.now(timezone.utc) + timedelta(days=3)
        corpo["date_of_expiration"] = vencimento.isoformat().replace("+00:00", "Z")

    if metodo == "pix" and "identification" not in payer:
        doc = payer_in.get("identification") or form_data.get("identification") or {}
        if doc.get("type") and doc.get("number"):
            payer["identification"] = {
                "type": doc["type"],
                "number": "".join(c for c in str(doc["number"]) if c.isdigit()),
            }

    return corpo
