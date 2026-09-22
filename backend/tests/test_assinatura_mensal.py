"""Assinatura mensal: atraso libera com aviso; pagamento so estende 1x."""
from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.assinatura import (  # noqa: E402
    avaliar_assinatura,
    deve_estender_assinatura,
    deve_marcar_inadimplente,
    exigir_acesso_assinatura,
)


class TestAvaliarAssinatura(unittest.TestCase):
    def test_ativa_em_dia(self):
        s = avaliar_assinatura("ativa", date(2099, 1, 1), hoje=date(2026, 9, 22))
        self.assertFalse(s["bloqueada"])
        self.assertFalse(s["atrasada"])

    def test_ativa_vencida_libera_com_atraso(self):
        s = avaliar_assinatura("ativa", date(2026, 1, 1), hoje=date(2026, 9, 22))
        self.assertFalse(s["bloqueada"])
        self.assertTrue(s["atrasada"])
        self.assertIn("bloque", s["mensagem"].lower())

    def test_inadimplente_libera_com_atraso(self):
        s = avaliar_assinatura("inadimplente", date(2099, 1, 1), hoje=date(2026, 9, 22))
        self.assertFalse(s["bloqueada"])
        self.assertTrue(s["atrasada"])

    def test_pendente_bloqueia(self):
        self.assertTrue(avaliar_assinatura("pendente", None)["bloqueada"])

    def test_cancelada_bloqueia(self):
        self.assertTrue(avaliar_assinatura("cancelada", None)["bloqueada"])

    def test_ausente_bloqueia(self):
        self.assertTrue(avaliar_assinatura(None, None)["bloqueada"])


class TestExigirAcessoAssinatura(unittest.TestCase):
    def test_gate_libera_atraso_e_bloqueia_pendente(self):
        s = exigir_acesso_assinatura("inadimplente", date(2099, 1, 1))
        self.assertFalse(s["bloqueada"])
        self.assertTrue(s["atrasada"])
        with self.assertRaises(ValueError) as ctx:
            exigir_acesso_assinatura("pendente", None)
        self.assertIn("pendente", str(ctx.exception).lower())


class TestPagamentoIdempotente(unittest.TestCase):
    def test_primeira_aprovacao_estende(self):
        self.assertTrue(deve_estender_assinatura(None, "approved"))
        self.assertTrue(deve_estender_assinatura("pending", "approved"))

    def test_reprocessar_aprovado_nao_estende(self):
        self.assertFalse(deve_estender_assinatura("approved", "approved"))

    def test_estorno_marca_inadimplente(self):
        self.assertTrue(deve_marcar_inadimplente("approved", "refunded"))
        self.assertTrue(deve_marcar_inadimplente("approved", "charged_back"))
        self.assertFalse(deve_marcar_inadimplente(None, "refunded"))
        self.assertFalse(deve_marcar_inadimplente("approved", "approved"))


if __name__ == "__main__":
    unittest.main()
