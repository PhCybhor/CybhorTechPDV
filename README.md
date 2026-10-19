# CybhorPDV

Sistema de ponto de venda (PDV) para loja, em desktop (Windows), construído com
**Electron**, API **Node.js (Express) + MySQL 8** (pasta `server/`). O backend
legado FastAPI + PostgreSQL permanece em `backend/` até o cutover completo.

## Baixar e instalar (usuarios da loja)

**Nao precisa baixar o codigo.** So o instalador:

1. Acesse **[Releases](https://github.com/PhCybhor/CybhorTechPDV/releases)**
2. Baixe o instalador (o mesmo serve para Windows 7, 8, 10 e 11):
   - **64 bits:** `CybhorPDV-Setup-x64.exe`
   - **32 bits:** `CybhorPDV-Setup-ia32.exe`
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

4. (Opcional) Configure a impressora no `.env`:
   - `IMPRESSORA_NOME` vazio = detecção automática da térmica pronta (WMI no Windows, CUPS no Linux/macOS);
     com um nome, ele tem prioridade enquanto estiver pronto
   - `LOJA_NOME`, `LOJA_CNPJ`, `LOJA_ENDERECO`, `LOJA_TELEFONE` — cabecalho do cupom
   - Linux/macOS: imprime pela fila CUPS em modo raw (`lp -o raw`)
   - `IMPRESSORA_MODO=teste` só grava o ESC/POS em `/tmp` (não imprime)

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

1. **Cadastro no site**: a loja é criada no site (pagamento/assinatura). O painel
   mostra o **código da loja** (ex.: `MP9S33`).
2. **Primeira instalação / caixas adicionais**: no desktop, tela **Conectar sua
   loja** → cole o código. O mesmo código serve em todos os PCs da loja.
3. O cabeçalho do cupom impresso usa o **perfil da loja** (não mais o `.env`).
4. A FastAPI valida o JWT e nunca aceita `loja_id` arbitrário nas operações.
5. Assinatura vencida/inadimplente segue liberada com banner de atraso; pendente
   e cancelada bloqueiam o acesso.

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

Os instaladores saem em `dist/`: `CybhorPDV-Setup-x64.exe` e
`CybhorPDV-Setup-ia32.exe`. Os dois usam o Electron 22 (o último que roda no
Windows 7) e servem para Windows 7, 8, 10 e 11. O arquivo `.env` é empacotado
nos recursos do aplicativo.

## GitHub Releases (distribuicao do instalador)

O instalador oficial e publicado automaticamente nas **Releases** do GitHub.

### Baixar a ultima versao

Acesse: [github.com/PhCybhor/CybhorTechPDV/releases](https://github.com/PhCybhor/CybhorTechPDV/releases)

Baixe `CybhorPDV-Setup-x64.exe` (ou `CybhorPDV-Setup-ia32.exe` em PCs 32 bits) e execute para instalar.

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
