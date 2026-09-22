#!/usr/bin/env python3
"""Testes unitários do armazenamento de vendas (documentos_loja)."""
from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Evita depender de psycopg2 instalado no host de teste.
fake_psycopg2 = types.ModuleType("psycopg2")
fake_extras = types.ModuleType("psycopg2.extras")


class _Json:
    def __init__(self, dados):
        self.dados = dados


fake_extras.Json = _Json
fake_psycopg2.extras = fake_extras
sys.modules["psycopg2"] = fake_psycopg2
sys.modules["psycopg2.extras"] = fake_extras

fake_db = types.ModuleType("app.db")
fake_db.consultar = MagicMock(return_value=[])
fake_db.executar = MagicMock(return_value=0)
fake_db.transacao = MagicMock()
sys.modules["app.db"] = fake_db

from app.services import dados_service  # noqa: E402


class TestNormalizacaoVendas(unittest.TestCase):
    def test_venda_solta_na_raiz_vira_mapa(self):
        bruto = {
            "itens": [{"nome": "Arroz", "quantidade": 1}],
            "total": 10.5,
            "criadoEm": 1700000000000,
            "formaPagamento": "dinheiro",
        }
        normalizado = dados_service._normalizar_mapa_registros(bruto)
        self.assertIn("legado", normalizado)
        self.assertEqual(normalizado["legado"]["total"], 10.5)
        self.assertNotIn("itens", normalizado)

    def test_chave_undefined_migrada(self):
        bruto = {
            "undefined": {
                "itens": [],
                "total": 7,
                "criadoEm": 1700000001000,
            }
        }
        normalizado = dados_service._normalizar_mapa_registros(bruto)
        self.assertNotIn("undefined", normalizado)
        self.assertEqual(normalizado["legado"]["total"], 7)

    def test_mapa_saudavel_preservado(self):
        bruto = {
            "abc123": {"itens": [], "total": 1, "criadoEm": 1},
            "def456": {"itens": [], "total": 2, "criadoEm": 2},
        }
        normalizado = dados_service._normalizar_mapa_registros(bruto)
        self.assertEqual(set(normalizado.keys()), {"abc123", "def456"})


class TestAtualizarLoteVendas(unittest.TestCase):
    def setUp(self):
        self.loja_id = "11111111-1111-1111-1111-111111111111"
        self.estado = {"vendas": {}, "produtos": {}}
        self._orig_transacao = dados_service.db.transacao
        self._orig_carregar = dados_service._carregar_recurso
        self._orig_salvar = dados_service._salvar_recurso

        class CursorFake:
            def execute(self, sql, params=None):
                self.sql = sql

            def fetchone(self_inner):
                return None

        cur = CursorFake()

        class Tx:
            def __enter__(self_inner):
                return cur

            def __exit__(self_inner, *args):
                return False

        dados_service.db.transacao = lambda: Tx()
        dados_service._carregar_recurso = (
            lambda _c, _l, recurso: self.estado.setdefault(recurso, {})
        )
        dados_service._salvar_recurso = (
            lambda _c, _l, recurso, dados: self.estado.__setitem__(recurso, dados)
        )

    def tearDown(self):
        dados_service.db.transacao = self._orig_transacao
        dados_service._carregar_recurso = self._orig_carregar
        dados_service._salvar_recurso = self._orig_salvar

    def test_duas_vendas_acumulam_no_mesmo_recurso(self):
        loja_id = self.loja_id
        dados_service.atualizar_lote(
            loja_id,
            {
                f"lojas/{loja_id}/vendas/venda1": {
                    "itens": [],
                    "total": 10,
                    "criadoEm": 1,
                },
                f"lojas/{loja_id}/produtos/p1/estoque": 5,
            },
        )
        dados_service.atualizar_lote(
            loja_id,
            {
                f"lojas/{loja_id}/vendas/venda2": {
                    "itens": [],
                    "total": 20,
                    "criadoEm": 2,
                },
                f"lojas/{loja_id}/produtos/p1/estoque": 4,
            },
        )

        self.assertEqual(set(self.estado["vendas"].keys()), {"venda1", "venda2"})
        self.assertEqual(self.estado["vendas"]["venda1"]["total"], 10)
        self.assertEqual(self.estado["vendas"]["venda2"]["total"], 20)
        self.assertEqual(self.estado["produtos"]["p1"]["estoque"], 4)

    def test_chave_undefined_recebe_id_novo(self):
        loja_id = self.loja_id
        dados_service.atualizar_lote(
            loja_id,
            {
                f"lojas/{loja_id}/vendas/undefined": {
                    "itens": [],
                    "total": 33,
                    "criadoEm": 9,
                }
            },
        )
        self.assertEqual(len(self.estado["vendas"]), 1)
        chave = next(iter(self.estado["vendas"]))
        self.assertNotEqual(chave, "undefined")
        self.assertEqual(self.estado["vendas"][chave]["total"], 33)


if __name__ == "__main__":
    unittest.main()
