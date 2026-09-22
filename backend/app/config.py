from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuração central. Falha cedo se faltarem segredos obrigatórios."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = Field(default="", alias="DATABASE_URL")
    porta: int = Field(default=3333, alias="PORT")
    jwt_segredo: str = Field(default="", alias="JWT_SEGREDO")
    jwt_expiracao: str = Field(default="12h", alias="JWT_EXPIRACAO")
    cors_origens: str = Field(default="", alias="CORS_ORIGENS")
    node_env: str = Field(default="", alias="NODE_ENV")

    mp_app_id: str = Field(default="", alias="MP_APP_ID")
    mp_client_id: str = Field(default="", alias="MP_CLIENT_ID")
    mp_access_token: str = Field(default="", alias="MP_ACCESS_TOKEN")
    mp_client_secret: str = Field(default="", alias="MP_CLIENT_SECRET")
    mp_public_key: str = Field(default="", alias="MP_PUBLIC_KEY")
    mp_webhook_secret: str = Field(default="", alias="MP_WEBHOOK_SECRET")
    assinatura_valor_mensal: float = Field(default=99.9, alias="ASSINATURA_VALOR_MENSAL")
    assinatura_valor_semestral: float = Field(
        default=499.9, alias="ASSINATURA_VALOR_SEMESTRAL"
    )
    assinatura_valor_anual: float = Field(default=899.9, alias="ASSINATURA_VALOR_ANUAL")
    url_publica_api: str = Field(default="", alias="URL_PUBLICA_API")
    url_publica_site: str = Field(default="http://localhost:3333", alias="URL_PUBLICA_SITE")
    # Permite ativar o desktop com a chave DEV-LOCAL mesmo em produção
    # (útil enquanto o app Electron aponta para a VPS).
    permitir_dev_local: bool = Field(default=False, alias="CYBHOR_PERMITIR_DEV_LOCAL")
    admin_bootstrap_secret: str = Field(default="", alias="ADMIN_BOOTSTRAP_SECRET")

    @property
    def cors_lista(self) -> List[str]:
        return [o.strip() for o in self.cors_origens.split(",") if o.strip()]

    @property
    def em_producao(self) -> bool:
        return (self.node_env or "").strip().lower() in ("production", "prod")

    def validar_obrigatorias(self) -> None:
        faltando = []
        if not self.database_url:
            faltando.append("DATABASE_URL")
        if not self.jwt_segredo or len(self.jwt_segredo) < 32:
            faltando.append("JWT_SEGREDO (minimo 32 caracteres)")
        if self.em_producao:
            if not self.mp_access_token:
                faltando.append("MP_ACCESS_TOKEN")
            if not (self.mp_webhook_secret or "").strip():
                faltando.append("MP_WEBHOOK_SECRET")
            if not (self.url_publica_api or "").startswith("https://"):
                faltando.append("URL_PUBLICA_API (https)")
        if faltando:
            raise RuntimeError(
                f"Variaveis de ambiente ausentes/invalidas: {', '.join(faltando)}"
            )


@lru_cache()
def get_settings() -> Settings:
    return Settings()
