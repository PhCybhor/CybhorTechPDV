from __future__ import annotations

from typing import Any, Dict, List

from app.config import Settings, get_settings
from app.errors import ErroNegocio

PLANOS_BASE: Dict[str, Dict[str, Any]] = {
    "teste": {
        "id": "teste",
        "nome": "Teste gratis",
        "meses": 1,
        "dias": 30,
        "rotuloPeriodo": "/30 dias",
        "destaque": False,
        "gratis": True,
    },
    "mensal": {
        "id": "mensal",
        "nome": "Mensal",
        "meses": 1,
        "rotuloPeriodo": "/mes",
        "destaque": False,
    },
    "semestral": {
        "id": "semestral",
        "nome": "Semestral",
        "meses": 6,
        "rotuloPeriodo": "/6 meses",
        "destaque": True,
    },
    "anual": {
        "id": "anual",
        "nome": "Anual",
        "meses": 12,
        "rotuloPeriodo": "/ano",
        "destaque": False,
    },
}


def _valor_padrao(settings: Settings, plano_id: str) -> float:
    if plano_id == "teste":
        return 0.0
    if plano_id == "semestral":
        return settings.assinatura_valor_semestral
    if plano_id == "anual":
        return settings.assinatura_valor_anual
    return settings.assinatura_valor_mensal


def catalogo_planos(settings: Settings | None = None) -> List[Dict[str, Any]]:
    cfg = settings or get_settings()
    lista = []
    for plano_id, meta in PLANOS_BASE.items():
        item = dict(meta)
        item["valor"] = round(float(_valor_padrao(cfg, plano_id)), 2)
        item["gratis"] = bool(meta.get("gratis"))
        lista.append(item)
    return lista


def obter_plano(plano_id: str, settings: Settings | None = None) -> Dict[str, Any]:
    cfg = settings or get_settings()
    chave = (plano_id or "mensal").strip().lower()
    if chave not in PLANOS_BASE:
        raise ErroNegocio("Plano invalido. Escolha teste, mensal, semestral ou anual.")
    plano = dict(PLANOS_BASE[chave])
    plano["valor"] = round(float(_valor_padrao(cfg, chave)), 2)
    plano["gratis"] = bool(plano.get("gratis"))
    return plano
