#!/usr/bin/env python3
"""Permissoes do operador em escritas /dados e normalizacao de flags."""
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

# emitir_token so vem de deps (jwt). Stub minimo.
fake_deps = types.ModuleType("app.deps")
fake_deps.emitir_token = lambda payload: "token-fake"
sys.modules["app.deps"] = fake_deps

from app.services import auth_service  # noqa: E402
from app.errors import ErroNegocio  # noqa: E402


LOJA = "11111111-1111-1111-1111-111111111111"
FUNC = "22222222-2222-2222-2222-222222222222"


def _perms(**overrides):
    base = {chave: False for chave in auth_service._PERMISSOES_OPERADOR}
    base.update(overrides)
    return base


class TestNormalizarPermissoes(unittest.TestCase):
    def test_como_bool_aceita_strings_comuns(self):
        self.assertFalse(auth_service._como_bool("false", True))
        self.assertFalse(auth_service._como_bool("0", True))
        self.assertFalse(auth_service._como_bool("nao", True))
        self.assertTrue(auth_service._como_bool("true", False))
        self.assertTrue(auth_service._como_bool("1", False))
        self.assertTrue(auth_service._como_bool("sim", False))

    def test_normalizar_preenche_padroes(self):
        saida = auth_service._normalizar_permissoes({})
        self.assertFalse(saida["excluirProduto"])
        self.assertFalse(saida["cancelarVenda"])
        self.assertFalse(saida["gerenciarClientes"])
        self.assertTrue(saida["ajustarEstoque"])
        self.assertTrue(saida["cadastrarProduto"])

    def test_normalizar_respeita_overrides(self):
        saida = auth_service._normalizar_permissoes(
            {"excluirProduto": "sim", "ajustarEstoque": "nao"}
        )
        self.assertTrue(saida["excluirProduto"])
        self.assertFalse(saida["ajustarEstoque"])


class TestObterPermissoesFuncionario(unittest.TestCase):
    def setUp(self):
        self._consultar_orig = auth_service.db.consultar

    def tearDown(self):
        auth_service.db.consultar = self._consultar_orig

    def test_admin_tem_tudo(self):
        auth_service.db.consultar = MagicMock(
            return_value=[{"cargo": "admin", "dados": {}}]
        )
        perms = auth_service.obter_permissoes_funcionario(LOJA, FUNC)
        self.assertTrue(all(perms.values()))

    def test_operador_sem_registro_nega_tudo(self):
        auth_service.db.consultar = MagicMock(return_value=[])
        perms = auth_service.obter_permissoes_funcionario(LOJA, FUNC)
        self.assertTrue(all(v is False for v in perms.values()))

    def test_operador_usa_json_permissoes(self):
        auth_service.db.consultar = MagicMock(
            return_value=[
                {
                    "cargo": "operador",
                    "dados": {"permissoes": {"gerenciarClientes": True}},
                }
            ]
        )
        perms = auth_service.obter_permissoes_funcionario(LOJA, FUNC)
        self.assertTrue(perms["gerenciarClientes"])
        self.assertFalse(perms["excluirProduto"])


