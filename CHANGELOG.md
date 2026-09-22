# Changelog

## 2.1.11 — 2026-09-22

- Backend sob carga: pool psycopg2 configuravel (DB_POOL_MIN/MAX, padrao 2–20) com TCP keepalive.
- Indice `pagamentos (loja_id, criado_em)` para o detalhe admin; rate limit por X-Forwarded-For e sem middleware global do slowapi.


## 2.1.10 — 2026-09-22

- Renderer/Electron: `credentials: "omit"` no fetch (file:// → https, Bearer only).
- Mapeamento de erro de rede no `apiClient` (DNS/SSL/timeout ≠ "sem conexão" genérico).
- Empacotado: força `CYBHOR_MODO_DEV=0` e não carrega `.env` de desenvolvimento.

## 2.1.9 — 2026-09-22

- CORS em produção sempre ativo (inclui Electron `file://` / Origin null mesmo sem `CORS_ORIGENS`).
- Documenta que `MP_WEBHOOK_SECRET` é obrigatório em produção (boot falha se ausente).

## 2.1.8 — 2026-09-22

- Endurece pagamentos (#13): webhook MP exige segredo em produção, trava corrida no registro e restringe criação pública de loja.
- Banner de atraso com CTA Renovar (desktop → área do cliente via API configurada; landing → checkout da assinatura).


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
