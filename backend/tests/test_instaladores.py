#!/usr/bin/env python3
"""Catalogo de instaladores: versao atual, anteriores e download seguro."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.errors import ErroNegocio  # noqa: E402
from app.services import instaladores_service  # noqa: E402

WIN10 = "CybhorPDV-Setup-win10-x64.exe"
WIN7_32 = "CybhorPDV-Setup-win7-ia32.exe"


class InstaladoresTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.pasta = Path(self._tmp.name)
        patcher = patch.object(
            instaladores_service, "_pasta_downloads", return_value=self.pasta
        )
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)

    def _publicar(self, versao: str, *arquivos: str, publicado_em: str = "") -> Path:
        pasta_versao = self.pasta / "versoes" / versao
        pasta_versao.mkdir(parents=True)
        for nome in arquivos:
            (pasta_versao / nome).write_bytes(b"MZ" + versao.encode())
        if publicado_em:
            (pasta_versao / "info.json").write_text(
                json.dumps({"versao": versao, "publicado_em": publicado_em}),
                encoding="utf-8",
            )
        return pasta_versao

    def test_versao_mais_nova_em_destaque_e_anteriores_em_ordem(self) -> None:
        self._publicar("2.1.5", WIN10)
        self._publicar("2.1.13", WIN10, WIN7_32, publicado_em="2026-09-24T17:08:26+00:00")
        self._publicar("2.1.4", WIN10)

        dados = instaladores_service.listar_instaladores()

        self.assertEqual(dados["atual"]["versao"], "2.1.13")
        self.assertEqual(dados["atual"]["publicado_em"], "2026-09-24T17:08:26+00:00")
        self.assertEqual([v["versao"] for v in dados["anteriores"]], ["2.1.5", "2.1.4"])
        self.assertEqual(
            [i["url"] for i in dados["instaladores"]],
            [f"/api/site/baixar/2.1.13/{WIN10}", f"/api/site/baixar/2.1.13/{WIN7_32}"],
        )

    def test_ignora_pastas_invalidas_e_versoes_sem_instalador(self) -> None:
        self._publicar("2.1.13", WIN10)
        self._publicar("2.2.0")
        (self.pasta / "versoes" / "..lixo").mkdir()
        (self.pasta / "versoes" / "2.1.13" / "virus.exe").write_bytes(b"MZ")

        dados = instaladores_service.listar_instaladores()

        self.assertEqual(dados["atual"]["versao"], "2.1.13")
        self.assertEqual(dados["anteriores"], [])
        self.assertEqual([i["arquivo"] for i in dados["instaladores"]], [WIN10])

    def test_sem_pasta_versoes_usa_arquivos_soltos(self) -> None:
        (self.pasta / WIN10).write_bytes(b"MZ")

        dados = instaladores_service.listar_instaladores()

        self.assertIsNone(dados["atual"]["versao"])
        self.assertEqual(dados["instaladores"][0]["url"], f"/api/site/baixar/{WIN10}")

    def test_sem_nada_publicado(self) -> None:
        dados = instaladores_service.listar_instaladores()

        self.assertIsNone(dados["atual"])
        self.assertEqual(dados["instaladores"], [])

    def test_caminho_por_versao(self) -> None:
        pasta_versao = self._publicar("2.1.5", WIN10)

        caminho = instaladores_service.caminho_instalador(WIN10, "2.1.5")

        self.assertEqual(caminho, pasta_versao / WIN10)

    def test_bloqueia_traversal_e_arquivos_fora_da_lista(self) -> None:
        self._publicar("2.1.5", WIN10)
        casos = (
            (f"../{WIN10}", "2.1.5"),
            ("outro.exe", "2.1.5"),
            (WIN10, ".."),
            (WIN10, "2.1.5/../.."),
            (WIN10, "9.9.9"),
        )
        for arquivo, versao in casos:
            with self.subTest(arquivo=arquivo, versao=versao):
                with self.assertRaises(ErroNegocio) as erro:
                    instaladores_service.caminho_instalador(arquivo, versao)
                self.assertEqual(erro.exception.status, 404)


if __name__ == "__main__":
    unittest.main()
