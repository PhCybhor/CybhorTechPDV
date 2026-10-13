"""Diretrizes da comunidade: versão vigente e validação do aceite na compra."""
from __future__ import annotations

from typing import Any, Dict

from app.errors import ErroNegocio

# Mudou o texto de landing/diretrizes.html? Troque a versão aqui e em
# landing/cadastro.js: quem estiver com a página antiga aberta precisa aceitar de novo.
VERSAO_DIRETRIZES = "2026-10-13"

TAMANHO_MAX_IP = 64
TAMANHO_MAX_NAVEGADOR = 300


def validar_aceite_diretrizes(
    aceite: Any, *, ip: str = "", navegador: str = ""
) -> Dict[str, str]:
    """Exige o aceite da versão vigente e devolve o registro a ser gravado.

    Args:
        aceite: corpo enviado pelo site, no formato {"aceito": true, "versao": "..."}.
        ip: IP do cliente (já resolvido atrás do proxy).
        navegador: cabeçalho User-Agent, guardado como prova do aceite.
    """
    dados: Dict[str, Any] = aceite if isinstance(aceite, dict) else {}
    if dados.get("aceito") is not True:
        raise ErroNegocio("Para continuar, aceite as Diretrizes da comunidade.")
    if str(dados.get("versao") or "").strip() != VERSAO_DIRETRIZES:
        raise ErroNegocio(
            "As Diretrizes da comunidade foram atualizadas. Recarregue a página e aceite a versão atual.",
            409,
        )
    return {
        "versao": VERSAO_DIRETRIZES,
        "ip": (ip or "").strip()[:TAMANHO_MAX_IP],
        "navegador": (navegador or "").strip()[:TAMANHO_MAX_NAVEGADOR],
    }
