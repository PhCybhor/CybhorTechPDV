from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import jwt
from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel

from app.config import get_settings


class AuthLoja(BaseModel):
    loja_id: str
    funcionario_id: str
    cargo: str
    nome: str


class AuthAdminSistema(BaseModel):
    id: str
    email: str


def _parse_expiracao(valor: str) -> timedelta:
    """Converte '12h', '7d', '30m' ou segundos numéricos em timedelta."""
    texto = (valor or "12h").strip().lower()
    if texto.endswith("h"):
        return timedelta(hours=int(texto[:-1] or 12))
    if texto.endswith("d"):
        return timedelta(days=int(texto[:-1] or 1))
    if texto.endswith("m"):
        return timedelta(minutes=int(texto[:-1] or 30))
    if texto.endswith("s"):
        return timedelta(seconds=int(texto[:-1] or 3600))
    return timedelta(seconds=int(texto))


def emitir_token(payload: Dict[str, Any]) -> str:
    settings = get_settings()
    corpo = dict(payload)
    corpo["iat"] = datetime.now(timezone.utc)
    corpo["exp"] = datetime.now(timezone.utc) + _parse_expiracao(settings.jwt_expiracao)
    return jwt.encode(corpo, settings.jwt_segredo, algorithm="HS256")


def _extrair_bearer(authorization: Optional[str]) -> str:
    if not authorization:
        raise HTTPException(status_code=401, detail="Token ausente.")
    partes = authorization.split(" ", 1)
    if len(partes) != 2 or partes[0] != "Bearer" or not partes[1]:
        raise HTTPException(status_code=401, detail="Token ausente.")
    return partes[1]


def _decodificar(token: str) -> Dict[str, Any]:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_segredo, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Sessao invalida ou expirada.")


def autenticar_loja(authorization: Optional[str] = Header(default=None)) -> AuthLoja:
    payload = _decodificar(_extrair_bearer(authorization))
    if payload.get("tipo") != "loja":
        raise HTTPException(status_code=401, detail="Sessao invalida ou expirada.")
    loja_id = payload.get("lojaId")
    funcionario_id = payload.get("funcionarioId")
    cargo = payload.get("cargo")
    nome = payload.get("nome")
    if not loja_id or not funcionario_id or not cargo or nome is None:
        raise HTTPException(status_code=401, detail="Sessao invalida ou expirada.")
    return AuthLoja(
        loja_id=str(loja_id),
        funcionario_id=str(funcionario_id),
        cargo=str(cargo),
        nome=str(nome),
    )


def exigir_admin_loja(auth: AuthLoja = Depends(autenticar_loja)) -> AuthLoja:
    if auth.cargo != "admin":
        raise HTTPException(
            status_code=403,
            detail="Apenas o administrador da loja pode fazer isso.",
        )
    return auth


def autenticar_admin_sistema(
    authorization: Optional[str] = Header(default=None),
) -> AuthAdminSistema:
    payload = _decodificar(_extrair_bearer(authorization))
    if payload.get("tipo") != "admin-sistema":
        raise HTTPException(status_code=401, detail="Sessao invalida ou expirada.")
    admin_id = payload.get("adminId")
    email = payload.get("email")
    if not admin_id or not email:
        raise HTTPException(status_code=401, detail="Sessao invalida ou expirada.")
    return AuthAdminSistema(id=str(admin_id), email=str(email))