from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query, Request, Response, status
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.deps import (
    AuthAdminSistema,
    AuthLoja,
    autenticar_admin_sistema,
    autenticar_loja,
    exigir_admin_loja,
)
from app.errors import ErroNegocio
from app.config import get_settings
from app.services import (
    admin_service,
    auth_service,
    loja_service,
    pagamento_service,
    produto_service,
    site_service,
    venda_service,
    dados_service,
)

limiter = Limiter(key_func=get_remote_address)
api = APIRouter()


@api.get("/saude")
def saude() -> Dict[str, bool]:
    return {"ok": True}


# --- Site ---
@api.get("/site/preco")
def site_preco() -> Dict[str, Any]:
    from app.planos import catalogo_planos, obter_plano

    settings = get_settings()
    mensal = obter_plano("mensal", settings)
    return {
        "ok": True,
        "preco": mensal["valor"],
        "planos": catalogo_planos(settings),
    }


@api.post("/site/comprar", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/15minutes")
def site_comprar(request: Request, body: Dict[str, Any]) -> Dict[str, str]:
    resultado = site_service.comprar_pelo_site(
        loja=body.get("loja") or {},
        admin=body.get("admin") or {},
        plano=body.get("plano") or "mensal",
    )
    return {
        "tokenAtivacao": resultado["tokenAtivacao"],
        "checkoutUrl": resultado["checkoutUrl"],
        "publicKey": resultado.get("publicKey") or "",
    }


@api.get("/site/pagamento")
def site_pagamento(token: str = Query(...)) -> Dict[str, Any]:
    return site_service.obter_dados_pagamento(token)


@api.post("/site/pagar")
@limiter.limit("20/15minutes")
def site_pagar(request: Request, body: Dict[str, Any]) -> Dict[str, Any]:
    return site_service.processar_pagamento_site(
        body.get("tokenAtivacao") or "", body.get("formData") or {}
    )


@api.get("/site/ativacao")
def site_ativacao(
    token: str = Query(...),
    payment_id: str = Query(default=""),
) -> Dict[str, Any]:
    return site_service.consultar_ativacao(token, payment_id=payment_id)


def _recurso_do_caminho(caminho: str) -> str:
    partes = [p for p in str(caminho or "").strip("/").split("/") if p]
    if len(partes) >= 2 and partes[0] == "lojas":
        partes = partes[2:]
    return partes[0] if partes else ""


# Recursos que o operador do caixa pode gravar (vendas, estoque, sangria, etc.).
# Demais mutações exigem admin da loja.
RECURSOS_OPERADOR_ESCRITA = frozenset(
    {
        "vendas",
        "produtos",
        "sangrias",
        "caixaEstado",
        "suprimentos",
        "clientes",
        "fechamentos",
        "auditoria",
    }
)


def _exigir_escrita_dados(auth: AuthLoja, caminho: str) -> None:
    if auth.cargo == "admin":
        return
    recurso = _recurso_do_caminho(caminho)
    if recurso not in RECURSOS_OPERADOR_ESCRITA:
        raise ErroNegocio(
            "Apenas o administrador da loja pode alterar este recurso.", 403
        )


def _exigir_lote_dados(auth: AuthLoja, atualizacoes: Dict[str, Any]) -> None:
    if auth.cargo == "admin":
        return
    for caminho in (atualizacoes or {}):
        _exigir_escrita_dados(auth, caminho)


# --- Lojas ---
@api.post("/lojas", status_code=status.HTTP_201_CREATED)
@limiter.limit("20/15minutes")
def criar_loja(request: Request, body: Dict[str, Any]) -> Dict[str, str]:
    settings = get_settings()
    # Em produção, loja só fica ativa após pagamento (fluxo /site/comprar).
    aguardar = True if settings.em_producao else bool(body.get("aguardarPagamento"))
    return loja_service.criar_loja_com_admin(
        loja=body.get("loja") or {},
        admin=body.get("admin") or {},
        aguardar_pagamento=aguardar,
    )


@api.post("/lojas/conectar")
@limiter.limit("20/15minutes")
def conectar_loja(request: Request, body: Dict[str, Any]) -> Dict[str, str]:
    return loja_service.buscar_loja_por_codigo(body.get("codigo") or "")


@api.post("/ativar")
@limiter.limit("20/15minutes")
def ativar_desktop(request: Request, body: Dict[str, Any]) -> Dict[str, Any]:
    chave = (body.get("chave") or "").strip().upper()
    settings = get_settings()
    if chave == "DEV-LOCAL" and (
        not settings.em_producao or settings.permitir_dev_local
    ):
        return loja_service.obter_ou_criar_loja_desenvolvimento()
    return loja_service.ativar_por_codigo(chave)


@api.get("/lojas/{loja_id}/bootstrap")
def status_bootstrap(loja_id: str) -> Dict[str, bool]:
    return {"temAdmin": auth_service.existe_administrador(loja_id)}


@api.post("/lojas/{loja_id}/admin-inicial", status_code=status.HTTP_201_CREATED)
@limiter.limit("10/15minutes")
def criar_admin_inicial(
    request: Request, loja_id: str, body: Dict[str, Any]
) -> Dict[str, str]:
    return auth_service.criar_admin_inicial(loja_id, body)


@api.get("/lojas/perfil")
def perfil_loja(auth: AuthLoja = Depends(autenticar_loja)) -> Dict[str, Any]:
    return loja_service.obter_perfil(auth.loja_id)


# --- Auth / equipe ---
@api.post("/auth/login")
@limiter.limit("20/15minutes")
def login(request: Request, body: Dict[str, Any]) -> Dict[str, Any]:
    return auth_service.login_loja(
        codigo_loja=body.get("codigoLoja") or "",
        loja_id=body.get("lojaId") or "",
        usuario=body.get("usuario") or "",
        senha=body.get("senha") or "",
        email=body.get("email") or "",
    )


@api.get("/funcionarios")
def listar_funcionarios(auth: AuthLoja = Depends(exigir_admin_loja)) -> Any:
    return auth_service.listar_funcionarios(auth.loja_id)


@api.post("/funcionarios", status_code=status.HTTP_201_CREATED)
def criar_funcionario(
    body: Dict[str, Any], auth: AuthLoja = Depends(exigir_admin_loja)
) -> Dict[str, str]:
    return auth_service.criar_funcionario(auth.loja_id, body)


@api.patch("/funcionarios/{funcionario_id}", status_code=status.HTTP_204_NO_CONTENT)
def atualizar_funcionario(
    funcionario_id: str,
    body: Dict[str, Any],
    auth: AuthLoja = Depends(exigir_admin_loja),
) -> Response:
    auth_service.atualizar_funcionario(auth.loja_id, funcionario_id, body)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Produtos ---
@api.get("/produtos")
def listar_produtos(auth: AuthLoja = Depends(autenticar_loja)) -> Any:
    return produto_service.listar(auth.loja_id)


@api.post("/produtos", status_code=status.HTTP_201_CREATED)
def criar_produto(
    body: Dict[str, Any], auth: AuthLoja = Depends(exigir_admin_loja)
) -> Dict[str, str]:
    return produto_service.criar(auth.loja_id, body)


@api.put("/produtos/{produto_id}")
def atualizar_produto(
    produto_id: str,
    body: Dict[str, Any],
    auth: AuthLoja = Depends(exigir_admin_loja),
) -> Response:
    produto_service.atualizar(auth.loja_id, produto_id, body)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@api.delete("/produtos/{produto_id}")
def remover_produto(
    produto_id: str, auth: AuthLoja = Depends(exigir_admin_loja)
) -> Response:
    produto_service.remover(auth.loja_id, produto_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Vendas ---
@api.post("/vendas", status_code=status.HTTP_201_CREATED)
def registrar_venda(
    body: Dict[str, Any], auth: AuthLoja = Depends(autenticar_loja)
) -> Dict[str, Any]:
    return venda_service.registrar_venda(
        auth.loja_id,
        {"id": auth.funcionario_id, "nome": auth.nome},
        body,
    )


@api.get("/vendas")
def listar_vendas(
    limite: int = Query(default=100),
    auth: AuthLoja = Depends(autenticar_loja),
) -> Any:
    return venda_service.listar_vendas(auth.loja_id, limite=limite)


# --- Documentos flexiveis dos modulos avancados do desktop ---
@api.post("/dados/lote", status_code=status.HTTP_204_NO_CONTENT)
def atualizar_dados_lote(
    body: Dict[str, Any], auth: AuthLoja = Depends(autenticar_loja)
) -> Response:
    atualizacoes = body.get("atualizacoes") or {}
    _exigir_lote_dados(auth, atualizacoes)
    dados_service.atualizar_lote(auth.loja_id, atualizacoes)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@api.get("/dados/{caminho:path}")
def obter_dados(
    caminho: str, auth: AuthLoja = Depends(autenticar_loja)
) -> Dict[str, Any]:
    return {"valor": dados_service.obter(auth.loja_id, caminho)}


@api.put("/dados/{caminho:path}", status_code=status.HTTP_204_NO_CONTENT)
def definir_dados(
    caminho: str,
    body: Dict[str, Any],
    auth: AuthLoja = Depends(autenticar_loja),
) -> Response:
    _exigir_escrita_dados(auth, caminho)
    dados_service.definir(auth.loja_id, caminho, body.get("valor"))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@api.patch("/dados/{caminho:path}", status_code=status.HTTP_204_NO_CONTENT)
def mesclar_dados(
    caminho: str,
    body: Dict[str, Any],
    auth: AuthLoja = Depends(autenticar_loja),
) -> Response:
    _exigir_escrita_dados(auth, caminho)
    dados_service.mesclar(auth.loja_id, caminho, body.get("patch") or {})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@api.delete("/dados/{caminho:path}", status_code=status.HTTP_204_NO_CONTENT)
def remover_dados(
    caminho: str, auth: AuthLoja = Depends(autenticar_loja)
) -> Response:
    _exigir_escrita_dados(auth, caminho)
    dados_service.remover(auth.loja_id, caminho)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Pagamentos ---
@api.post("/pagamentos/checkout")
def criar_checkout(auth: AuthLoja = Depends(exigir_admin_loja)) -> Dict[str, str]:
    return pagamento_service.criar_checkout_assinatura(auth.loja_id)


@api.get("/pagamentos/assinatura")
def assinatura(auth: AuthLoja = Depends(autenticar_loja)) -> Dict[str, Any]:
    return pagamento_service.obter_assinatura(auth.loja_id)


@api.post("/pagamentos/webhook")
@limiter.limit("60/minute")
def webhook(request: Request, body: Optional[Dict[str, Any]] = None) -> Dict[str, bool]:
    # Aceita JSON (topic notifications) e query IPN (?topic=payment&id=...).
    payload = dict(body or {})
    for chave in ("type", "topic", "id", "data.id"):
        if chave not in payload and chave in request.query_params:
            payload[chave] = request.query_params.get(chave)
    if "data" not in payload and payload.get("id"):
        payload["data"] = {"id": payload.get("id")}
    if "type" not in payload and payload.get("topic"):
        payload["type"] = payload.get("topic")
    pagamento_service.processar_webhook(payload)
    return {"ok": True}


# --- Admin sistema ---
@api.post("/admin/bootstrap", status_code=status.HTTP_201_CREATED)
@limiter.limit("5/15minutes")
def admin_bootstrap(request: Request, body: Dict[str, Any]) -> Dict[str, str]:
    return admin_service.bootstrap_admin_sistema(
        nome=body.get("nome") or "",
        email=body.get("email") or "",
        senha=body.get("senha") or "",
        secret=body.get("secret") or "",
    )


@api.post("/admin/login")
@limiter.limit("20/15minutes")
def admin_login(request: Request, body: Dict[str, Any]) -> Dict[str, Any]:
    return admin_service.login_admin_sistema(
        email=body.get("email") or "", senha=body.get("senha") or ""
    )


@api.get("/admin/lojas")
def admin_listar_lojas(
    _admin: AuthAdminSistema = Depends(autenticar_admin_sistema),
) -> Any:
    return admin_service.listar_lojas_com_metricas()


@api.get("/admin/lojas/{loja_id}")
def admin_detalhar_loja(
    loja_id: str,
    _admin: AuthAdminSistema = Depends(autenticar_admin_sistema),
) -> Dict[str, Any]:
    return admin_service.detalhar_loja(loja_id)


@api.patch("/admin/lojas/{loja_id}/ativa")
def admin_definir_ativa(
    loja_id: str,
    body: Dict[str, Any],
    _admin: AuthAdminSistema = Depends(autenticar_admin_sistema),
) -> Response:
    if "ativa" not in (body or {}):
        raise ErroNegocio("Informe o campo ativa.")
    admin_service.definir_loja_ativa(loja_id, bool(body.get("ativa")))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@api.post("/admin/lojas", status_code=status.HTTP_201_CREATED)
def admin_criar_loja(
    body: Dict[str, Any],
    _admin: AuthAdminSistema = Depends(autenticar_admin_sistema),
) -> Dict[str, str]:
    return admin_service.criar_conta_loja(
        loja=body.get("loja") or {}, admin=body.get("admin") or {}
    )


@api.post("/admin/lojas/{loja_id}/regenerar-chave")
def admin_regenerar_chave(
    loja_id: str,
    _admin: AuthAdminSistema = Depends(autenticar_admin_sistema),
) -> Dict[str, str]:
    return admin_service.regenerar_chave_loja(loja_id)
