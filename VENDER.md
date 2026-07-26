# Vender o CybhorPDV

## O que foi preparado

1. **Landing** em `landing/` — página de venda com checkout Mercado Pago  
2. **API** em `server/` — cria pagamento, webhook, emite licença e ativa o app  
3. **Multi-loja** — cada licença = `lojas/{lojaId}/…` (produtos, vendas e equipe isolados)  
4. **Licença criptografada** no PC (`licenca.enc` com AES-256-GCM)  
5. **Bundle ofuscado** no build (`javascript-obfuscator` + minify)

## Fluxo do cliente

1. Acessa a landing → preenche loja + e-mail → paga no Mercado Pago  
2. Na página de sucesso recebe a chave `CYB-…`  
3. Instala o CybhorPDV → tela **Ativar licença** → cola a chave  
4. Cria o admin da **sua** loja e usa o PDV  

Loja A nunca lê/escreve em Loja B: caminhos Firebase distintos.

## Subir a loja virtual (landing + API)

```bash
cd server
cp .env.example .env
# preencha MP_ACCESS_TOKEN, FIREBASE_DATABASE_URL, service account
npm install
npm start
```

Abra `http://localhost:8787`.

### Variáveis importantes (`server/.env`)

| Variável | Uso |
|---|---|
| `MP_ACCESS_TOKEN` | Token de produção/sandbox Mercado Pago |
| `CYBHOR_PUBLIC_URL` | URL pública (ex: `https://vendas.seudominio.com`) — obrigatória para webhook |
| `CYBHOR_PRECO` | Preço da licença (padrão 297) |
| `FIREBASE_DATABASE_URL` | Mesmo RTDB do app |
| `FIREBASE_SERVICE_ACCOUNT_FILE` | JSON da service account (Admin SDK) |
| `CYBHOR_MODO_DEV=1` | Permite `POST /api/dev/emitir` sem pagar |

Sem service account, o servidor grava licenças em `server/data/` (só para teste local).

## App desktop

No `.env` do app:

```
CYBHOR_API_URL=https://vendas.seudominio.com
CYBHOR_MODO_DEV=1
```

Em desenvolvimento, a chave `DEV-LOCAL` ativa uma loja isolada sem API.

Publique as regras: `database.rules.json` (raiz legada bloqueada; dados só em `lojas/{id}`).

## Build ofuscado + instalador

```bash
npm install
npm run build:renderer
npm run dist
```

O `renderer/js` **não** entra no instalador — só o `bundle.js` ofuscado.

## Checklist antes de vender de verdade

- [x] Landing page de venda
- [x] Checkout Mercado Pago + webhook + emissão de chave
- [x] Multi-loja (`lojas/{id}`) + rules
- [x] Licença criptografada no PC + tela de ativação
- [x] Bundle ofuscado no build
- [x] Histórico, cancelamento, configurações, estoque baixo
- [x] Fechamento de caixa do dia
- [x] Alterar senha de funcionário
- [x] Importação CSV de produtos
- [x] Migração de dados legados (`npm run migrar:legado`)
- [ ] `MP_ACCESS_TOKEN` de produção
- [ ] `CYBHOR_PUBLIC_URL` HTTPS com webhook acessível
- [ ] Service account Firebase no servidor
- [ ] Regras do RTDB publicadas no Console
- [ ] `CYBHOR_MODO_DEV=0` e `CYBHOR_API_URL` no `.env` do instalador
- [ ] SMTP configurado (e-mail da chave) — opcional
- [ ] Testar: compra sandbox → chave → 2 PCs / 2 lojas isoladas
- [ ] Publicar release no GitHub

## Observação de segurança

O isolamento por `lojaId` impede que uma loja atrapalhe a outra no uso normal.  
Quem tiver a URL do Firebase ainda poderia tentar ler IDs se forem adivinháveis — por isso usamos UUID e, no servidor, `licencas` com `.read/.write: false`.  
Para endurecer ainda mais no futuro: Firebase Auth + regras por token.