class TestExigirEscritaDados(unittest.TestCase):
    def setUp(self):
        self._obter_orig = auth_service.obter_permissoes_funcionario
        self.kw = {
            "cargo": "operador",
            "loja_id": LOJA,
            "funcionario_id": FUNC,
        }

    def tearDown(self):
        auth_service.obter_permissoes_funcionario = self._obter_orig

    def _mock_perms(self, **overrides):
        auth_service.obter_permissoes_funcionario = (
            lambda _l, _f: _perms(**overrides)
        )

    def test_admin_passa_em_qualquer_recurso(self):
        auth_service.exigir_escrita_dados(
            cargo="admin",
            loja_id=LOJA,
            funcionario_id=FUNC,
            caminho="despesas/x1",
        )

    def test_operador_bloqueado_em_recurso_admin(self):
        self._mock_perms()
        with self.assertRaises(ErroNegocio) as ctx:
            auth_service.exigir_escrita_dados(
                **self.kw, caminho=f"lojas/{LOJA}/despesas/x1"
            )
        self.assertEqual(ctx.exception.status, 403)

    def test_operador_nao_grava_vendas_via_dados(self):
        # Fecha bypass de cancelarVenda / estoque via PUT /dados/vendas/...
        self._mock_perms(cancelarVenda=True)
        with self.assertRaises(ErroNegocio) as ctx:
            auth_service.exigir_escrita_dados(
                **self.kw, caminho=f"lojas/{LOJA}/vendas/v1"
            )
        self.assertEqual(ctx.exception.status, 403)

    def test_clientes_exige_gerenciar(self):
        self._mock_perms(gerenciarClientes=False)
        with self.assertRaises(ErroNegocio):
            auth_service.exigir_escrita_dados(
                **self.kw, caminho="clientes/c1"
            )
        self._mock_perms(gerenciarClientes=True)
        auth_service.exigir_escrita_dados(**self.kw, caminho="clientes/c1")

    def test_sangria_exige_fazer_sangria(self):
        self._mock_perms(fazerSangria=False)
        with self.assertRaises(ErroNegocio):
            auth_service.exigir_escrita_dados(**self.kw, caminho="sangrias/s1")
        self._mock_perms(fazerSangria=True)
        auth_service.exigir_escrita_dados(**self.kw, caminho="sangrias/s1")

    def test_estoque_exige_ajustar(self):
        self._mock_perms(ajustarEstoque=False, cadastrarProduto=True)
        with self.assertRaises(ErroNegocio):
            auth_service.exigir_escrita_dados(
                **self.kw, caminho="produtos/p1/estoque"
            )
        self._mock_perms(ajustarEstoque=True)
        auth_service.exigir_escrita_dados(
            **self.kw, caminho="produtos/p1/estoque"
        )

    def test_produto_exige_cadastrar_ou_editar(self):
        self._mock_perms(
            cadastrarProduto=False, editarProduto=False, ajustarEstoque=True
        )
        with self.assertRaises(ErroNegocio):
            auth_service.exigir_escrita_dados(**self.kw, caminho="produtos/p1")
        self._mock_perms(editarProduto=True)
        auth_service.exigir_escrita_dados(**self.kw, caminho="produtos/p1")

    def test_remocao_produto_exige_excluir(self):
        self._mock_perms(
            cadastrarProduto=True, editarProduto=True, excluirProduto=False
        )
        with self.assertRaises(ErroNegocio) as ctx:
            auth_service.exigir_remocao_dados(**self.kw, caminho="produtos/p1")
        self.assertIn("excluir", ctx.exception.mensagem.lower())
        self._mock_perms(
            cadastrarProduto=True, editarProduto=True, excluirProduto=True
        )
        auth_service.exigir_remocao_dados(**self.kw, caminho="produtos/p1")

    def test_lote_rejeita_se_qualquer_caminho_proibido(self):
        self._mock_perms(fazerSangria=True, gerenciarClientes=False)
        with self.assertRaises(ErroNegocio):
            auth_service.exigir_lote_dados(
                **self.kw,
                atualizacoes={
                    "sangrias/s1": {"valor": 10},
                    "clientes/c1": {"nome": "X"},
                },
            )


class TestExigirPerm(unittest.TestCase):
    def setUp(self):
        self._obter_orig = auth_service.obter_permissoes_funcionario

    def tearDown(self):
        auth_service.obter_permissoes_funcionario = self._obter_orig

    def test_operador_sem_flag_leva_403(self):
        auth_service.obter_permissoes_funcionario = (
            lambda _l, _f: _perms(cancelarVenda=False)
        )
        with self.assertRaises(ErroNegocio) as ctx:
            auth_service.exigir_perm(
                cargo="operador",
                loja_id=LOJA,
                funcionario_id=FUNC,
                chave="cancelarVenda",
                mensagem="Sem permissao para cancelar venda.",
            )
        self.assertEqual(ctx.exception.status, 403)

    def test_admin_ignora_flag(self):
        auth_service.exigir_perm(
            cargo="admin",
            loja_id=LOJA,
            funcionario_id=FUNC,
            chave="cancelarVenda",
            mensagem="x",
        )


if __name__ == "__main__":
    unittest.main()
