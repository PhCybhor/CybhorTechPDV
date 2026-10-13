from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from app import db
from app.config import get_settings
from app.errors import ErroNegocio
from app.cpf import validar_cpf
from app.diretrizes import validar_aceite_diretrizes
from app.planos import obter_plano
from app.services.loja_service import criar_loja_com_admin
from app.services.pagamento_service import (
    criar_checkout_assinatura,
    criar_pagamento_transparente,
    obter_configuracao_pagamento_site,
    sincronizar_pagamento_loja,
)


def gerar_token_ativacao() -> str:
    return os.urandom(32).hex()


def _resolver_nome_pagador(registro: Dict[str, Any], nome_completo_admin: str):
    if registro.get("responsavel_nome") and registro.get("responsavel_sobrenome"):
        return registro["responsavel_nome"], registro["responsavel_sobrenome"]
    partes = (nome_completo_admin or "").strip().split()
    if len(partes) >= 2:
        return partes[0], " ".join(partes[1:])
    unico = partes[0] if partes else "Cliente"
    return unico, unico


def comprar_pelo_site(
    *,
    loja: Dict[str, Any],
    admin: Dict[str, Any],
    plano: str = "mensal",
    aceite_diretrizes: Any = None,
    ip: str = "",
    navegador: str = "",
) -> Dict[str, Any]:
    """Cria a loja pelo site (teste grátis ou plano pago).

    O aceite das Diretrizes da comunidade é exigido antes de qualquer outra
    validação, para nenhuma loja nascer sem ele.
    """
    aceite = validar_aceite_diretrizes(aceite_diretrizes, ip=ip, navegador=navegador)
    settings = get_settings()
    escolhido = obter_plano(plano, settings)
    cpf = validar_cpf((loja or {}).get("cpf") or (admin or {}).get("cpf") or "")

    if escolhido.get("gratis"):
        return _iniciar_teste_gratis(
            loja=loja or {}, admin=admin or {}, cpf=cpf, aceite=aceite
        )

    if not settings.mp_access_token:
        raise ErroNegocio("Pagamentos indisponiveis no momento.", 503)

    criada = criar_loja_com_admin(
        loja={**(loja or {}), "cpf": cpf},
        admin=admin,
        aguardar_pagamento=True,
        cpf=cpf,
        aceite_diretrizes=aceite,
    )
    token = gerar_token_ativacao()
    db.executar(
        """
        UPDATE assinaturas
        SET token_ativacao = %s, plano = %s, valor_mensal = %s, atualizado_em = now()
        WHERE loja_id = %s
        """,
        (token, escolhido["id"], escolhido["valor"], criada["lojaId"]),
    )
    email = ((loja or {}).get("email") or (admin or {}).get("email") or "").strip()
    checkout = criar_checkout_assinatura(
        criada["lojaId"],
        {"email": email, "origemSite": True, "tokenAtivacao": token},
    )
    return {
        "lojaId": criada["lojaId"],
        "tokenAtivacao": token,
        "checkoutUrl": checkout["checkoutUrl"],
        "publicKey": settings.mp_public_key,
        "trial": False,
    }


def _iniciar_teste_gratis(
    *, loja: Dict[str, Any], admin: Dict[str, Any], cpf: str, aceite: Dict[str, str]
) -> Dict[str, Any]:
    ja_usou = db.consultar("SELECT 1 FROM trials_cpf WHERE cpf = %s", (cpf,))
    if ja_usou:
        raise ErroNegocio(
            "Este CPF ja usou o teste gratis de 30 dias. Escolha um plano pago.",
            409,
        )

    token = gerar_token_ativacao()
    criada = criar_loja_com_admin(
        loja={**loja, "cpf": cpf},
        admin=admin,
        aguardar_pagamento=False,
        cpf=cpf,
        dias_validade=30,
        plano="teste",
        trial_cpf=cpf,
        aceite_diretrizes=aceite,
    )
    db.executar(
        """
        UPDATE assinaturas
        SET token_ativacao = %s, plano = 'teste', valor_mensal = 0, atualizado_em = now()
        WHERE loja_id = %s
        """,
        (token, criada["lojaId"]),
    )
    usuario = (admin.get("usuario") or "").strip().lower()
    return {
        "lojaId": criada["lojaId"],
        "tokenAtivacao": token,
        "checkoutUrl": "",
        "publicKey": "",
        "trial": True,
        "codigo": criada["codigo"],
        "usuario": usuario,
        "redirectUrl": f"/sucesso.html?token={token}&trial=1",
    }


