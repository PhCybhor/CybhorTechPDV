# CybhorPDV — API (PostgreSQL)

API multi-loja do CybhorPDV. Substitui o Firebase como backend: os dados
(lojas, funcionários, produtos, vendas) ficam em PostgreSQL na sua VPS.
Inclui o painel do administrador do sistema e pagamentos via Mercado Pago.

> O app desktop atual continua no Firebase e **não foi alterado**. A troca
> para esta API será feita depois, quando a VPS e o domínio estiverem prontos.

## Estrutura

```
backend/
├── db/schema.sql            # Schema completo do banco
├── docker-compose.yml       # PostgreSQL local para desenvolvimento
├── public/admin/            # Painel do administrador do sistema (/admin)
├── scripts/
│   └── criar-admin-sistema.js
└── src/
    ├── config/              # env + pool do PostgreSQL
    ├── controllers/         # rotas apontam para cá (camada fina)
    ├── middlewares/         # JWT, tratamento de erros
    ├── routes/              # definição das rotas /api/*
    ├── services/            # regra de negócio (SQL parametrizado)
    └── utils/               # hash de senha PBKDF2
```

## Rodando localmente

```bash
cd backend
npm install
docker compose up -d                 # sobe o PostgreSQL
cp .env.example .env                 # preencha JWT_SEGREDO (openssl rand -hex 32)
npm run db:schema                    # cria as tabelas
npm run admin:criar "Pedro" voce@dominio.com "senha-forte"
npm run dev
```

- API: `http://localhost:3333/api/saude`
- Painel do administrador: `http://localhost:3333/admin`

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
| GET | `/api/admin/lojas` | JWT admin sistema | Métricas + uso de dados (GB) por loja |
| PATCH | `/api/admin/lojas/:id/ativa` | JWT admin sistema | Bloquear/liberar loja |

## Segurança

- Senhas com PBKDF2 (150k iterações, SHA-256) e comparação em tempo constante.
- Todas as consultas SQL usam parâmetros (`$1, $2...`) — sem SQL Injection.
- JWT com escopos separados: funcionário de loja × administrador do sistema.
- `helmet`, CORS restrito por domínio e rate limit (20 tentativas de login/15min).
- Erros retornam mensagem amigável; o stack trace fica só no log do servidor.
- O total da venda é recalculado no servidor — o cliente não dita preços.
- Webhook do Mercado Pago não confia no corpo recebido: o pagamento é
  reconsultado direto na API do MP antes de atualizar o banco.

## Deploy na VPS (Ubuntu + nginx + HTTPS)

1. **Instalar dependências**

```bash
sudo apt update && sudo apt install -y nginx postgresql certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
```

2. **Banco**

```bash
sudo -u postgres createuser cybhor -P
sudo -u postgres createdb cybhorpdv -O cybhor
psql "postgres://cybhor:SENHA@localhost:5432/cybhorpdv" -f db/schema.sql
```

3. **API com PM2** (reinicia sozinha se cair)

```bash
sudo npm install -g pm2
cd /var/www/cybhorpdv/backend && npm install --omit=dev
cp .env.example .env   # preencher com valores de produção
pm2 start src/server.js --name cybhorpdv-api
pm2 save && pm2 startup
```

4. **nginx como proxy reverso** (`/etc/nginx/sites-available/cybhorpdv`)

```nginx
server {
    server_name api.SEUDOMINIO.com.br;

    location / {
        proxy_pass http://127.0.0.1:3333;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    server_name SEUDOMINIO.com.br;
    root /var/www/cybhorpdv/landing;
    index index.html;
}
```

5. **HTTPS gratuito (Let's Encrypt)** — renova sozinho:

```bash
sudo ln -s /etc/nginx/sites-available/cybhorpdv /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d SEUDOMINIO.com.br -d api.SEUDOMINIO.com.br
```

6. **Depois do deploy**: preencha `URL_PUBLICA_API` no `.env` com
   `https://api.SEUDOMINIO.com.br` e cadastre essa URL de webhook no painel
   do Mercado Pago.

## Uso de dados por loja

O painel `/admin` mostra, por loja: funcionários, produtos, vendas,
faturamento e o **uso de armazenamento** (KB/MB/GB), calculado com
`pg_column_size` sobre as linhas reais de cada tabela da loja.
