# Checklist pré-deploy (Cybhor PDV SaaS)

Após o pull de `main` (merges de 2026-09: webhook, índice pagamentos, CORS, `/api/saude`). Detalhes longos: `backend/README.md`.

## 1. `MP_WEBHOOK_SECRET` no `.env` da API

Obrigatório em produção (`NODE_ENV=production`). Sem isto o boot **falha**.
Valor = segredo do webhook no painel Mercado Pago. Modelo: `backend/.env.example`.

## 2. Migrate do índice

Em banco já existente:

```bash
psql "$DATABASE_URL" -f backend/db/migrate-idx-pagamentos-loja-criado.sql
```

Idempotente (`CREATE INDEX IF NOT EXISTS idx_pagamentos_loja_criado`).

## 3. URLs públicas e CORS

Confirmar no `.env` da API (valores reais do ambiente, sem `*`):

- `URL_PUBLICA_API` — `https://…` (obrigatória em produção)
- `URL_PUBLICA_SITE`
- `CORS_ORIGENS` — origens do site/admin (Electron `file://` já é tratado no código)

## 4. Deploy automático

- **API + landing:** push na `main` em `backend/` ou `landing/` roda `.github/workflows/deploy-vps.yml` (testes → build → checagem do `.env` → troca do container, com rollback). Script na VPS: `backend/deploy/vps-deploy.sh`.
- **App desktop:** push na `main` em `electron/`, `renderer/`, `build/`, `package.json`… roda `.github/workflows/release.yml`. A versão sobe sozinha (próximo patch da última tag); para minor/major, suba o `version` do `package.json`. Os instaladores vão para o GitHub Releases e para o painel do cliente (`backend/deploy/vps-publicar-instaladores.sh`), com a versão nova em destaque e as 4 anteriores abaixo.
- **Republicar uma versão antiga no painel:** Actions → "Publicar instaladores na VPS" → informar a versão.

## 5. Smoke pós-subir

1. `GET /api/saude` — 200 com DB ok; 503 se Postgres inacessível
2. Login loja (código + usuário + senha)
3. Uma venda de teste (baixa de estoque)
4. Webhook MP — notificação de teste / pagamento sandbox chega e assina com o segredo configurado

Reiniciar o processo da API (systemd/uvicorn/PM2) depois de alterar o `.env`.
