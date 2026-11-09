# Operar by Cybhor — plataforma modular (núcleo + pack Comércio)

**Data:** 2026-11-08  
**Status:** aprovado (spec revisada pelo usuário)  
**Abordagem:** 1 — núcleo financeiro/operação-base + pack Comércio/Varejo  

## Objetivo

Reposicionar o produto de **CybhorPDV** (ponto de venda) para **Operar by Cybhor**: sistema de gestão da loja que cuida do **dinheiro** e da **operação** (profundidade média), com arquitetura de **plataforma modular** preparada para packs de outros tipos de empresa no futuro.

**Promessa (uma frase):** cuida do dinheiro e da operação da loja — caixa, estoque, compras e fluxo de caixa — com módulos que depois servem outras empresas.

**Tagline candidata:** “Sua loja inteira, não só o caixa.”

## Não-objetivos (v1)

- Packs verticais além de Comércio (restaurante, clínica, oficina, salão, etc.)
- CRM/fidelidade como promessa de capa (cadastro de clientes básico permanece)
- Folha de pagamento avançada como promessa de capa
- Contabilidade formal / SPED / ECF
- NF-e completa como núcleo obrigatório
- WMS multi-depósito enterprise
- Apps separados por vertical (só feature flags + módulos no v1)
- Reescrever a stack (Electron / Express / MySQL / legado FastAPI) só por causa do rename

## Decisões travadas

| Item | Decisão |
|------|---------|
| Modelo de produto | Plataforma modular: **núcleo** + **packs** por tipo de empresa |
| v1 | Só **núcleo + pack Comércio/Varejo** |
| Marca | Nome de produto próprio + Cybhor por trás |
| Nome | **Operar by Cybhor** (packs futuros: Operar · Comércio, Operar · Serviços, …) |
| Foco do núcleo | **A+B:** dinheiro + operação, **profundidade média** |
| Abordagem | Núcleo financeiro genérico; mercadoria/caixa de loja no pack Comércio |
| Implementação de packs no v1 | Feature flags + rotas/UI + regras — não monorepo de apps |
| CybhorPDV | Vira nome legado/técnico onde necessário; PDV passa a ser **módulo** do pack Comércio |

## Referências de mercado (o que copiar)

| Empresa | Força | O que entra no Operar |
|---------|-------|------------------------|
| Conta Azul | Fluxo de caixa, AP/AR, DRE simples | Saúde do caixa, categorias, lucro light |
| Omie / Bling | Compras + estoque + financeiro | Pedido de compra → entrada → conta a pagar |
| Tiny / Bling | Catálogo e SKU | Produtos ricos sem WMS pesado |
| Stone/PagBank loja | Caixa físico e conciliação | Fechamento + conferência meios de pagamento |
| TOTVS / Senior | Módulos plugáveis | Só a ideia de packs — não a complexidade |

## Arquitetura de produto

```text
Operar by Cybhor
├── Núcleo
│   ├── Empresa & acessos (tenant, multi-loja, cargos, permissões, planos)
│   ├── Contas a pagar
│   ├── Contas a receber
│   ├── Fluxo de caixa
│   ├── Lucro simplificado (venda − CMV − despesas)
│   └── Relatórios base
└── Pack Comércio
    ├── PDV + cupom + offline
    ├── Produtos / SKU / códigos / validade / promoção
    ├── Estoque (entrada, baixa, ruptura, alertas)
    ├── Fornecedores
    ├── Compras (pedido → estoque → pagar)
    ├── Caixa físico (abertura, sangria, fechamento, conciliação)
    └── Clientes (cadastro básico)
```

**Regra de fronteira:**  
- Dinheiro genérico (AP/AR, fluxo, lucro) → **núcleo**  
- Mercadoria na prateleira / caixa da loja → **pack Comércio**

### Mapeamento para o código atual (`sistemaPDV/`)

| Capacidade | Situação hoje | Destino |
|------------|---------------|---------|
| Auth, loja, planos, multi-loja | Forte (`authService`, `lojaService`, planos) | Núcleo |
| Despesas / gestão financeira | Parcial (`despesas`, `gestaoAvancada`) | Evoluir para AP/AR + fluxo + lucro (núcleo) |
| Relatórios | Parcial | Relatórios base (núcleo) + operacionais (pack) |
| PDV, carrinho, impressão, offline | Forte | Pack Comércio |
| Produtos / estoque / validade | Parcial | Pack Comércio |
| Fornecedores | Existe | Pack Comércio |
| Compras (pedido → estoque → AP) | Fraco / a criar | Pack Comércio (fluxo âncora) |
| Caixa físico / sangria | Parcial | Pack Comércio (ligar ao fluxo do núcleo) |
| Clientes / equipe / folha / assistente IA | Existem | Fora da promessa de capa do v1; podem permanecer no app |

**Mudanças de produto (não são big-bang técnico):**

1. Identidade: UI, landing, instalador e textos → **Operar by Cybhor**  
2. `MODULOS_LOJA` → módulos do **núcleo** + módulos do **pack** (ligar/desligar por plano)  
3. Fluxo âncora pack: **Compra → estoque → conta a pagar**  
4. Fluxo âncora núcleo: **venda/despesa → fluxo de caixa → lucro do período**

## Roadmap v1

| Fase | Entrega | Resultado para o lojista |
|------|---------|--------------------------|
| 0 — Identidade | Rename Operar by Cybhor; PDV como módulo | Produto deixa de parecer “só caixa” |
| 1 — Núcleo dinheiro | AP/AR, categorias, fluxo dia/mês, lucro simplificado, dashboard saúde do caixa | Sabe se sobrou dinheiro no mês |
| 2 — Compras | Pedido → entrada estoque → pagar; alertas ruptura/validade → reposição | Sabe o que comprar e o que vence |
| 3 — Caixa fechado | Abertura/fechamento, sangria, conferência dinheiro/Pix/cartão | Fecha o dia batendo com as vendas |
| 4 — Polimento | Relatórios unificados, permissões por módulo, pricing núcleo vs pack | Pronto para vender como plataforma |

### Critério de sucesso v1

O lojista consegue, **sem planilha**:

1. Ver se sobrou dinheiro no mês  
2. Saber o que comprar e o que está vencendo  
3. Fechar o caixa do dia batendo com as vendas  

## Fora do v1 (backlog de plataforma)

- Packs: Serviços, Restaurante, Oficina, Clínica, Salão  
- CRM / fidelidade / campanhas  
- Folha avançada  
- NF-e / fiscal profundo  
- E-commerce completo  
- Multi-depósito / WMS  

## Riscos e mitigação

| Risco | Mitigação |
|-------|-----------|
| Expectativa de “ERP para qualquer empresa” no dia 1 | Marketing: Operar · Comércio; packs futuros explícitos |
| Núcleo financeiro raso demais | Profundidade média: AP/AR + fluxo + lucro light — sem contabilidade |
| Rename quebra installs / marca conhecida | Manter Cybhor visível (“by Cybhor”); instalador pode aceitar alias legado |
| Escopo inchado via “já que estamos…” | Gate: só o que serve A+B ou os 3 critérios de sucesso |

## Próximo passo após aprovação desta spec

Invocar **writing-plans** para plano de implementação por fases (começando pela Fase 0 — identidade, ou Fase 1 — núcleo dinheiro, conforme prioridade do usuário).
