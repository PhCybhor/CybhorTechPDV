# CybhorPDV

Sistema de ponto de venda (PDV) para loja, em desktop (Windows), construído com
**Electron** e **Firebase Realtime Database**.

## Baixar e instalar (usuários da loja)

1. Compre a **licença** (Mercado Pago) e guarde a chave `CYB-…`
2. Baixe o instalador nas **[Releases](https://github.com/cybhortech/sistemaPDV/releases)**
3. Abra o app → **Ativar licença** → crie o administrador da loja

Cada licença isola os dados em `lojas/{lojaId}/…` — lojas diferentes não se misturam.

Instruções: [INSTALAR.md](INSTALAR.md) · Venda/API: [VENDER.md](VENDER.md)

---

## Principais recursos

- **Licença por loja** com ativação criptografada no PC.
- **Venda com carrinho** e baixa automática de estoque.
- **Desconto, troco, histórico, cancelamento** e reimpressão de cupom.
- **Painel do administrador** com métricas, gráficos e PDF do dia.
- **Busca fuzzy** e cadastro rápido durante a venda.
- **Equipe** (admin/operador) com senhas em hash PBKDF2.
- **Configurações** de loja/impressora na interface.
- **Impressão** ESC/POS na Jetway JP-800.
- **Bundle ofuscado** no instalador (código-fonte não vai no `.exe`).

## Arquitetura

```
sistemaPDV/
├── electron/            # Main, preload, impressão, licença criptografada
├── renderer/            # Interface do PDV
├── landing/             # Página de venda
├── server/              # API Mercado Pago + emissão de licenças
├── scripts/             # Build ofuscado, migração, testes
├── database.rules.json  # Dados só em lojas/{lojaId}
└── VENDER.md            # Guia para colocar à venda
```

O renderer é **minificado e ofuscado** antes do `.exe`.

## Pré-requisitos

- [Node.js](https://nodejs.org/) 18+
- Projeto [Firebase](https://console.firebase.google.com/) com **Realtime Database**

## Configuração

1. `npm install` e `copy .env.example .env`
2. Preencha o Firebase no `.env`
3. Publique `database.rules.json`
4. Dev multi-loja: `CYBHOR_MODO_DEV=1` e chave `DEV-LOCAL` na ativação
5. (Opcional) Jetway: `IMPRESSORA_NOME`, dados `LOJA_*`

Migração de dados antigos (raiz → loja):

```bash
node scripts/migrar-loja-legado.mjs --lojaId=auto --nome="Minha Loja"
```

## Executar em desenvolvimento

```bash
npm start
```

Ative com `DEV-LOCAL` (se `CYBHOR_MODO_DEV=1`), depois crie o admin.

Landing + API local:

```bash
npm run start:vendas
```

## Gerar o instalador `.exe`

```bash
npm run dist
```

Para produção, use `CYBHOR_MODO_DEV=0` e `CYBHOR_API_URL` apontando para a API pública.

## GitHub Releases (distribuição do instalador)

O instalador oficial é publicado automaticamente nas **Releases** do GitHub.

### Baixar a última versão

Acesse: [github.com/cybhortech/sistemaPDV/releases](https://github.com/cybhortech/sistemaPDV/releases)

### Publicar uma nova versão

1. Atualize a `version` no `package.json`.
2. Configure os **Secrets** do Firebase no GitHub Actions.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`

## Segurança

- Senhas: **PBKDF2 + salt**
- Licença local: **AES-256-GCM**
- Bundle: **ofuscação** no build
- Credenciais só no `.env` / service account do servidor
- Dados por loja em `lojas/{uuid}/`; nós `licencas` e `pedidos` bloqueados nas rules
- Para endurecer ainda mais: Firebase Authentication nas rules
