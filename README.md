# CybhorPDV

Sistema de ponto de venda (PDV) para loja, em desktop (Windows), construído com
**Electron** e **Firebase Realtime Database**. Gera um instalador `.exe` para
distribuir nas máquinas.

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

## Segurança

- Senhas são armazenadas apenas como **hash PBKDF2 + salt** (nunca em texto
  puro).
- Nenhuma credencial fica no código-fonte — tudo vem do `.env`.
- As regras em `database.rules.json` são **abertas para funcionamento imediato**.
  Para produção, recomenda-se migrar a autenticação para o **Firebase
  Authentication** e restringir as regras por usuário autenticado.
