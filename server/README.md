# CybhorPDV — API (Node.js / Express + MySQL 8)

API multi-loja do CybhorPDV. Substitui o backend FastAPI + PostgreSQL
(`../backend/`) mantendo o mesmo contrato HTTP/JWT para o desktop e a landing.

## Rodando localmente

```bash
cd server
cp .env.example .env   # preencha JWT_SEGREDO, MYSQL_* e DATABASE_URL
docker compose up -d   # MySQL 8 + schema na 1ª subida
npm install
npm run dev            # http://localhost:3333
```

- Saúde: `GET /api/saude`
- Admin: `http://localhost:3333/admin/`
- Landing: `http://localhost:3333/`

Criar admin do sistema:

```bash
npm run admin:criar -- "Pedro" voce@dominio.com "senha-forte"
```

Migrar dados do PostgreSQL legado para este MySQL:

```bash
SOURCE_DATABASE_URL=postgres://usuario:senha@host:5432/cybhorpdv npm run db:migrar-pg
```

## Deploy (Hostinger Web Apps / VPS)

1. Crie um banco **MySQL 8** no hPanel e aplique `db/schema.mysql.sql`.
2. Configure as variáveis de `.env.example` (em produção: `NODE_ENV=production`,
   `JWT_SEGREDO` ≥ 32 chars, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`,
   `URL_PUBLICA_API` em `https://…`).
3. Publique esta pasta como Web App Node (entry: `src/index.js`, start: `npm start`)
   ou rode com Docker a partir de `sistemaPDV/`:

```bash
docker build -f server/Dockerfile -t cybhorpdv-api .
docker run -d --env-file server/.env -p 127.0.0.1:3333:3333 cybhorpdv-api
```

4. Aponte o domínio (`cybhor.tech` ou subdomínio) para o processo Node e
   cadastre o webhook do Mercado Pago em `URL_PUBLICA_API/api/pagamentos/webhook`.

O desktop Electron continua apontando para a URL pública da API — o contrato
`/api/*` é o mesmo do Python.
