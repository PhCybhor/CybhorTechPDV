# Operar by Cybhor — Fase 0 Identidade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a identidade visível de **CybhorPDV** para **Operar by Cybhor**, manter PDV/Caixa como módulo do pack Comércio, e introduzir metadados núcleo×pack em `MODULOS_LOJA` — sem quebrar licença, `userData`, backups nem downloads.

**Architecture:** Constante central de marca (`marcaProduto.js`) consumida pelo renderer/Electron; landing e docs usam o mesmo wording; `appId` / paths de dados / nome de artefato de instalador permanecem estáveis nesta fase (alias legado). Taxonomia de módulos ganha campo `camada` (`nucleo` | `comercio`) sem mudar chaves persistidas.

**Tech Stack:** Electron 22, renderer JS (esbuild), landing HTML estático, electron-builder, scripts Node de teste existentes.

**Spec:** `docs/superpowers/specs/2026-11-08-operar-plataforma-modular-design.md` (Fase 0).

**Escopo deste plano:** só Fase 0. Fases 1–4 (financeiro, compras, caixa fechado, polimento) → planos separados depois.

## Global Constraints

- Nome de produto: **Operar by Cybhor**
- Tagline: “Sua loja inteira, não só o caixa.”
- Manter `appId`: `com.cybhor.pdv` (não mudar — preserva `userData` / licença)
- Manter `name` npm: `cybhor-pdv` nesta fase
- Manter `artifactName` / arquivos `CybhorPDV-Setup-*.exe` nesta fase (catálogo `instaladoresService` e releases)
- Backup JSON: aceitar `app` = `CybhorPDV` **ou** `Operar` (gravar novos como `Operar`)
- Chaves `modulo*` em config da loja: **não renomear**
- Commit git: só se o usuário pedir
- Não implementar AP/AR, compras nem conciliação neste plano

## File map

| Arquivo | Responsabilidade |
|---------|------------------|
| `sistemaPDV/renderer/js/config/marcaProduto.js` | Constantes de marca (criar) |
| `sistemaPDV/renderer/index.html` | Títulos, alt, sidebar, login |
| `sistemaPDV/renderer/js/app.js` | `document.title`, mensagens |
| `sistemaPDV/electron/main.js` | Título da janela, diálogos |
| `sistemaPDV/electron/licencaApi.js` | Mensagem “conectado ao servidor…” |
| `sistemaPDV/electron/iaAnexos.js` | Aceitar app legado + novo |
| `sistemaPDV/renderer/js/services/iaComandos.js` | Idem import backup |
| `sistemaPDV/renderer/js/utils/aparencia.js` | `camada` em `MODULOS_LOJA` |
| `sistemaPDV/renderer/js/ui/configuracoes.js` | Texto ajuda módulos (núcleo/pack) |
| `sistemaPDV/package.json` | `description`, `productName`, atalhos NSIS (não artifact) |
| `sistemaPDV/landing/*.html` | Marca site + copy |
| `sistemaPDV/README.md`, `INSTALAR.md`, `CHANGELOG.md` | Docs usuário |
| `sistemaPDV/scripts/testar-marca-produto.mjs` | Teste de constantes + grep guard (criar) |
| `sistemaPDV/scripts/testar-ia-anexos.js` | Aceitar ambos apps |

---

### Task 1: Constantes de marca + teste

**Files:**
- Create: `sistemaPDV/renderer/js/config/marcaProduto.js`
- Create: `sistemaPDV/scripts/testar-marca-produto.mjs`

**Interfaces:**
- Produces:
  - `export const NOME_PRODUTO = "Operar"`
  - `export const NOME_PRODUTO_COMPLETO = "Operar by Cybhor"`
  - `export const MARCA_PUBLISHER = "Cybhor"`
  - `export const TAGLINE = "Sua loja inteira, não só o caixa."`
  - `export const APP_BACKUP_ATUAL = "Operar"`
  - `export const APP_BACKUP_LEGADOS = Object.freeze(["CybhorPDV"])`
  - `export function appBackupValido(app) → boolean`

