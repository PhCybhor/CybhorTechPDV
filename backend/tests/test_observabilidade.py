#!/usr/bin/env python3
"""Observabilidade: log do webhook MP + ping DB do /api/saude."""
from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

fake_psycopg2 = types.ModuleType("psycopg2")
fake_extras = types.ModuleType("psycopg2.extras")
fake_psycopg2.extras = fake_extras
sys.modules.setdefault("psycopg2", fake_psycopg2)
sys.modules.setdefault("psycopg2.extras", fake_extras)

fake_httpx = types.ModuleType("httpx")


class _FakeClient:
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def request(self, *args, **kwargs):
        raise RuntimeError("httpx nao deve ser chamado neste teste")


fake_httpx.Client = _FakeClient
sys.modules.setdefault("httpx", fake_httpx)

fake_pydantic = types.ModuleType("pydantic")


def _Field(default="", **kwargs):
    return default


fake_pydantic.Field = _Field
sys.modules.setdefault("pydantic", fake_pydantic)

fake_pydantic_settings = types.ModuleType("pydantic_settings")


class _BaseSettings:
    def __init__(self, **kwargs):
        for chave, valor in kwargs.items():
            setattr(self, chave, valor)


def _SettingsConfigDict(**kwargs):
    return {}


fake_pydantic_settings.BaseSettings = _BaseSettings
fake_pydantic_settings.SettingsConfigDict = _SettingsConfigDict
sys.modules.setdefault("pydantic_settings", fake_pydantic_settings)

fake_db = types.ModuleType("app.db")
fake_db.consultar = MagicMock(return_value=[])
fake_db.executar = MagicMock(return_value=0)
fake_db.transacao = MagicMock()
sys.modules["app.db"] = fake_db

from app.errors import ErroNegocio  # noqa: E402
from app.services import pagamento_service  # noqa: E402


class _Settings:
    def __init__(self, *, segredo: str = "segredo-teste", producao: bool = True):
        self.mp_webhook_secret = segredo
        self.mp_webhook_sem_assinatura = False
        self._producao = producao
        self.mp_access_token = ""

    @property
    def em_producao(self) -> bool:
        return self._producao


class TestWebhookLogEstruturado(unittest.TestCase):
    def test_assinatura_invalida_loga_sem_segredo(self):
        with patch.object(
            pagamento_service,
            "get_settings",
            return_value=_Settings(),
        ):
            with self.assertLogs(pagamento_service.logger, level="WARNING") as cm:
                with self.assertRaises(ErroNegocio):
                    pagamento_service.processar_webhook(
                        {"type": "payment", "data": {"id": "1234567890"}},
                        assinatura="ts=1,v1=deadbeef",
                        request_id="req-1",
                    )
        junto = " | ".join(cm.output)
        self.assertIn("webhook_mp_falha", junto)
        self.assertIn("motivo=assinatura", junto)
        self.assertIn("payment_id=1234567890", junto)
        self.assertNotIn("segredo-teste", junto)
        self.assertNotIn("deadbeef", junto)

    def test_payment_id_sujo_nao_vai_pro_log(self):
        with patch.object(
            pagamento_service,
            "get_settings",
            return_value=_Settings(segredo=""),
        ):
            with self.assertLogs(pagamento_service.logger, level="WARNING") as cm:
                with self.assertRaises(ErroNegocio):
                    pagamento_service.processar_webhook(
                        {"type": "payment", "data": {"id": "email@evil.com"}},
                        assinatura="",
                        request_id="",
                    )
        junto = " | ".join(cm.output)
        self.assertIn("payment_id=-", junto)
        self.assertNotIn("email@evil.com", junto)


class TestDbPing(unittest.TestCase):
    def test_ping_true_e_false(self):
        # Carrega app.db real numa subprocessao logica: stubs extras de pool.
        fake_ext = types.ModuleType("psycopg2.extensions")
        fake_ext.connection = object
        fake_ext.cursor = object
        fake_pool = types.ModuleType("psycopg2.pool")

        class _FakePool:
            def __init__(self, *args, **kwargs):
                pass

            def closeall(self):
                pass

            def getconn(self):
                return MagicMock(closed=0)

            def putconn(self, *args, **kwargs):
                pass

        fake_pool.ThreadedConnectionPool = _FakePool
        sys.modules["psycopg2.extensions"] = fake_ext
        sys.modules["psycopg2.pool"] = fake_pool
        fake_psycopg2.extensions = fake_ext
        fake_psycopg2.pool = fake_pool

        # Remove stub para importar implementacao real de ping.
        sys.modules.pop("app.db", None)
        import importlib
        import app.db as db_real

        importlib.reload(db_real)

        with patch.object(db_real, "consultar", return_value=[{"ok": 1}]):
            self.assertTrue(db_real.ping())
        with patch.object(db_real, "consultar", side_effect=RuntimeError("down")):
            self.assertFalse(db_real.ping())

        # Restaura stub para nao afetar outros testes no mesmo processo.
        sys.modules["app.db"] = fake_db


if __name__ == "__main__":
    unittest.main()
