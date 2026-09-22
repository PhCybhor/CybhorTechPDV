#!/usr/bin/env python3
"""Baixa/devolução de estoque atômica no caixa (documentos_loja)."""
from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

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

from app.services import caixa_service, dados_service  # noqa: E402
from app.errors import ErroNegocio  # noqa: E402


class TestFinalizarVendaAtomica(unittest.TestCase):
    def setUp(self):
        self.loja = "11111111-1111-1111-1111-111111111111"
        self.estado = {
            "produtos": {
                "p1": {"nome": "Arroz", "preco": 10, "estoque": 5},
                "p2": {"nome": "Feijao", "preco": 8, "estoque": 2},
            },
            "vendas": {},
        }
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

    def test_baixa_estoque_e_registra_venda(self):
        venda = caixa_service.finalizar_venda(
            self.loja,
            {"id": "f1", "nome": "Caixa"},
            {
                "itens": [
                    {
                        "produtoId": "p1",
                        "quantidade": 2,
                        "precoUnitario": 10,
                    }
                ],
                "formaPagamento": "dinheiro",
                "desconto": 0,
            },
        )
        self.assertEqual(self.estado["produtos"]["p1"]["estoque"], 3)
        self.assertIn(venda["id"], self.estado["vendas"])
        self.assertEqual(venda["total"], 20)

    def test_recusa_estoque_insuficiente(self):
        with self.assertRaises(ErroNegocio):
            caixa_service.finalizar_venda(
                self.loja,
                {"id": "f1", "nome": "Caixa"},
                {
                    "itens": [
                        {"produtoId": "p2", "quantidade": 9, "precoUnitario": 8}
                    ],
                    "formaPagamento": "pix",
                },
            )
        self.assertEqual(self.estado["produtos"]["p2"]["estoque"], 2)
        self.assertEqual(self.estado["vendas"], {})

    def test_duas_vendas_sequenciais_nao_sobreescrevem_estoque(self):
        caixa_service.finalizar_venda(
            self.loja,
            {"id": "f1", "nome": "A"},
            {
                "itens": [{"produtoId": "p1", "quantidade": 2, "precoUnitario": 10}],
                "formaPagamento": "dinheiro",
            },
        )
        caixa_service.finalizar_venda(
            self.loja,
            {"id": "f2", "nome": "B"},
            {
                "itens": [{"produtoId": "p1", "quantidade": 2, "precoUnitario": 10}],
                "formaPagamento": "pix",
            },
        )
        self.assertEqual(self.estado["produtos"]["p1"]["estoque"], 1)
        self.assertEqual(len(self.estado["vendas"]), 2)

    def test_cancelar_devolve_estoque(self):
        venda = caixa_service.finalizar_venda(
            self.loja,
            {"id": "f1", "nome": "A"},
            {
                "itens": [{"produtoId": "p1", "quantidade": 3, "precoUnitario": 10}],
                "formaPagamento": "dinheiro",
            },
        )
        self.assertEqual(self.estado["produtos"]["p1"]["estoque"], 2)
        caixa_service.cancelar_venda(
            self.loja,
            venda_id=venda["id"],
            motivo="teste",
            cancelado_por_nome="admin",
        )
        self.assertEqual(self.estado["produtos"]["p1"]["estoque"], 5)
        self.assertTrue(self.estado["vendas"][venda["id"]]["cancelada"])

    def test_cancelar_duas_vezes_nao_duplica_estoque(self):
        venda = caixa_service.finalizar_venda(
            self.loja,
            {"id": "f1", "nome": "A"},
            {
                "itens": [{"produtoId": "p1", "quantidade": 2, "precoUnitario": 10}],
                "formaPagamento": "dinheiro",
            },
        )
        caixa_service.cancelar_venda(
            self.loja,
            venda_id=venda["id"],
            motivo="1",
            cancelado_por_nome="admin",
        )
        self.assertEqual(self.estado["produtos"]["p1"]["estoque"], 5)
        with self.assertRaises(ErroNegocio):
            caixa_service.cancelar_venda(
                self.loja,
                venda_id=venda["id"],
                motivo="2",
                cancelado_por_nome="admin",
            )
        self.assertEqual(self.estado["produtos"]["p1"]["estoque"], 5)


if __name__ == "__main__":
    unittest.main()