- [ ] **Step 1: Write the failing test**

```js
// sistemaPDV/scripts/testar-marca-produto.mjs
import assert from "node:assert/strict";
import {
  NOME_PRODUTO,
  NOME_PRODUTO_COMPLETO,
  TAGLINE,
  APP_BACKUP_ATUAL,
  appBackupValido,
} from "../renderer/js/config/marcaProduto.js";

assert.equal(NOME_PRODUTO, "Operar");
assert.equal(NOME_PRODUTO_COMPLETO, "Operar by Cybhor");
assert.match(TAGLINE, /loja inteira/i);
assert.equal(APP_BACKUP_ATUAL, "Operar");
assert.equal(appBackupValido("Operar"), true);
assert.equal(appBackupValido("CybhorPDV"), true);
assert.equal(appBackupValido("Outro"), false);
console.log("ok: marcaProduto");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node sistemaPDV/scripts/testar-marca-produto.mjs`  
Expected: FAIL (módulo não existe / ERR_MODULE_NOT_FOUND)

- [ ] **Step 3: Write minimal implementation**

```js
// sistemaPDV/renderer/js/config/marcaProduto.js
export const NOME_PRODUTO = "Operar";
export const NOME_PRODUTO_COMPLETO = "Operar by Cybhor";
export const MARCA_PUBLISHER = "Cybhor";
export const TAGLINE = "Sua loja inteira, não só o caixa.";
export const APP_BACKUP_ATUAL = "Operar";
export const APP_BACKUP_LEGADOS = Object.freeze(["CybhorPDV"]);

export function appBackupValido(app) {
  if (typeof app !== "string") return false;
  if (app === APP_BACKUP_ATUAL) return true;
  return APP_BACKUP_LEGADOS.includes(app);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node sistemaPDV/scripts/testar-marca-produto.mjs`  
Expected: `ok: marcaProduto`

- [ ] **Step 5: Commit** (só se o usuário pedir)

```bash
git add sistemaPDV/renderer/js/config/marcaProduto.js sistemaPDV/scripts/testar-marca-produto.mjs
git commit -m "$(cat <<'EOF'
feat: add Operar by Cybhor brand constants

EOF
)"
```

---

### Task 2: UI desktop (HTML + título Electron/renderer)

**Files:**
- Modify: `sistemaPDV/renderer/index.html` (title, alts, h1 login, sidebar `<strong>`)
- Modify: `sistemaPDV/renderer/js/app.js` (~L436 `document.title`, ~L842 mensagem servidor)
- Modify: `sistemaPDV/electron/main.js` (~L254 `setTitle`, ~L289–298 diálogos)
- Modify: `sistemaPDV/electron/licencaApi.js` (~L64 mensagem conectado)

**Interfaces:**
- Consumes: strings de `marcaProduto.js` no renderer; no Electron main usar literais iguais (CommonJS sem import ESM do renderer) — duplicar só as 2 strings `Operar` / `Operar by Cybhor` no main **ou** `require` de um `electron/marcaProduto.cjs` espelho. Preferência: criar `sistemaPDV/electron/marcaProduto.cjs` com os mesmos valores para o processo main.

- [ ] **Step 1: Espelho CommonJS para o main**

Create `sistemaPDV/electron/marcaProduto.cjs`:

```js
module.exports = {
  NOME_PRODUTO: "Operar",
  NOME_PRODUTO_COMPLETO: "Operar by Cybhor",
  TAGLINE: "Sua loja inteira, não só o caixa.",
  APP_BACKUP_ATUAL: "Operar",
  APP_BACKUP_LEGADOS: Object.freeze(["CybhorPDV"]),
  appBackupValido(app) {
    if (typeof app !== "string") return false;
    if (app === this.APP_BACKUP_ATUAL) return true;
    return this.APP_BACKUP_LEGADOS.includes(app);
  },
};
```

Estender `testar-marca-produto.mjs` para `require` desse arquivo e assert igualdade com o ESM.

