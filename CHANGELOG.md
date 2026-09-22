# Changelog

## 2.1.7 — 2026-09-22

- Aviso de atraso na assinatura mensal: loja vencida/inadimplente segue liberada com banner; pendente e cancelada continuam bloqueadas.
- Banner de atraso com contraste legível no tema escuro (desktop e landing).
- Admin: listagem prioriza assinaturas atrasadas e permite filtrar só elas.

## 2.1.6 — 2026-09-22

- Endurece segurança do Electron e da landing (sandbox, allowlist de openExternal, XSS e comparação de senha em tempo constante).
- Melhora UX do caixa: foco na busca após bip, bloqueio de finalização duplicada, qtd×preço no carrinho e toasts mais curtos.
- Adia chart.js/jspdf e a IA do boot; bundle inicial bem menor (~−80%).
- Corrige corrida de estoque no caixa (baixa/devolução atômica), buracos de permissão em `/dados` e impressão travada (timeout no botão de cupom).
- Fecha bypass de venda via `/dados` (só `/caixa`); desconto/fiado exigem flag no servidor; login 10/15 min; gates em `auth_service`.
- Endurece IPC de cupom/config, valida `impressoraPorta` (sem writeFile arbitrário) e restaura `wa.me` na allowlist.
- Estabiliza caixa: preserva carrinho ao expirar o token, dedup de bipe (<280 ms), ciclo/sangria em centavos e bloqueio de navegação/nova janela no Electron.
