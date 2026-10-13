#!/usr/bin/env python3
"""Aceite das Diretrizes da comunidade: obrigatório na compra e gravado com a loja."""
from __future__ import annotations

import sys
import types
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# --- stubs de deps pesadas (mesmo padrao dos outros testes do backend) ---
fake_psycopg2 = types.ModuleType("psycopg2")
fake_extras = types.ModuleType("psycopg2.extras")
fake_psycopg2.extras = fake_extras
sys.modules.setdefault("psycopg2", fake_psycopg2)
sys.modules.setdefault("psycopg2.extras", fake_extras)

fake_httpx = types.ModuleType("httpx")
fake_httpx.Client = MagicMock(side_effect=RuntimeError("httpx nao deve ser chamado"))
sys.modules.setdefault("httpx", fake_httpx)

if "app.db" not in sys.modules:
    fake_db = types.ModuleType("app.db")
    fake_db.consultar = MagicMock(return_value=[])
    fake_db.executar = MagicMock(return_value=0)
    fake_db.transacao = MagicMock()
    sys.modules["app.db"] = fake_db

from app.diretrizes import VERSAO_DIRETRIZES, validar_aceite_diretrizes  # noqa: E402
from app.errors import ErroNegocio  # noqa: E402
from app.services import loja_service, site_service  # noqa: E402

CPF_VALIDO = "52998224725"
ACEITE_ATUAL = {"aceito": True, "versao": VERSAO_DIRETRIZES}
LOJA = {"nome": "Mercado Teste", "email": "dono@exemplo.com", "cpf": CPF_VALIDO}
ADMIN = {
    "nome": "Maria",
    "sobrenome": "Silva",
    "usuario": "maria",
    "senha": "senha-forte-123",
    "email": "dono@exemplo.com",
}
CONFIG_PAGAMENTOS = SimpleNamespace(
    mp_access_token="token-de-teste",
    mp_public_key="chave-publica",
    assinatura_valor_mensal=99.9,
    assinatura_valor_semestral=499.9,
    assinatura_valor_anual=899.9,
)


class TestValidarAceite(unittest.TestCase):
    def test_sem_aceite_recusa(self):
        for aceite in (None, {}, {"aceito": False, "versao": VERSAO_DIRETRIZES}, "sim"):
            with self.subTest(aceite=aceite):
                with self.assertRaises(ErroNegocio) as ctx:
                    validar_aceite_diretrizes(aceite)
                self.assertEqual(ctx.exception.status, 400)

    def test_aceito_como_texto_nao_vale(self):
        with self.assertRaises(ErroNegocio):
            validar_aceite_diretrizes({"aceito": "true", "versao": VERSAO_DIRETRIZES})

    def test_versao_antiga_pede_novo_aceite(self):
        with self.assertRaises(ErroNegocio) as ctx:
            validar_aceite_diretrizes({"aceito": True, "versao": "2000-01-01"})
        self.assertEqual(ctx.exception.status, 409)

    def test_aceite_valido_limita_tamanho_dos_dados(self):
        registro = validar_aceite_diretrizes(
            ACEITE_ATUAL, ip="203.0.113.9" + "x" * 200, navegador="Mozilla/5.0 " + "y" * 900
        )
        self.assertEqual(registro["versao"], VERSAO_DIRETRIZES)
        self.assertLessEqual(len(registro["ip"]), 64)
        self.assertLessEqual(len(registro["navegador"]), 300)


class TestCompraExigeAceite(unittest.TestCase):
    def test_sem_aceite_nao_cria_loja(self):
        with patch.object(site_service, "criar_loja_com_admin") as criar:
            with self.assertRaises(ErroNegocio):
                site_service.comprar_pelo_site(loja=LOJA, admin=ADMIN, plano="teste")
            criar.assert_not_called()

    def test_teste_gratis_grava_aceite_com_a_loja(self):
        with patch.object(
            site_service, "criar_loja_com_admin", return_value={"lojaId": "loja-1", "codigo": "ABC234"}
        ) as criar, patch.object(site_service.db, "consultar", return_value=[]), patch.object(
            site_service.db, "executar", return_value=1
        ):
            resultado = site_service.comprar_pelo_site(
                loja=LOJA,
                admin=ADMIN,
                plano="teste",
                aceite_diretrizes=ACEITE_ATUAL,
                ip="203.0.113.9",
                navegador="Mozilla/5.0",
            )
        self.assertTrue(resultado["trial"])
        aceite = criar.call_args.kwargs["aceite_diretrizes"]
        self.assertEqual(
            aceite, {"versao": VERSAO_DIRETRIZES, "ip": "203.0.113.9", "navegador": "Mozilla/5.0"}
        )

    def test_plano_pago_grava_aceite_com_a_loja(self):
        with patch.object(site_service, "get_settings", return_value=CONFIG_PAGAMENTOS), patch.object(
            site_service, "criar_loja_com_admin", return_value={"lojaId": "loja-2", "codigo": "XYZ789"}
        ) as criar, patch.object(site_service.db, "executar", return_value=1), patch.object(
            site_service,
            "criar_checkout_assinatura",
            return_value={"checkoutUrl": "https://exemplo.invalid/checkout"},
        ):
            resultado = site_service.comprar_pelo_site(
                loja=LOJA,
                admin=ADMIN,
                plano="mensal",
                aceite_diretrizes=ACEITE_ATUAL,
                ip="198.51.100.4",
            )
        self.assertFalse(resultado["trial"])
        self.assertEqual(criar.call_args.kwargs["aceite_diretrizes"]["ip"], "198.51.100.4")


class TestLojaServiceGravaAceite(unittest.TestCase):
    def _criar_com_cursor_falso(self, aceite):
        cursor = MagicMock()
        cursor.fetchone.side_effect = [None, {"id": "loja-9"}]

        @contextmanager
        def transacao_falsa():
            yield cursor

        with patch.object(loja_service.db, "transacao", transacao_falsa):
            loja_service.criar_loja_com_admin(
                loja=LOJA,
                admin=ADMIN,
                aguardar_pagamento=True,
                cpf=CPF_VALIDO,
                aceite_diretrizes=aceite,
            )
        return [c.args for c in cursor.execute.call_args_list]

    def test_insere_aceite_na_mesma_transacao(self):
        aceite = {"versao": VERSAO_DIRETRIZES, "ip": "203.0.113.9", "navegador": "Mozilla/5.0"}
        chamadas = self._criar_com_cursor_falso(aceite)
        inserts = [c for c in chamadas if "aceites_diretrizes" in c[0]]
        self.assertEqual(len(inserts), 1)
        self.assertEqual(inserts[0][1], ("loja-9", VERSAO_DIRETRIZES, "203.0.113.9", "Mozilla/5.0"))

    def test_sem_aceite_nao_insere(self):
        chamadas = self._criar_com_cursor_falso(None)
        self.assertFalse([c for c in chamadas if "aceites_diretrizes" in c[0]])


if __name__ == "__main__":
    unittest.main()
