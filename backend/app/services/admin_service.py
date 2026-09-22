from __future__ import annotations

import hmac
from typing import Any, Dict, List, Optional

from app import db
from app.assinatura import avaliar_assinatura
from app.deps import emitir_token
from app.errors import ErroNegocio
from app.security import verificar_senha


def login_admin_sistema(*, email: str, senha: str) -> Dict[str, Any]:
    email_limpo = (email or "").strip().lower()
    rows = db.consultar(
        "SELECT id, nome, email, salt, senha_hash FROM administradores_sistema WHERE email = %s",
        (email_limpo,),
    )
    if not rows:
        raise ErroNegocio("Credenciais invalidas.", 401)

    admin = rows[0]
    if not verificar_senha(senha or "", admin["salt"], admin["senha_hash"]):
        raise ErroNegocio("Credenciais invalidas.", 401)

    token = emitir_token(
        {
            "tipo": "admin-sistema",
            "adminId": str(admin["id"]),
            "email": admin["email"],
        }
    )
    return {
        "token": token,
        "admin": {
            "id": str(admin["id"]),
            "nome": admin["nome"],
            "email": admin["email"],
        },
    }


def _metricas_lojas(loja_id: Optional[str] = None) -> List[Dict[str, Any]]:
    filtros = ""
    params: tuple = ()
    if loja_id:
        filtros = "WHERE l.id = %s"
        params = (loja_id,)
    rows = db.consultar(
        f"""
        SELECT
          l.id, l.nome, l.codigo, l.ativa, l.criado_em AS "criadoEm",
          a.status AS "assinaturaStatus", a.valida_ate AS "assinaturaValidaAte",
          COALESCE(f.qtd, 0)::int AS "totalFuncionarios",
          COALESCE(p.qtd, 0)::int AS "totalProdutos",
          COALESCE(v.qtd, 0)::int AS "totalVendas",
          COALESCE(v.faturamento, 0)::numeric(14,2) AS "faturamentoTotal",
          (COALESCE(f.bytes, 0) + COALESCE(p.bytes, 0) + COALESCE(v.bytes, 0)
           + COALESCE(vi.bytes, 0))::bigint AS "usoBytes"
        FROM lojas l
        LEFT JOIN assinaturas a ON a.loja_id = l.id
        LEFT JOIN (
          SELECT loja_id, count(*) AS qtd, sum(pg_column_size(funcionarios.*)) AS bytes
          FROM funcionarios GROUP BY loja_id
        ) f ON f.loja_id = l.id
        LEFT JOIN (
          SELECT loja_id, count(*) AS qtd, sum(pg_column_size(produtos.*)) AS bytes
          FROM produtos GROUP BY loja_id
        ) p ON p.loja_id = l.id
        LEFT JOIN (
          SELECT loja_id, count(*) AS qtd, sum(total) AS faturamento,
                 sum(pg_column_size(vendas.*)) AS bytes
          FROM vendas GROUP BY loja_id
        ) v ON v.loja_id = l.id
        LEFT JOIN (
          SELECT vd.loja_id, sum(pg_column_size(vi.*)) AS bytes
          FROM venda_itens vi JOIN vendas vd ON vd.id = vi.venda_id
          GROUP BY vd.loja_id
        ) vi ON vi.loja_id = l.id
        {filtros}
        ORDER BY l.criado_em DESC
        """,
        params,
    )
    resultado = []
    for loja in rows:
        loja["id"] = str(loja["id"])
        uso_bytes = int(loja["usoBytes"] or 0)
        loja["usoBytes"] = uso_bytes
        loja["faturamentoTotal"] = float(loja["faturamentoTotal"] or 0)
        loja["usoGB"] = round(uso_bytes / 1024**3, 6)
        loja["usoMB"] = round(uso_bytes / 1024**2, 3)
        situacao = avaliar_assinatura(
            loja.get("assinaturaStatus"), loja.get("assinaturaValidaAte")
        )
        if loja.get("assinaturaValidaAte") is not None:
            loja["assinaturaValidaAte"] = str(loja["assinaturaValidaAte"])
        loja["assinaturaAtrasada"] = situacao["atrasada"]
        loja["assinaturaRotulo"] = situacao["rotulo"]
        loja["assinaturaStatusExibicao"] = situacao["statusExibicao"]
        resultado.append(loja)
    return resultado