- [ ] **Step 2: Atualizar `index.html`**

Trocas visíveis (manter estrutura):

- `<title>Operar by Cybhor</title>`
- `alt="Operar by Cybhor"` nas logos de loading/login
- `<h1 class="titulo">Operar</h1>` + subtítulo opcional com tagline curta se couber sem poluir
- Sidebar: `<strong>Operar</strong>` e, se houver espaço, `<span class="sidebar-by">by Cybhor</span>` (CSS mínimo existente / classe nova só se necessário)

Nav `#nav-pdv` permanece rótulo **Caixa** (já está correto).

- [ ] **Step 3: `app.js` title + mensagem**

Importar `NOME_PRODUTO_COMPLETO` de `./config/marcaProduto.js` e:

```js
document.title = `${NOME_PRODUTO_COMPLETO} ${versao}`;
// ...
mensagem: `Conectado ao servidor ${NOME_PRODUTO_COMPLETO}.`,
```

- [ ] **Step 4: `main.js` + `licencaApi.js`**

```js
const { NOME_PRODUTO, NOME_PRODUTO_COMPLETO } = require("./marcaProduto.cjs");
janela.setTitle(`${NOME_PRODUTO} ${app.getVersion()}`);
// diálogos de crash: usar NOME_PRODUTO_COMPLETO
```

Em `licencaApi.js`: mensagem com `Operar by Cybhor`.

- [ ] **Step 5: Verificação manual rápida**

Run: `cd sistemaPDV && npm run build:renderer`  
Expected: build ok. Abrir `npm start` e conferir login + sidebar + título da janela = Operar / Operar by Cybhor.

- [ ] **Step 6: Commit** (só se o usuário pedir)

---

### Task 3: Backup / IA — aceitar legado + novo

**Files:**
- Modify: `sistemaPDV/electron/iaAnexos.js` (~L56)
- Modify: `sistemaPDV/renderer/js/services/iaComandos.js` (~L477–478)
- Modify: `sistemaPDV/electron/agentTools.js` (texto da tool)
- Modify: `sistemaPDV/scripts/testar-ia-anexos.js`
- Modify: `sistemaPDV/scripts/testar-ia-tools.js` (payloads de exemplo: testar com ambos)

**Interfaces:**
- Consumes: `appBackupValido` / lista legada
- Produces: import OK para `app: "CybhorPDV"` e `app: "Operar"`; novos exports usam `APP_BACKUP_ATUAL`

- [ ] **Step 1: Ajustar teste anexos**

Em `testar-ia-anexos.js`, além do caso `CybhorPDV`, assert:

```js
assert.strictEqual(reconhecerBackupCybhor({ app: "Operar", versao: 2 }).ok, true);
```

- [ ] **Step 2: Run to see current behavior**

Run: `node sistemaPDV/scripts/testar-ia-anexos.js`  
Expected: pode falhar no caso `Operar` até o Step 3.

- [ ] **Step 3: Implementar validação dual**

`iaAnexos.js`:

```js
const { appBackupValido } = require("./marcaProduto.cjs");
// ...
if (!appBackupValido(obj.app)) { /* rejeitar */ }
```

`iaComandos.js`: importar `appBackupValido` do config ESM e trocar o check `payload.app !== "CybhorPDV"`.

- [ ] **Step 4: Re-run tests**

```bash
node sistemaPDV/scripts/testar-ia-anexos.js
node sistemaPDV/scripts/testar-ia-tools.js
```

Expected: PASS

- [ ] **Step 5: Commit** (só se o usuário pedir)

---

### Task 4: Taxonomia núcleo × pack em `MODULOS_LOJA`

**Files:**
- Modify: `sistemaPDV/renderer/js/utils/aparencia.js` (`MODULOS_LOJA`)
- Modify: `sistemaPDV/renderer/js/ui/configuracoes.js` (texto de ajuda ~L1354)
- Modify: `sistemaPDV/scripts/testar-marca-produto.mjs` (assert `camada` presente)

