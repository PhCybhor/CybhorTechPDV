# CybhorPDV

Sistema de ponto de venda (PDV) para loja, em desktop (Windows), construído com
**Electron**, **FastAPI (Python)** e **PostgreSQL**.

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
- **Impressão automática do cupom** na impressora térmica Jetway ao finalizar a venda.
- **Multi-loja**: cada loja tem produtos, vendas e equipe isolados. Novos
  caixas conectam-se com o **código da loja** (visível na tela Equipe).

## Arquitetura

```
sistemaPDV/
├── electron/            # Processo principal (main), preload e impressao Jetway
│   └── impressao/       # Layout do cupom 80mm e envio silencioso a impressora
├── renderer/            # Front-end (interface do PDV)
│   ├── index.html
│   ├── styles.css
│   ├── js/
│   │   ├── config/      # Cliente HTTP da FastAPI
│   │   ├── services/    # Regras de negócio (auth, produtos, vendas, busca)
│   │   ├── ui/          # Componentes de interface (carrinho, notificações)
│   │   ├── utils/       # Utilitários (segurança, formatação)
│   │   └── app.js       # Orquestração da interface
│   └── dist/            # Bundle gerado (não versionado)
├── scripts/             # Script de build do renderer (esbuild)
├── backend/             # FastAPI, PostgreSQL e painel administrativo
└── .env.example         # Modelo de variáveis de ambiente
```

O código do renderer é **empacotado e minificado/ofuscado** com o esbuild antes
do build do `.exe`. Apenas o bundle (`renderer/dist/bundle.js`) vai para o
instalador; o código-fonte legível não é incluído.

## Pré-requisitos

- [Node.js](https://nodejs.org/) 18+ (testado com Node 24)
- Python 3.8+ e PostgreSQL 16 (Docker disponível para desenvolvimento).

## Configuração

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Crie o arquivo `.env` a partir do modelo. Em desenvolvimento, a API usa
   `http://localhost:3333`:

   ```bash
   copy .env.example .env
   ```

3. Suba o PostgreSQL e a FastAPI conforme `backend/README.md`.

4. (Opcional) Configure a impressora Jetway JP-800 no `.env`:
   - `IMPRESSORA_NOME=Jetway JP-800` (nome criado pelo driver oficial)
   - `LOJA_NOME`, `LOJA_CNPJ`, `LOJA_ENDERECO`, `LOJA_TELEFONE` — cabecalho do cupom
   - Em desenvolvimento Linux: `IMPRESSORA_MODO=teste` (grava o ESC/POS em `/tmp`)

Materiais oficiais em `vendor/jp800/` (Driver + Exemplo Delphi). No Windows,
rode `scripts/instalar-driver-jp800-windows.bat` ou o
`JetwayPrinterDriverJP-800.exe`. O PDV imprime em **ESC/POS RAW** (igual ao
exemplo Delphi com `WritePrinter` / porta COM).

Teste local do cupom (sem impressora):

```bash
npm run test:impressao
```

## Vender para várias lojas (multi-loja)

O banco é compartilhado, mas cada registro/documento possui isolamento por
`loja_id`, obtido exclusivamente do JWT:

1. **Primeira instalação da loja**: abra o app → aba **Criar loja** → preencha
   nome/CNPJ/endereço/telefone. O app gera um **código de loja** (ex.: `7KQ2MD`).
2. **Caixas adicionais**: no novo PC, aba **Já tenho código** → digite o código.
   O código fica visível para o admin na tela **Equipe**.
3. O cabeçalho do cupom impresso usa o **perfil da loja** (não mais o `.env`).
4. A FastAPI valida o JWT e nunca aceita `loja_id` arbitrário nas operações.

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
2. Configure a URL pública da FastAPI no `.env` usado pelo instalador.
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
- A FastAPI usa JWT com escopo de loja, SQL parametrizado e transações para
  impedir acesso entre lojas e inconsistências de estoque.
