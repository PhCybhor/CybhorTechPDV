from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.config import get_settings

TAMANHO_MAX_REQUISICAO = 512 * 1024

CSP = (
    "default-src 'self'; "
    "base-uri 'self'; "
    "object-src 'none'; "
    "frame-ancestors 'none'; "
    "script-src 'self' https://sdk.mercadopago.com https://http2.mlstatic.com "
    "https://www.mercadopago.com https://www.mercadopago.com.br; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com data:; "
    "img-src 'self' data: https:; "
    "connect-src 'self' https://api.mercadopago.com https://api.mercadopago.com.br "
    "https://www.mercadopago.com https://www.mercadopago.com.br; "
    "frame-src https://www.mercadopago.com https://www.mercadopago.com.br "
    "https://http2.mlstatic.com; "
    "form-action 'self' https://www.mercadopago.com https://www.mercadopago.com.br"
)


class CabecalhosSeguranca(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        tamanho = request.headers.get("content-length")
        if tamanho:
            try:
                if int(tamanho) > TAMANHO_MAX_REQUISICAO:
                    return JSONResponse(
                        status_code=413, content={"erro": "Requisicao grande demais."}
                    )
            except ValueError:
                return JSONResponse(
                    status_code=400, content={"erro": "Requisicao invalida."}
                )

        resposta = await call_next(request)
        resposta.headers["X-Content-Type-Options"] = "nosniff"
        resposta.headers["X-Frame-Options"] = "DENY"
        resposta.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        resposta.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), payment=()"
        )
        resposta.headers["Content-Security-Policy"] = CSP
        resposta.headers["X-DNS-Prefetch-Control"] = "off"
        if get_settings().em_producao:
            resposta.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return resposta
