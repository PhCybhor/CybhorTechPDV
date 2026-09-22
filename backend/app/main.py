from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import get_settings
from app.db import close_pool, init_pool
from app.errors import ErroNegocio
from app.http_seguranca import CabecalhosSeguranca
from app.routers.api import api, limiter

logger = logging.getLogger("cybhorpdv")
logging.basicConfig(level=logging.INFO)

BACKEND_DIR = Path(__file__).resolve().parent.parent
ADMIN_DIR = BACKEND_DIR / "public" / "admin"
# Local: sistemaPDV/landing. Docker: /app/landing (copiado na imagem).
_LANDING_CANDIDATOS = (
    BACKEND_DIR / "landing",
    BACKEND_DIR.parent / "landing",
)
LANDING_DIR = next((p for p in _LANDING_CANDIDATOS if p.is_dir()), _LANDING_CANDIDATOS[-1])


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    settings.validar_obrigatorias()
    init_pool()
    yield
    close_pool()


def criar_app() -> FastAPI:
    settings = get_settings()
    docs = None if settings.em_producao else "/api/docs"
    app = FastAPI(
        title="CybhorPDV API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url=docs,
        redoc_url=None,
        openapi_url=None if settings.em_producao else "/openapi.json",
    )
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(CabecalhosSeguranca)

    origens = list(settings.cors_lista)
    metodos = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    cabecalhos = ["Authorization", "Content-Type", "Accept"]
    if settings.em_producao:
        site = (settings.url_publica_site or "").rstrip("/")
        if site and site not in origens:
            origens.append(site)
        # Sem cookies: Bearer only. Electron file:// envia Origin null.
        # Sempre registra CORS em produção (mesmo sem CORS_ORIGENS) para o desktop.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origens,
            allow_origin_regex=r"^null$",
            allow_credentials=False,
            allow_methods=metodos,
            allow_headers=cabecalhos,
        )
    elif origens:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origens,
            allow_origin_regex=r"^null$",
            allow_credentials=False,
            allow_methods=metodos,
            allow_headers=cabecalhos,
        )
    else:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_credentials=False,
            allow_methods=metodos,
            allow_headers=cabecalhos,
        )

    @app.exception_handler(ErroNegocio)
    async def _erro_negocio(_request: Request, exc: ErroNegocio):
        return JSONResponse(status_code=exc.status, content={"erro": exc.mensagem})

    @app.exception_handler(HTTPException)
    async def _http_exception(_request: Request, exc: HTTPException):
        detalhe = exc.detail
        if isinstance(detalhe, dict) and "erro" in detalhe:
            corpo = detalhe
        else:
            corpo = {"erro": str(detalhe)}
        return JSONResponse(status_code=exc.status_code, content=corpo)

    @app.exception_handler(RequestValidationError)
    async def _validacao(_request: Request, exc: RequestValidationError):
        return JSONResponse(status_code=422, content={"erro": "Dados invalidos."})

    @app.exception_handler(Exception)
    async def _interno(request: Request, exc: Exception):
        logger.exception("%s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={"erro": "Erro interno. Tente novamente em instantes."},
        )

    app.include_router(api, prefix="/api")

    if ADMIN_DIR.is_dir():
        # StaticFiles exige /admin/ — redireciona /admin sem barra.
        @app.get("/admin", include_in_schema=False)
        def _admin_sem_barra() -> RedirectResponse:
            return RedirectResponse(url="/admin/", status_code=307)

        app.mount("/admin", StaticFiles(directory=str(ADMIN_DIR), html=True), name="admin")
    if LANDING_DIR.is_dir():
        app.mount("/", StaticFiles(directory=str(LANDING_DIR), html=True), name="landing")

    return app


app = criar_app()
