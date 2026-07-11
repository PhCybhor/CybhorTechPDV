# CybhorPDV

Sistema de ponto de venda (PDV) para loja, em desktop (Windows), construído com
**Electron** e **Firebase Realtime Database**.

## Baixar e instalar (usuarios da loja)

**Nao precisa baixar o codigo.** So o instalador:

1. Acesse **[Releases](https://github.com/cybhortech/sistemaPDV/releases)**
2. Baixe `CybhorPDV-Setup-2.0.0-x64.exe` (ou `-ia32.exe` em PCs 32 bits)
3. Instale e abra o CybhorPDV

Instrucoes detalhadas: [INSTALAR.md](INSTALAR.md)

---

## Principais recursos

- **Venda com carrinho** e baixa automática de estoque.
- **Desconto sobre o total** da venda, com registro do valor concedido.
- **Painel do administrador** mostrando as vendas com desconto e quanto foi
  concedido (além de métricas e gráficos de vendas).
- **Busca inteligente de produtos** tolerante a erros de digitação (fuzzy
  search com Fuse.js) — funciona como "indicação" do produto mais provável.
- **Cadastro rápido de produto durante a venda**: se o item buscado não existe
  ou está sem estoque, um botão permite cadastrá-lo na hora, sem atrapalhar a
  venda.
- **Controle de acesso**: login por usuário e senha (hash PBKDF2).
- **Criação e gerenciamento de funcionários** com alteração de cargo (área do
  administrador).
- **Credenciais fora do código** (arquivo `.env`).

## Arquitetura

```
sistemaPDV/
├── electron/            # Processo principal (main) e ponte segura (preload)
├── renderer/            # Front-end (interface do PDV)
│   ├── index.html
│   ├── styles.css
│   ├── js/
│   │   ├── config/      # Inicialização do Firebase
│   │   ├── services/    # Regras de negócio (auth, produtos, vendas, busca)
│   │   ├── ui/          # Componentes de interface (carrinho, notificações)
│   │   ├── utils/       # Utilitários (segurança, formatação)
│   │   └── app.js       # Orquestração da interface
│   └── dist/            # Bundle gerado (não versionado)
├── scripts/             # Script de build do renderer (esbuild)
├── database.rules.json  # Regras do Realtime Database
└── .env.example         # Modelo de variáveis de ambiente
```

O código do renderer é **empacotado e minificado/ofuscado** com o esbuild antes
do build do `.exe`. Apenas o bundle (`renderer/dist/bundle.js`) vai para o
instalador; o código-fonte legível não é incluído.

## Pré-requisitos

- [Node.js](https://nodejs.org/) 18+ (testado com Node 24)
- Um projeto no [Firebase](https://console.firebase.google.com/) com o
  **Realtime Database** ativado.

## Configuração

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Crie o arquivo `.env` a partir do modelo e preencha com as credenciais do seu
   projeto Firebase (Console Firebase → Configurações do projeto → SDK):

   ```bash
   copy .env.example .env
   ```

3. No Console do Firebase, publique as regras do arquivo `database.rules.json`
   no Realtime Database.

## Executar em desenvolvimento

```bash
npm start
```

No **primeiro acesso**, o sistema pede a criação do **administrador**. Depois,
faça login para abrir o PDV.

## Gerar o instalador `.exe`

```bash
npm run dist
```

O instalador é gerado em `dist/CybhorPDV-Setup-<versão>.exe`. O arquivo `.env`
é empacotado nos recursos do aplicativo.

## GitHub Releases (distribuicao do instalador)

O instalador oficial e publicado automaticamente nas **Releases** do GitHub.

### Baixar a ultima versao

Acesse: [github.com/cybhortech/sistemaPDV/releases](https://github.com/cybhortech/sistemaPDV/releases)

Baixe o arquivo `CybhorPDV-Setup-x.x.x.exe` e execute para instalar.

### Publicar uma nova versao

1. Atualize a `version` no `package.json`.
2. No GitHub, configure os **Secrets** do repositorio em  
   `Settings → Secrets and variables → Actions` com as variaveis do Firebase:
   - `FIREBASE_API_KEY`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_DATABASE_URL`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_STORAGE_BUCKET`
   - `FIREBASE_MESSAGING_SENDER_ID`
   - `FIREBASE_APP_ID`
   - `FIREBASE_MEASUREMENT_ID` (opcional)
3. Crie e envie uma tag de versao:

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

   O workflow `.github/workflows/release.yml` gera o `.exe` e publica na Release.

4. Ou dispare manualmente em **Actions → Release CybhorPDV → Run workflow**.

## Segurança

- Senhas são armazenadas apenas como **hash PBKDF2 + salt** (nunca em texto
  puro).
- Nenhuma credencial fica no código-fonte — tudo vem do `.env`.
- As regras em `database.rules.json` são **abertas para funcionamento imediato**.
  Para produção, recomenda-se migrar a autenticação para o **Firebase
  Authentication** e restringir as regras por usuário autenticado.
