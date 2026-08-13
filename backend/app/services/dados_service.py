from __future__ import annotations

import copy
import json
from typing import Any, Dict, List, Sequence

import psycopg2.extras

from app import db
from app.errors import ErroNegocio

TAMANHO_MAX_DOCUMENTO = 256 * 1024


def _normalizar_caminho(loja_id: str, caminho: str) -> List[str]:
    partes = [p for p in str(caminho or "").strip("/").split("/") if p]
    if len(partes) >= 2 and partes[0] == "lojas":
        if partes[1] != loja_id:
            raise ErroNegocio("Acesso a outra loja nao permitido.", 403)
        partes = partes[2:]
    if not partes:
        raise ErroNegocio("Caminho de dados invalido.")
    if any(len(p) > 128 or p in (".", "..") for p in partes):
        raise ErroNegocio("Caminho de dados invalido.")
    return partes


def _buscar_no_documento(documento: Any, partes: Sequence[str]) -> Any:
    atual = documento
    for parte in partes:
        if not isinstance(atual, dict) or parte not in atual:
            return None
        atual = atual[parte]
    return atual


def _definir_no_documento(
    documento: Dict[str, Any], partes: Sequence[str], valor: Any
) -> None:
    atual = documento
    for parte in partes[:-1]:
        proximo = atual.get(parte)
        if not isinstance(proximo, dict):
            proximo = {}
            atual[parte] = proximo
        atual = proximo
    if valor is None:
        atual.pop(partes[-1], None)
    else:
        atual[partes[-1]] = valor


def _mesclar_no_documento(
    documento: Dict[str, Any], partes: Sequence[str], patch: Dict[str, Any]
) -> None:
    existente = _buscar_no_documento(documento, partes)
    base = dict(existente) if isinstance(existente, dict) else {}
    for chave, valor in patch.items():
        if valor is None:
            base.pop(chave, None)
        else:
            base[chave] = valor
    _definir_no_documento(documento, partes, base)


def _carregar_recurso(cur, loja_id: str, recurso: str) -> Dict[str, Any]:
    cur.execute(
        """
        SELECT dados FROM documentos_loja
        WHERE loja_id = %s AND recurso = %s
        FOR UPDATE
        """,
        (loja_id, recurso),
    )
    row = cur.fetchone()
    if not row or not isinstance(row["dados"], dict):
        return {}
    return copy.deepcopy(row["dados"])


def _salvar_recurso(cur, loja_id: str, recurso: str, dados: Dict[str, Any]) -> None:
    serializado = json.dumps(dados, default=str)
    if len(serializado.encode("utf-8")) > TAMANHO_MAX_DOCUMENTO:
        raise ErroNegocio("Documento grande demais.", 413)
    cur.execute(
        """
        INSERT INTO documentos_loja (loja_id, recurso, dados)
        VALUES (%s, %s, %s)
        ON CONFLICT (loja_id, recurso)
        DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = now()
        """,
        (loja_id, recurso, psycopg2.extras.Json(dados)),
    )


def obter(loja_id: str, caminho: str) -> Any:
    partes = _normalizar_caminho(loja_id, caminho)
    rows = db.consultar(
        "SELECT dados FROM documentos_loja WHERE loja_id = %s AND recurso = %s",
        (loja_id, partes[0]),
    )
    documento = rows[0]["dados"] if rows else {}
    if len(partes) == 1:
        return documento
    return _buscar_no_documento(documento, partes[1:])


def definir(loja_id: str, caminho: str, valor: Any) -> None:
    partes = _normalizar_caminho(loja_id, caminho)
    with db.transacao() as cur:
        if len(partes) == 1:
            documento = valor if isinstance(valor, dict) else {"valor": valor}
        else:
            documento = _carregar_recurso(cur, loja_id, partes[0])
            _definir_no_documento(documento, partes[1:], valor)
        _salvar_recurso(cur, loja_id, partes[0], documento)


def mesclar(loja_id: str, caminho: str, patch: Dict[str, Any]) -> None:
    if not isinstance(patch, dict):
        raise ErroNegocio("Atualizacao de dados invalida.")
    partes = _normalizar_caminho(loja_id, caminho)
    with db.transacao() as cur:
        documento = _carregar_recurso(cur, loja_id, partes[0])
        if len(partes) == 1:
            for chave, valor in patch.items():
                _definir_no_documento(documento, [chave], valor)
        else:
            _mesclar_no_documento(documento, partes[1:], patch)
        _salvar_recurso(cur, loja_id, partes[0], documento)


def remover(loja_id: str, caminho: str) -> None:
    partes = _normalizar_caminho(loja_id, caminho)
    with db.transacao() as cur:
        if len(partes) == 1:
            cur.execute(
                "DELETE FROM documentos_loja WHERE loja_id = %s AND recurso = %s",
                (loja_id, partes[0]),
            )
            return
        documento = _carregar_recurso(cur, loja_id, partes[0])
        _definir_no_documento(documento, partes[1:], None)
        _salvar_recurso(cur, loja_id, partes[0], documento)


def atualizar_lote(loja_id: str, atualizacoes: Dict[str, Any]) -> None:
    if not isinstance(atualizacoes, dict) or len(atualizacoes) > 500:
        raise ErroNegocio("Lote de atualizacoes invalido.")

    por_recurso: Dict[str, List[tuple]] = {}
    for caminho, valor in atualizacoes.items():
        partes = _normalizar_caminho(loja_id, caminho)
        por_recurso.setdefault(partes[0], []).append((partes[1:], valor))

    with db.transacao() as cur:
        for recurso, operacoes in por_recurso.items():
            documento = _carregar_recurso(cur, loja_id, recurso)
            for subpartes, valor in operacoes:
                if not subpartes:
                    documento = valor if isinstance(valor, dict) else {"valor": valor}
                else:
                    _definir_no_documento(documento, subpartes, valor)
            _salvar_recurso(cur, loja_id, recurso, documento)