def obter_dados_pagamento(token: str) -> Dict[str, Any]:
    token_limpo = (token or "").strip()
    if len(token_limpo) < 32:
        raise ErroNegocio("Token invalido.", 400)

    settings = get_settings()
    if not settings.mp_access_token:
        raise ErroNegocio("Pagamentos indisponiveis no momento.", 503)

    rows = db.consultar(
        """
        SELECT l.id, l.nome, l.email, l.responsavel_nome, l.responsavel_sobrenome,
               a.status AS assinatura_status, a.plano, a.valor_mensal,
               f.nome AS admin_nome_completo
        FROM assinaturas a
        JOIN lojas l ON l.id = a.loja_id
        JOIN funcionarios f ON f.loja_id = l.id AND f.cargo = 'admin'
        WHERE a.token_ativacao = %s
        ORDER BY f.criado_em ASC
        LIMIT 1
        """,
        (token_limpo,),
    )
    if not rows:
        raise ErroNegocio("Compra nao encontrada.", 404)

    registro = rows[0]
    if registro["assinatura_status"] == "ativa":
        return {"jaAtiva": True, "tokenAtivacao": token_limpo}

    primeiro, sobrenome = _resolver_nome_pagador(
        registro, registro["admin_nome_completo"]
    )
    loja_id = str(registro["id"])
    plano = obter_plano(registro.get("plano") or "mensal", settings)
    valor = float(registro.get("valor_mensal") or plano["valor"])
    resposta: Dict[str, Any] = {
        "jaAtiva": False,
        "tokenAtivacao": token_limpo,
        "lojaId": loja_id,
        "nomeLoja": registro["nome"],
        "email": registro["email"],
        "primeiroNome": primeiro,
        "sobrenome": sobrenome,
        "publicKey": settings.mp_public_key,
        "valorMensal": valor,
        "plano": plano["id"],
        "planoNome": plano["nome"],
        "planoRotulo": plano["rotuloPeriodo"],
        "modo": "transparente" if settings.mp_public_key else "checkout_pro",
    }
    if settings.mp_public_key:
        config_mp = obter_configuracao_pagamento_site()
        resposta["customization"] = config_mp["customization"]
        resposta["metodosDisponiveis"] = config_mp["metodosDisponiveis"]
        resposta["metodosHabilitados"] = config_mp["metodosHabilitados"]
    else:
        checkout = criar_checkout_assinatura(
            loja_id,
            {
                "email": registro["email"],
                "origemSite": True,
                "tokenAtivacao": token_limpo,
            },
        )
        resposta["checkoutUrl"] = checkout["checkoutUrl"]
    return resposta


def processar_pagamento_site(token: str, form_data: Dict[str, Any]) -> Dict[str, Any]:
    dados = obter_dados_pagamento(token)
    if dados.get("jaAtiva"):
        return {"status": "approved", "redirectUrl": f"/sucesso.html?token={token}"}

    pagamento = criar_pagamento_transparente(
        dados["lojaId"],
        dados["email"],
        form_data or {},
        {"firstName": dados["primeiroNome"], "lastName": dados["sobrenome"]},
    )

    status = pagamento.get("status")
    if status == "approved":
        return {
            "status": status,
            "paymentId": pagamento.get("id"),
            "metodo": pagamento.get("payment_method_id"),
            "redirectUrl": f"/sucesso.html?token={token}",
        }
    if status in ("pending", "in_process"):
        return {
            "status": status,
            "paymentId": pagamento.get("id"),
            "metodo": pagamento.get("payment_method_id"),
            "redirectUrl": f"/sucesso.html?token={token}&pendente=1",
            "mensagem": "Pagamento em processamento. Siga as instrucoes abaixo.",
            "exibirStatus": True,
        }
    raise ErroNegocio("Pagamento nao aprovado. Tente outro metodo.", 402)


def consultar_ativacao(token: str) -> Dict[str, Any]:
    token_limpo = (token or "").strip()
    if not re.fullmatch(r"[0-9a-f]{64}", token_limpo):
        raise ErroNegocio("Token invalido.", 400)

    sql = """
        SELECT l.id, l.nome, l.codigo, l.ativa, a.status AS assinatura_status,
               a.atualizado_em, f.usuario AS admin_usuario
        FROM assinaturas a
        JOIN lojas l ON l.id = a.loja_id
        JOIN funcionarios f ON f.loja_id = l.id AND f.cargo = 'admin'
        WHERE a.token_ativacao = %s
        ORDER BY f.criado_em ASC
        LIMIT 1
    """
    rows = db.consultar(sql, (token_limpo,))
    if not rows:
        raise ErroNegocio("Compra nao encontrada.", 404)

    registro = rows[0]
    if registro["assinatura_status"] != "ativa":
        sincronizar_pagamento_loja(str(registro["id"]))
        rows = db.consultar(sql, (token_limpo,))
        registro = rows[0]

    if registro["assinatura_status"] == "ativa" and registro["ativa"]:
        atualizado = registro.get("atualizado_em")
        limite = datetime.now(timezone.utc) - timedelta(hours=24)
        if atualizado is not None:
            if atualizado.tzinfo is None:
                atualizado = atualizado.replace(tzinfo=timezone.utc)
            if atualizado < limite:
                return {
                    "status": "ativa",
                    "nomeLoja": registro["nome"],
                    "codigo": "",
                    "usuario": "",
                    "mensagem": (
                        "Pagamento confirmado. Consulte o codigo em Area do cliente."
                    ),
                }
        return {
            "status": "ativa",
            "nomeLoja": registro["nome"],
            "codigo": registro["codigo"],
            "usuario": registro["admin_usuario"],
            "mensagem": "Loja ativa. Use o codigo abaixo no CybhorPDV.",
        }
    return {
        "status": "pendente",
        "mensagem": "Aguardando confirmacao do pagamento. Esta pagina atualiza sozinha.",
    }
