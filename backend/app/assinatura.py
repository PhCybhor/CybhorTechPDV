"""Regras de assinatura mensal (SaaS).

Politica do produto (Pedro):
- Atraso / inadimplencia / validade vencida: sistema CONTINUA LIBERADO,
  com aviso claro (admin + loja) de que sera bloqueado em breve.
- Bloqueio duro so para quem nunca pagou (pendente) ou cancelou.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, Optional

# Status que ainda bloqueiam acesso (nunca liberou ou encerrou de vez).
STATUS_BLOQUEADOS = frozenset({"pendente", "cancelada"})

# Status com acesso liberado + aviso de atraso.
STATUS_ATRASADOS = frozenset({"inadimplente"})

MENSAGEM_ATRASO = (
    "Assinatura atrasada. Renove para evitar bloqueio."
)
MENSAGEM_PENDENTE = (
    "Assinatura pendente. Conclua o pagamento para liberar o sistema."
)
MENSAGEM_CANCELADA = (
    "Assinatura cancelada. Contrate novamente para continuar."
)
MENSAGEM_AUSENTE = (
    "Assinatura nao encontrada. Fale com o suporte."
)


def _como_date(valor: Any) -> Optional[date]:
    if valor is None:
        return None
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    texto = str(valor).strip()
    if not texto:
        return None
    try:
        return date.fromisoformat(texto[:10])
    except ValueError:
        return None


def avaliar_assinatura(
    status: Optional[str],
    valida_ate: Any = None,
    *,
    hoje: Optional[date] = None,
) -> Dict[str, Any]:
    """Classifica a assinatura: bloqueada, atrasada ou em dia."""
    ref = hoje or date.today()
    status_norm = (status or "").strip().lower() or None
    validade = _como_date(valida_ate)

    if not status_norm:
        return {
            "bloqueada": True,
            "atrasada": False,
            "status": None,
            "statusExibicao": "ausente",
            "validaAte": str(validade) if validade else None,
            "rotulo": "Sem assinatura",
            "mensagem": MENSAGEM_AUSENTE,
        }

    if status_norm in STATUS_BLOQUEADOS:
        mensagem = (
            MENSAGEM_PENDENTE if status_norm == "pendente" else MENSAGEM_CANCELADA
        )
        rotulo = "Pendente" if status_norm == "pendente" else "Cancelada"
        return {
            "bloqueada": True,
            "atrasada": False,
            "status": status_norm,
            "statusExibicao": status_norm,
            "validaAte": str(validade) if validade else None,
            "rotulo": rotulo,
            "mensagem": mensagem,
        }

    vencida = validade is not None and validade < ref
    atrasada = status_norm in STATUS_ATRASADOS or vencida

    if atrasada:
        return {
            "bloqueada": False,
            "atrasada": True,
            "status": status_norm,
            "statusExibicao": "atrasada",
            "validaAte": str(validade) if validade else None,
            "rotulo": "Atrasada",
            "mensagem": MENSAGEM_ATRASO,
        }

    return {
        "bloqueada": False,
        "atrasada": False,
        "status": status_norm,
        "statusExibicao": status_norm,
        "validaAte": str(validade) if validade else None,
        "rotulo": "Ativa",
        "mensagem": "",
    }


def exigir_acesso_assinatura(status: Optional[str], valida_ate: Any = None) -> Dict[str, Any]:
    """Retorna a situacao; levanta ValueError se bloqueada (caller mapeia p/ HTTP)."""
    situacao = avaliar_assinatura(status, valida_ate)
    if situacao["bloqueada"]:
        raise ValueError(situacao["mensagem"])
    return situacao


def deve_estender_assinatura(status_anterior: Optional[str], status_novo: Optional[str]) -> bool:
    """True so na primeira aprovacao do payment_id (evita reprocessar webhook)."""
    if (status_novo or "").lower() != "approved":
        return False
    return (status_anterior or "").lower() != "approved"


def deve_marcar_inadimplente(status_anterior: Optional[str], status_novo: Optional[str]) -> bool:
    """Estorno/chargeback apos aprovacao -> inadimplente (acesso segue com aviso)."""
    novo = (status_novo or "").lower()
    if novo not in {"refunded", "charged_back", "cancelled"}:
        return False
    return (status_anterior or "").lower() == "approved"