def criar_ou_atualizar_admin_sistema(
    *, nome: str, email: str, senha: str
) -> Dict[str, str]:
    from app.security import gerar_hash_senha, gerar_salt, validar_tamanho_senha

    nome_limpo = (nome or "").strip()
    email_limpo = (email or "").strip().lower()
    senha_ok = validar_tamanho_senha(senha or "")
    if len(nome_limpo) < 2:
        raise ErroNegocio("Informe o nome do administrador.")
    if "@" not in email_limpo:
        raise ErroNegocio("Informe um e-mail valido.")

    salt = gerar_salt()
    senha_hash = gerar_hash_senha(senha_ok, salt)
    db.executar(
        """
        INSERT INTO administradores_sistema (nome, email, salt, senha_hash)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (email)
        DO UPDATE SET nome = EXCLUDED.nome, salt = EXCLUDED.salt,
                      senha_hash = EXCLUDED.senha_hash
        """,
        (nome_limpo, email_limpo, salt, senha_hash),
    )
    return {"email": email_limpo}


def bootstrap_admin_sistema(
    *, nome: str, email: str, senha: str, secret: str = ""
) -> Dict[str, str]:
    """Primeiro admin, ou reset se ADMIN_BOOTSTRAP_SECRET bater."""
    from app.config import get_settings

    settings = get_settings()
    segredo = (settings.admin_bootstrap_secret or "").strip()
    existentes = db.consultar("SELECT 1 FROM administradores_sistema LIMIT 1")
    recebido = secret or ""
    autorizado = bool(segredo) and len(recebido) == len(segredo) and hmac.compare_digest(
        recebido, segredo
    )
    if existentes and not autorizado:
        raise ErroNegocio("Bootstrap indisponivel: ja existe administrador.", 409)
    return criar_ou_atualizar_admin_sistema(nome=nome, email=email, senha=senha)


def listar_lojas_com_metricas() -> List[Dict[str, Any]]:
    return _metricas_lojas()


def detalhar_loja(loja_id: str) -> Dict[str, Any]:
    metricas = _metricas_lojas(loja_id)
    if not metricas:
        raise ErroNegocio("Loja nao encontrada.", 404)
    loja = metricas[0]

    vendas_por_dia = db.consultar(
        """
        SELECT date_trunc('day', criado_em)::date AS dia,
               count(*)::int AS vendas, sum(total)::numeric(14,2) AS faturamento
        FROM vendas
        WHERE loja_id = %s AND criado_em >= now() - interval '30 days'
        GROUP BY 1 ORDER BY 1
        """,
        (loja_id,),
    )
    for v in vendas_por_dia:
        v["faturamento"] = float(v["faturamento"] or 0)

    pagamentos = db.consultar(
        """
        SELECT mp_payment_id AS "mpPaymentId", status, valor, criado_em AS "criadoEm"
        FROM pagamentos WHERE loja_id = %s ORDER BY criado_em DESC LIMIT 20
        """,
        (loja_id,),
    )
    for p in pagamentos:
        if p.get("valor") is not None:
            p["valor"] = float(p["valor"])

    return {"loja": loja, "vendasPorDia": vendas_por_dia, "pagamentos": pagamentos}


def definir_loja_ativa(loja_id: str, ativa: bool) -> None:
    afetadas = db.executar(
        "UPDATE lojas SET ativa = %s, atualizado_em = now() WHERE id = %s",
        (bool(ativa), loja_id),
    )
    if afetadas == 0:
        raise ErroNegocio("Loja nao encontrada.", 404)


def criar_conta_loja(*, loja: Dict[str, Any], admin: Dict[str, Any]) -> Dict[str, str]:
    """Provisiona loja + admin ja ativos, com chave de conexao pronta."""
    from app.services.loja_service import criar_loja_com_admin

    criada = criar_loja_com_admin(loja=loja, admin=admin, aguardar_pagamento=False)
    usuario = (admin.get("usuario") or "").strip().lower()
    return {
        "lojaId": criada["lojaId"],
        "codigo": criada["codigo"],
        "nomeLoja": (loja.get("nome") or "").strip(),
        "usuario": usuario,
    }


def regenerar_chave_loja(loja_id: str) -> Dict[str, str]:
    from app.services.loja_service import regenerar_codigo_loja

    return regenerar_codigo_loja(loja_id)
