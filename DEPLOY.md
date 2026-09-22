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

## 4. Desktop ≥ 2.1.12

Após o pull, rebuild/empacotar o instalador (`npm run dist:win10` / `dist:win7`) e republicar o release. Builds antigos não trazem os fixes do renderer/Electron.

## 5. Smoke pós-subir

1. `GET /api/saude` — 200 com DB ok; 503 se Postgres inacessível
2. Login loja (código + usuário + senha)
3. Uma venda de teste (baixa de estoque)
4. Webhook MP — notificação de teste / pagamento sandbox chega e assina com o segredo configurado

Reiniciar o processo da API (systemd/uvicorn/PM2) depois de alterar o `.env`.