**Interfaces:**
- Produces: cada item de `MODULOS_LOJA` com `camada: "nucleo" | "comercio"`
- Chaves `modulo*` inalteradas
- PDV/Caixa e Configurações continuam sempre ativos (comportamento atual)

Mapeamento v1 (alinhado à spec; módulos financeiros novos ainda não existem):

```js
export const MODULOS_LOJA = Object.freeze([
  { chave: "moduloProdutos", rota: "produtos", rotulo: "Produtos", camada: "comercio" },
  { chave: "moduloHistorico", rota: "historico", rotulo: "Histórico de vendas", camada: "comercio" },
  { chave: "moduloClientes", rota: "clientes", rotulo: "Clientes", camada: "comercio" },
  { chave: "moduloRelatorios", rota: "relatorios", rotulo: "Relatórios", camada: "nucleo" },
  { chave: "moduloFornecedores", rota: "fornecedores", rotulo: "Fornecedores", camada: "comercio" },
  { chave: "moduloGestao", rota: "gestao", rotulo: "Estoque e finanças", camada: "nucleo" },
  { chave: "moduloAssistente", rota: "assistente", rotulo: "Assistente CybhorIA", camada: "nucleo" },
  { chave: "moduloFuncionarios", rota: "funcionarios", rotulo: "Equipe / Folha", camada: "nucleo" },
]);
```

Nota: `moduloGestao` hoje mistura estoque+finanças; na Fase 1 o financeiro migra conceitualmente para núcleo puro — nesta fase só marca `camada` sem split de UI.

- [ ] **Step 1: Extender teste**

```js
import { MODULOS_LOJA } from "../renderer/js/utils/aparencia.js";
for (const m of MODULOS_LOJA) {
  assert.ok(m.chave.startsWith("modulo"));
  assert.ok(m.camada === "nucleo" || m.camada === "comercio");
}
```

- [ ] **Step 2: Run — expect fail on missing `camada`**

- [ ] **Step 3: Adicionar `camada` + texto em configurações**

Ajuda: “Caixa e Configurações ficam sempre ativos. Demais itens: núcleo (empresa/financeiro) ou pack Comércio (loja).”

Não é obrigatório redesenhar o formulário em grupos nesta fase; basta o texto. Agrupar visualmente = nice-to-have se for &lt;20 linhas.

- [ ] **Step 4: Run tests + build renderer**

```bash
node sistemaPDV/scripts/testar-marca-produto.mjs
cd sistemaPDV && npm run build:renderer
```

Expected: ok

- [ ] **Step 5: Commit** (só se o usuário pedir)

---

### Task 5: package.json (nome de exibição) sem quebrar instalador

**Files:**
- Modify: `sistemaPDV/package.json`

**Interfaces:**
- Produces: usuário vê “Operar” no atalho; artefatos continuam `CybhorPDV-Setup-*`

```json
"description": "Operar by Cybhor — gestão de loja (caixa, estoque e dinheiro) para Windows 7–11.",
"build": {
  "appId": "com.cybhor.pdv",
  "productName": "Operar",
  "win": {
    "executableName": "CybhorPDV",
    "artifactName": "CybhorPDV-Setup-${arch}.${ext}"
  },
  "nsis": {
    "shortcutName": "Operar",
    "uninstallDisplayName": "Operar by Cybhor"
  }
}
```

- [ ] **Step 1: Aplicar o JSON acima** (demais campos intactos)

- [ ] **Step 2: Guard no teste de marca**

Em `testar-marca-produto.mjs`, ler `package.json` e assert:

```js
assert.equal(pkg.build.productName, "Operar");
assert.equal(pkg.build.appId, "com.cybhor.pdv");
assert.equal(pkg.build.win.artifactName, "CybhorPDV-Setup-${arch}.${ext}");
assert.equal(pkg.build.win.executableName, "CybhorPDV");
```

- [ ] **Step 3: Run test** — Expected: PASS

