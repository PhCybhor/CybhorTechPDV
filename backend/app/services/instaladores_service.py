"""Catalogo dos instaladores do CybhorPDV publicados no servidor.

Layout mantido pelo script de publicacao da VPS (backend/deploy):
    downloads/versoes/<versao>/CybhorPDV-Setup-*.exe
    downloads/versoes/<versao>/info.json      {"versao", "publicado_em"}
    downloads/CybhorPDV-Setup-*.exe           hardlinks da versao mais nova
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.errors import ErroNegocio

INSTALADORES = (
    {
        "id": "win10-x64",
        "arquivo": "CybhorPDV-Setup-win10-x64.exe",
        "rotulo": "Windows 10 / 11 (64 bits)",
        "so": "win10",
    },
    {
        "id": "win7-x64",
        "arquivo": "CybhorPDV-Setup-win7-x64.exe",
        "rotulo": "Windows 7 (64 bits)",
        "so": "win7",
    },
    {
        "id": "win7-ia32",
        "arquivo": "CybhorPDV-Setup-win7-ia32.exe",
        "rotulo": "Windows 7 (32 bits)",
        "so": "win7",
    },
)

ARQUIVOS_PERMITIDOS = frozenset(item["arquivo"] for item in INSTALADORES)
VERSAO_VALIDA = re.compile(r"^\d{1,3}\.\d{1,4}\.\d{1,4}$")


def _pasta_downloads() -> Path:
    candidatos = (
        Path("/app/downloads"),
        Path(__file__).resolve().parents[2] / "downloads",
        Path("/home/cybhorpdv/downloads"),
    )
    for pasta in candidatos:
        if pasta.is_dir():
            return pasta
    return candidatos[0]


def _chave_versao(versao: str) -> tuple:
    return tuple(int(parte) for parte in versao.split("."))


def _versoes_publicadas(pasta_versoes: Path) -> List[str]:
    """Versoes em disco, da mais nova para a mais antiga."""
    if not pasta_versoes.is_dir():
        return []
    versoes = [
        item.name
        for item in pasta_versoes.iterdir()
        if item.is_dir() and VERSAO_VALIDA.match(item.name)
    ]
    return sorted(versoes, key=_chave_versao, reverse=True)


def _data_publicacao(pasta_versao: Path) -> str:
    try:
        info = json.loads((pasta_versao / "info.json").read_text(encoding="utf-8"))
        publicado_em = info.get("publicado_em")
        if isinstance(publicado_em, str):
            return datetime.fromisoformat(publicado_em).isoformat()
    except (OSError, ValueError, AttributeError):
        pass
    # Pastas antigas ou info.json corrompido: a data do diretorio e uma boa aproximacao.
    return datetime.fromtimestamp(pasta_versao.stat().st_mtime, tz=timezone.utc).isoformat()


def _montar_versao(pasta_versao: Path, versao: str) -> Optional[Dict[str, Any]]:
    instaladores = []
    for item in INSTALADORES:
        arquivo = pasta_versao / item["arquivo"]
        if not arquivo.is_file():
            continue
        instaladores.append(
            {
                **item,
                "tamanho_bytes": arquivo.stat().st_size,
                "url": f"/api/site/baixar/{versao}/{item['arquivo']}",
            }
        )
    if not instaladores:
        return None
    return {
        "versao": versao,
        "publicado_em": _data_publicacao(pasta_versao),
        "instaladores": instaladores,
    }


def _montar_avulsos(pasta: Path) -> Optional[Dict[str, Any]]:
    """Instaladores soltos na raiz (servidor ainda sem pasta versoes/)."""
    instaladores = [
        {
            **item,
            "tamanho_bytes": (pasta / item["arquivo"]).stat().st_size,
            "url": f"/api/site/baixar/{item['arquivo']}",
        }
        for item in INSTALADORES
        if (pasta / item["arquivo"]).is_file()
    ]
    if not instaladores:
        return None
    return {"versao": None, "publicado_em": None, "instaladores": instaladores}


def listar_instaladores() -> Dict[str, Any]:
    """Versao atual em destaque e as anteriores (mais nova primeiro)."""
    pasta = _pasta_downloads()
    pasta_versoes = pasta / "versoes"
    versoes = [
        montada
        for versao in _versoes_publicadas(pasta_versoes)
        if (montada := _montar_versao(pasta_versoes / versao, versao))
    ]
    atual = versoes[0] if versoes else _montar_avulsos(pasta)
    return {
        "ok": True,
        "atual": atual,
        "anteriores": versoes[1:],
        "instaladores": atual["instaladores"] if atual else [],
    }


def caminho_instalador(arquivo: str, versao: Optional[str] = None) -> Path:
    """Resolve o arquivo pedido; sem versao entrega o mais novo publicado."""
    nome = Path(arquivo or "").name
    if nome != arquivo or nome not in ARQUIVOS_PERMITIDOS:
        raise ErroNegocio("Arquivo invalido.", 404)

    pasta = _pasta_downloads()
    if versao is None:
        caminho = pasta / nome
    else:
        if not VERSAO_VALIDA.match(versao or ""):
            raise ErroNegocio("Versao invalida.", 404)
        caminho = pasta / "versoes" / versao / nome

    if not caminho.is_file():
        raise ErroNegocio("Instalador ainda nao publicado neste servidor.", 404)
    return caminho
