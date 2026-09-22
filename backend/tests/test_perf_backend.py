"""Perf backend: pool limits, rate-limit key, indice pagamentos."""
from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Stubs minimos (mesmo padrao dos outros testes do backend).
fake_psycopg2 = types.ModuleType("psycopg2")
fake_extras = types.ModuleType("psycopg2.extras")
fake_ext = types.ModuleType("psycopg2.extensions")
fake_ext.connection = object
fake_ext.cursor = object
fake_pool = types.ModuleType("psycopg2.pool")


class _FakePool:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs

    def closeall(self):
        pass

    def getconn(self):
        return MagicMock(closed=0)

    def putconn(self, *args, **kwargs):
        pass


fake_pool.ThreadedConnectionPool = _FakePool
fake_psycopg2.extras = fake_extras
fake_psycopg2.extensions = fake_ext
fake_psycopg2.pool = fake_pool
sys.modules.setdefault("psycopg2", fake_psycopg2)
sys.modules.setdefault("psycopg2.extras", fake_extras)
sys.modules.setdefault("psycopg2.extensions", fake_ext)
sys.modules.setdefault("psycopg2.pool", fake_pool)

fake_starlette_mw = types.ModuleType("starlette.middleware.base")


class _BaseHTTPMiddleware:
    pass


fake_starlette_mw.BaseHTTPMiddleware = _BaseHTTPMiddleware
sys.modules.setdefault("starlette.middleware.base", fake_starlette_mw)

fake_starlette_req = types.ModuleType("starlette.requests")
fake_starlette_req.Request = object
sys.modules.setdefault("starlette.requests", fake_starlette_req)

fake_starlette_resp = types.ModuleType("starlette.responses")
fake_starlette_resp.JSONResponse = object
fake_starlette_resp.Response = object
sys.modules.setdefault("starlette.responses", fake_starlette_resp)

fake_pydantic = types.ModuleType("pydantic")


def _Field(default="", **kwargs):
    return default


fake_pydantic.Field = _Field
sys.modules.setdefault("pydantic", fake_pydantic)

fake_pydantic_settings = types.ModuleType("pydantic_settings")


class _BaseSettings:
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


def _SettingsConfigDict(**kwargs):
    return {}


fake_pydantic_settings.BaseSettings = _BaseSettings
fake_pydantic_settings.SettingsConfigDict = _SettingsConfigDict
sys.modules.setdefault("pydantic_settings", fake_pydantic_settings)

from app.db import _limites_pool  # noqa: E402
from app.http_seguranca import chave_rate_limit  # noqa: E402


class _FakeClient:
    def __init__(self, host):
        self.host = host


class _FakeHeaders(dict):
    def get(self, key, default=None):
        key_l = key.lower()
        for k, v in self.items():
            if k.lower() == key_l:
                return v
        return default


class _FakeRequest:
    def __init__(self, headers=None, host="10.0.0.9"):
        self.headers = _FakeHeaders(headers or {})
        self.client = _FakeClient(host) if host is not None else None


class TestLimitesPool(unittest.TestCase):
    def test_padrao_respeita_min_max(self):
        s = types.SimpleNamespace(db_pool_min=2, db_pool_max=20)
        self.assertEqual(_limites_pool(s), (2, 20))

    def test_max_nao_fica_abaixo_do_min(self):
        s = types.SimpleNamespace(db_pool_min=8, db_pool_max=3)
        self.assertEqual(_limites_pool(s), (8, 8))

    def test_min_pelo_menos_um(self):
        s = types.SimpleNamespace(db_pool_min=0, db_pool_max=5)
        self.assertEqual(_limites_pool(s), (1, 5))


class TestChaveRateLimit(unittest.TestCase):
    def test_xff_primeiro_hop(self):
        req = _FakeRequest(headers={"X-Forwarded-For": "203.0.113.10, 10.0.0.1"})
        self.assertEqual(chave_rate_limit(req), "203.0.113.10")

    def test_x_real_ip(self):
        req = _FakeRequest(headers={"X-Real-IP": "198.51.100.7"})
        self.assertEqual(chave_rate_limit(req), "198.51.100.7")

    def test_fallback_peer(self):
        req = _FakeRequest(headers={}, host="192.0.2.1")
        self.assertEqual(chave_rate_limit(req), "192.0.2.1")


class TestSchemaIndicePagamentos(unittest.TestCase):
    def test_indice_loja_criado_em_schema(self):
        texto = (ROOT / "db" / "schema.sql").read_text(encoding="utf-8")
        self.assertIn("idx_pagamentos_loja_criado", texto)
        self.assertIn("(loja_id, criado_em DESC)", texto)


if __name__ == "__main__":
    unittest.main()