- [ ] **Step 4: Commit** (só se o usuário pedir)

---

### Task 6: Landing + docs

**Files:**
- Modify: todos `sistemaPDV/landing/*.html` que exibem `Cybhor<strong>PDV</strong>` / títulos
- Modify: `sistemaPDV/README.md`, `sistemaPDV/INSTALAR.md`
- Modify: `sistemaPDV/CHANGELOG.md` (entrada Fase 0)
- Optional copy: `sistemaPDV/DEPLOY.md`, `server/README.md`, `backend/README.md` — só títulos “API do Operar / legado CybhorPDV”; não reescrever deploys

**Padrão de marca no HTML:**

```html
<span class="marca">Operar <span class="marca-by">by Cybhor</span></span>
```

Se CSS de `.marca strong` quebrar, ajustar `landing` CSS para `.marca-by { font-weight: 600; opacity: .85; }` (mínimo).

**Copy hero (`index.html`):**

- Title: `Operar by Cybhor — Sua loja inteira, não só o caixa`
- Description: gestão de caixa, estoque e dinheiro para a loja; vários caixas; assinatura Mercado Pago
- Corpo: trocar “CybhorPDV” → “Operar”; manter menções a instalar o app Windows
- FAQ: “Instalar o Operar” / “código da loja no Operar”

**README:** H1 `Operar by Cybhor` + nota “antes CybhorPDV”; instalador ainda `CybhorPDV-Setup-*.exe` nesta fase.

- [ ] **Step 1: Atualizar `landing/index.html` + demais HTMLs da pasta**

- [ ] **Step 2: Grep de sanidade**

```bash
rg -n "Cybhor<strong>PDV</strong>|CybhorPDV —" sistemaPDV/landing --glob '*.html'
```

Expected: zero hits de marca antiga no chrome (título/header/footer). Menções técnicas a arquivo `.exe` legado OK se documentadas.

- [ ] **Step 3: Atualizar README + INSTALAR + CHANGELOG**

- [ ] **Step 4: Commit** (só se o usuário pedir)

---

### Task 7: Verificação final Fase 0

**Files:** none (checklist)

- [ ] **Step 1: Rodar suíte mínima**

```bash
node sistemaPDV/scripts/testar-marca-produto.mjs
node sistemaPDV/scripts/testar-ia-anexos.js
cd sistemaPDV && npm run build:renderer
```

Expected: todos ok

- [ ] **Step 2: Checklist manual**

- [ ] Login mostra Operar / by Cybhor  
- [ ] Sidebar mostra Operar  
- [ ] Título da janela Operar + versão  
- [ ] Nav Caixa intacta  
- [ ] Config → módulos ainda ligam/desligam com mesmas chaves  
- [ ] `appId` / artifactName inalterados  

- [ ] **Step 3: Marcar spec Fase 0 como implementável / done no CHANGELOG**

- [ ] **Step 4: Parar** — não iniciar Fase 1 sem plano novo + OK do usuário

---

## Planes seguintes (não neste arquivo)

| Plano | Conteúdo |
|-------|----------|
| Fase 1 | Núcleo dinheiro: AP/AR, fluxo, lucro light, dashboard saúde do caixa |
| Fase 2 | Pack Comércio: compras → estoque → pagar |
| Fase 3 | Caixa fechado + conciliação ligada ao fluxo |
| Fase 4 | Relatórios unificados, permissões, pricing núcleo×pack; opcional rename de artifact |

## Self-review (autor do plano)

1. **Spec coverage (Fase 0):** identidade UI/landing/instalador display ✅; PDV como módulo ✅; `MODULOS_LOJA` núcleo+pack ✅; fluxos âncora compra/financeiro ❌ (Fases 1–2, correto).  
2. **Placeholders:** nenhum TBD.  
3. **Compat:** `appId`, artifact, chaves módulo, backup legado preservados.  
4. **Tipos/nomes:** `appBackupValido`, `NOME_PRODUTO_COMPLETO`, `camada` consistentes entre tasks.
