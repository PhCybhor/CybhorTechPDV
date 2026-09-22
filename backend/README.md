# CybhorPDV — API (Python / FastAPI + PostgreSQL)

API multi-loja do CybhorPDV. Os dados (lojas, funcionários, produtos, vendas)
ficam em PostgreSQL. Inclui o painel do administrador do sistema e pagamentos
via Mercado Pago.

O app desktop consome esta API diretamente. Os módulos principais usam tabelas
relacionais e os módulos flexíveis usam `documentos_loja.dados` (JSONB), sempre
isolados pelo `loja_id` presente no JWT.

## Estrutura

```
backend/
├── app/
│   ├── main.py              # FastAPI: CORS, static, handlers
│   ├── config.py            # variáveis de ambiente
│   ├── db.py                # pool psycopg2 + transações
│   ├── deps.py              # JWT (loja × admin sistema)
│   ├── security.py          # PBKDF2 (mesmo formato do PDV)
│   ├── routers/api.py       # rotas /api/*
│   └── services/            # regra de negócio
├── db/schema.sql            # Schema completo do banco
├── docker-compose.yml       # PostgreSQL local
├── public/admin/            # Painel do administrador (/admin)
├── scripts/criar_admin_sistema.py
└── requirements.txt
```

## Rodando localmente

```bash
cd backend
python3 -m pip install --user -r requirements.txt
# ou: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

docker-compose up -d                 # sobe o PostgreSQL
cp .env.example .env                 # preencha JWT_SEGREDO (openssl rand -hex 32)
# aplicar schema:
docker exec -i cybhorpdv-postgres psql -U cybhor -d cybhorpdv < db/schema.sql

python3 scripts/criar_admin_sistema.py "Pedro" voce@dominio.com "senha-forte"
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 3333 --reload
```

- API: `http://localhost:3333/api/saude`
- Docs OpenAPI: `http://localhost:3333/api/docs`
- Painel do administrador: `http://localhost:3333/admin`
- Landing: `http://localhost:3333/`

## Principais rotas

| Método | Rota | Autenticação | Descrição |
| --- | --- | --- | --- |
| POST | `/api/lojas` | — | Cria loja + admin inicial, devolve código |
| POST | `/api/lojas/conectar` | — | Conecta um caixa pelo código da loja |
| POST | `/api/auth/login` | — | Login do funcionário (código + usuário + senha) |
| GET/POST | `/api/produtos` | JWT loja | Produtos (escrita só admin da loja) |
| POST/GET | `/api/vendas` | JWT loja | Registrar/listar vendas (baixa de estoque atômica) |
| POST | `/api/pagamentos/checkout` | JWT admin loja | Gera link de pagamento do Mercado Pago |
| POST | `/api/pagamentos/webhook` | — | Notificações do Mercado Pago |
| POST | `/api/admin/login` | — | Login do administrador do sistema |
| GET | `/api/admin/lojas` | JWT admin sistema | Métricas + uso de dados por loja |
| PATCH | `/api/admin/lojas/:id/ativa` | JWT admin sistema | Bloquear/liberar loja |
| POST | `/api/admin/lojas` | JWT admin sistema | Criar loja + admin e devolver a chave |
| POST | `/api/admin/lojas/:id/regenerar-chave` | JWT admin sistema | Gerar nova chave de conexao |

## Segurança

- Senhas com PBKDF2 (150k iterações, SHA-256) e comparação em tempo constante.
- Consultas SQL parametrizadas (`%s`) — sem SQL Injection.
- JWT com escopos separados: funcionário de loja × administrador do sistema.
- Rate limit nas rotas de login/credencial (20/15min).
- Erros retornam `{ "erro": "..." }`; o stack trace fica só no log do servidor.
- O total da venda é recalculado no servidor — o cliente não dita preços.
- Webhook do Mercado Pago reconsulta o pagamento na API do MP antes de ativar.
- Em produção o webhook exige `MP_WEBHOOK_SECRET` (assinatura `x-signature`); ausente → a API não inicia.
- CORS: origens em `CORS_ORIGENS` + site público; Electron `file://` (`Origin: null`) é permitido por regex — não use `*` em produção.

## Deploy na VPS (Ubuntu + nginx + HTTPS)

1. Instale Python 3.10+, PostgreSQL e nginx.
2. Crie o banco e aplique `db/schema.sql`.
3. `pip install -r requirements.txt` (ou venv) e configure o `.env`.

   Em **produção** (`NODE_ENV=production`) o boot chama `validar_obrigatorias()` e **falha** se faltar:
   - `DATABASE_URL`
   - `JWT_SEGREDO` (≥ 32 caracteres)
   - `MP_ACCESS_TOKEN`
   - **`MP_WEBHOOK_SECRET`** (segredo do webhook no painel Mercado Pago; sem isto a API não sobe — PR #13)
   - `URL_PUBLICA_API` começando com `https://`

   Modelo: `backend/.env.example`. Nunca versione o `.env` real.
4. Rode com systemd/uvicorn ou PM2:

```bash
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 3333
```

5. Configure o nginx como proxy reverso para `127.0.0.1:3333` e emita o HTTPS com certbot (mesmo padrão do README anterior).
