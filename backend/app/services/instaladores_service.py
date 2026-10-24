"""Catalogo dos instaladores do CybhorPDV.

Fonte oficial dos .exe: Hostinger (https://pdv.cybhor.tech).
A VPS do integrator só espelha o catálogo e redireciona o download —
apps antigos ainda consultam a URL da VPS gravada no .exe.
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.errors import ErroNegocio

# Desde a 3.2 um instalador (Electron 22) atende Windows 7, 8, 10 e 11.
# Os win10/win7 continuam listados para as versoes antigas ainda publicadas.
INSTALADORES = (
    {
        "id": "windows-x64",
        "arquivo": "CybhorPDV-Setup-x64.exe",
        "rotulo": "Windows 7, 8, 10 e 11 (64 bits)",
        "so": "windows",
    },
    {
        "id": "windows-ia32",
        "arquivo": "CybhorPDV-Setup-ia32.exe",
        "rotulo": "Windows 7, 8, 10 e 11 (32 bits)",
        "so": "windows",
    },
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
# Links antigos sem versao (/api/site/baixar/<arquivo>) continuam entregando o mais novo.
SUBSTITUTOS_LEGADOS = {
    "CybhorPDV-Setup-win10-x64.exe": "CybhorPDV-Setup-x64.exe",
    "CybhorPDV-Setup-win7-x64.exe": "CybhorPDV-Setup-x64.exe",
    "CybhorPDV-Setup-win7-ia32.exe": "CybhorPDV-Setup-ia32.exe",
}
VERSAO_VALIDA = re.compile(r"^\d{1,3}\.\d{1,4}\.\d{1,4}$")
HOSTINGER_DOWNLOADS = "https://pdv.cybhor.tech"


def _base_publica_downloads() -> str:
    """Origem dos .exe (nunca a VPS do integrator)."""
    return (os.getenv("DOWNLOADS_PUBLIC_BASE") or HOSTINGER_DOWNLOADS).rstrip("/")


def _url_catalogo_remoto() -> str:
    """URL do JSON de catálogo. 'local' desliga o espelho (testes/dev)."""
    bruto = (os.getenv("DOWNLOADS_CATALOG_URL") or f"{HOSTINGER_DOWNLOADS}/api/site/downloads").strip()
    return bruto


def url_download_oficial(caminho_api: str) -> str:
    """Monta URL absoluta na Hostinger a partir de /api/site/baixar/..."""
    caminho = "/" + str(caminho_api or "").lstrip("/")
    return f"{_base_publica_downloads()}{caminho}"


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


def _com_urls_absolutas(bloco: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not bloco:
        return bloco
    instaladores = []
    for item in bloco.get("instaladores") or []:
        url = str(item.get("url") or "")
        if url.startswith("http://") or url.startswith("https://"):
            instaladores.append(item)
            continue
        instaladores.append({**item, "url": url_download_oficial(url)})
    return {**bloco, "instaladores": instaladores}


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
                "url": url_download_oficial(f"/api/site/baixar/{versao}/{item['arquivo']}"),
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
            "url": url_download_oficial(f"/api/site/baixar/{item['arquivo']}"),
        }
        for item in INSTALADORES
        if (pasta / item["arquivo"]).is_file()
    ]
    if not instaladores:
        return None
    return {"versao": None, "publicado_em": None, "instaladores": instaladores}


def _catalogo_remoto() -> Optional[Dict[str, Any]]:
    origem = _url_catalogo_remoto()
    if not origem or origem.lower() == "local":
        return None
    try:
        pedido = urllib.request.Request(
            origem,
            headers={"Accept": "application/json", "User-Agent": "CybhorPDV-VPS-catalog/1"},
        )
        with urllib.request.urlopen(pedido, timeout=8) as resposta:
            dados = json.loads(resposta.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, OSError):
        return None
    if not isinstance(dados, dict) or not dados.get("atual", {}).get("versao"):
        return None
    atual = _com_urls_absolutas(dados.get("atual"))
    anteriores = [_com_urls_absolutas(item) for item in (dados.get("anteriores") or [])]
    anteriores = [item for item in anteriores if item]
    return {
        "ok": True,
        "atual": atual,
        "anteriores": anteriores,
        "instaladores": atual["instaladores"] if atual else [],
    }


def listar_instaladores() -> Dict[str, Any]:
    """Versao atual em destaque — preferindo o catálogo oficial da Hostinger."""
    remoto = _catalogo_remoto()
    if remoto:
        return remoto

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
        substituto = pasta / SUBSTITUTOS_LEGADOS.get(nome, nome)
        if substituto.is_file():
            caminho = substituto
    else:
        if not VERSAO_VALIDA.match(versao or ""):
            raise ErroNegocio("Versao invalida.", 404)
        caminho = pasta / "versoes" / versao / nome

    if not caminho.is_file():
        raise ErroNegocio("Instalador ainda nao publicado neste servidor.", 404)
    return caminho
