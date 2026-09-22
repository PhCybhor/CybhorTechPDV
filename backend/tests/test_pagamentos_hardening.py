#!/usr/bin/env python3
"""Hardening Mercado Pago: assinatura do webhook + race no payment_id."""
from __future__ import annotations

import hashlib
import hmac
import sys
import types
import unittest
from contextlib import contextmanager
from pathlib import Path
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


class _FakeClient:
    def __init__(self, *args, **kwargs):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def request(self, *args, **kwargs):
        raise RuntimeError("httpx nao deve ser chamado neste teste")

    def get(self, *args, **kwargs):
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


def _assinatura(segredo: str, payment_id: str, request_id: str, ts: str = "1700000000") -> str:
    manifesto = f"id:{payment_id};request-id:{request_id};ts:{ts};"
    digest = hmac.new(
        segredo.encode("utf-8"), manifesto.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"ts={ts},v1={digest}"


class _Settings:
    def __init__(self, *, segredo: str = "", producao: bool = False):
        self.mp_webhook_secret = segredo
        self._producao = producao

    @property
    def em_producao(self) -> bool:
        return self._producao


class TestWebhookAssinatura(unittest.TestCase):
    def test_producao_sem_segredo_rejeita(self):
        with patch.object(
            pagamento_service, "get_settings", return_value=_Settings(producao=True)
        ):
            with self.assertRaises(ErroNegocio) as ctx:
                pagamento_service._verificar_assinatura_webhook(
                    payment_id="1234567890",
                    assinatura="",
                    request_id="req-1",
                )
        self.assertEqual(ctx.exception.status, 503)

    def test_dev_sem_segredo_aceita(self):
        with patch.object(
            pagamento_service, "get_settings", return_value=_Settings(producao=False)
        ):
            pagamento_service._verificar_assinatura_webhook(
                payment_id="1234567890",
                assinatura="",
                request_id="",
            )

    def test_assinatura_invalida_rejeita(self):
        with patch.object(
            pagamento_service,
            "get_settings",
            return_value=_Settings(segredo="segredo-teste"),
        ):
            with self.assertRaises(ErroNegocio) as ctx:
                pagamento_service._verificar_assinatura_webhook(
                    payment_id="1234567890",
                    assinatura="ts=1,v1=deadbeef",
                    request_id="req-1",
                )
        self.assertEqual(ctx.exception.status, 401)

    def test_assinatura_valida_aceita(self):
        segredo = "segredo-teste"
        payment_id = "9876543210"
        request_id = "abc-req"
        with patch.object(
            pagamento_service,
            "get_settings",
            return_value=_Settings(segredo=segredo),
        ):
            pagamento_service._verificar_assinatura_webhook(
                payment_id=payment_id,
                assinatura=_assinatura(segredo, payment_id, request_id),
                request_id=request_id,
            )


class TestRegistrarPagamentoRace(unittest.TestCase):
    def setUp(self):
        self.loja = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        self.sqls: list[str] = []
        self.status_atual = None
        self.extensoes = 0

        class CursorFake:
            def __init__(self_inner, outer):
                self_inner.outer = outer

            def execute(self_inner, sql, params=None):
                self_inner.outer.sqls.append(sql)
                self_inner._last_sql = sql
                self_inner._params = params
                if "INSERT INTO pagamentos" in sql:
                    self_inner.outer.status_atual = params[2]
                elif (
                    "UPDATE pagamentos" in sql
                    and "mp_payment_id" in sql
                    and "SET status" in sql
                ):
                    self_inner.outer.status_atual = params[0]
                elif "UPDATE assinaturas" in sql and "valida_ate" in sql:
                    self_inner.outer.extensoes += 1

            def fetchone(self_inner):
                if "FROM pagamentos" in getattr(self_inner, "_last_sql", ""):
                    if self_inner.outer.status_atual is None:
                        return None
                    return {"status": self_inner.outer.status_atual}
                if "FROM assinaturas" in getattr(self_inner, "_last_sql", ""):
                    return {"plano": "mensal"}
                return None

        outer = self
        cur = CursorFake(outer)

        @contextmanager
        def tx():
            yield cur

        self._orig_tx = pagamento_service.db.transacao
        pagamento_service.db.transacao = tx

    def tearDown(self):
        pagamento_service.db.transacao = self._orig_tx

    def test_primeira_aprovacao_estende_e_trava_advisory(self):
        pagamento_service.registrar_pagamento(
            self.loja,
            {"id": "111222333", "status": "approved", "transaction_amount": 99.9},
        )
        self.assertEqual(self.extensoes, 1)
        self.assertTrue(
            any("pg_advisory_xact_lock" in sql for sql in self.sqls),
            "webhooks concorrentes precisam do advisory lock",
        )

    def test_segunda_aprovacao_mesmo_id_nao_estende(self):
        pag = {"id": "111222333", "status": "approved", "transaction_amount": 99.9}
        pagamento_service.registrar_pagamento(self.loja, pag)
        pagamento_service.registrar_pagamento(self.loja, pag)
        self.assertEqual(self.extensoes, 1)


class TestConsultarAtivacaoNaoVazaCodigo(unittest.TestCase):
    def test_pendente_sem_codigo(self):
        from app.services import site_service

        token = "a" * 64
        rows_pendente = [
            {
                "id": "loja-1",
                "nome": "Loja X",
                "codigo": "SECRET1",
                "ativa": False,
                "assinatura_status": "pendente",
                "atualizado_em": None,
                "admin_usuario": "admin",
            }
        ]

        with patch.object(site_service.db, "consultar", return_value=rows_pendente):
            with patch.object(site_service, "sincronizar_pagamento_loja"):
                dados = site_service.consultar_ativacao(token)
        self.assertEqual(dados["status"], "pendente")
        self.assertNotIn("codigo", dados)


if __name__ == "__main__":
    unittest.main()
