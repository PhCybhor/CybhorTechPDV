# Lista de trabalho — CybhorPDV (venda)

Atualizado continuamente. Itens feitos nesta sessão estão marcados.

## Feito

- [x] Multi-loja `lojas/{lojaId}` + rules
- [x] Licença AES + ativação
- [x] Landing + Mercado Pago + webhook
- [x] Ofuscação do bundle
- [x] Configurações / histórico / cancelamento / estoque baixo
- [x] Script migração legado → loja
- [x] Docs INSTALAR / README / VENDER
- [x] Landing: download + FAQ
- [x] Reentrega de chave + e-mail SMTP (opcional)
- [x] Revalidação online da licença
- [x] Nome da loja no login
- [x] Fechamento de caixa do dia
- [x] Alterar senha de funcionário
- [x] Import CSV de produtos
- [x] Custo/margem + despesas + lucro líquido
- [x] CybhorIA + Copy thief + campanhas salvas
- [x] Sangria + suprimento + fundo + dinheiro esperado
- [x] Pagamento dividido + leva junto + meta do dia
- [x] Ctrl+K + Pulso da loja + backup JSON
- [x] WhatsApp reposição + fornecedores por tipo de mercadoria
- [x] Clientes / fiado / fidelidade / aniversário / WhatsApp cupom
- [x] Gestão+ (pedido, DRE, inventário, combos, cupons, turnos, auditoria)
- [x] Abertura obrigatória + conferência de gaveta + desconto máximo
- [x] Promoção / validade / kg / código interno / leitor contínuo
- [x] Onboarding 5 passos + venda rápida + última cesta + troco inteligente
- [x] Modos IA: cardápio da semana, crise, placa, treino do caixa
- [x] Gaveta ESC/POS (pulso ao imprimir, se configurado)

## Falta (go-to-market / ops)

- [ ] Configurar `MP_ACCESS_TOKEN` + URL pública HTTPS
- [ ] Service account Firebase no `server/`
- [ ] Publicar `database.rules.json` no Console (inclui `clientes` + `auditoria`)
- [ ] SMTP para e-mail automático da chave
- [ ] Teste sandbox Mercado Pago ponta a ponta
- [ ] `CYBHOR_MODO_DEV=0` no `.env` do instalador
- [ ] Publicar Release GitHub
- [ ] Firebase Auth nas rules (hoje ainda aberto por lojaId)
- [ ] Atualização automática do app (`electron-updater`)

## Ideias — status

### Caixa

- [x] Leitor contínuo
- [x] Venda por peso (kg)
- [x] Cliente fiado leve
- [x] Troco inteligente
- [x] Última cesta
- [ ] Modo fila no celular (fora do escopo desktop)
- [x] Bloqueio desconto alto
- [x] Som configurável
- [ ] Etiqueta de preço térmica dedicada
- [x] Venda rápida fullscreen

### Dinheiro / caixa físico

- [x] Conferência de gaveta
- [x] Meta do dia (barra; ranking semanal fica para depois)
- [x] Margem morta no DRE
- [x] Simulador +5%
- [x] Export DRE
- [ ] Vencimento em despesa (campo futuro)
- [ ] Google Sheets
- [ ] Foto na sangria
- [x] Abertura obrigatória
- [x] Onde sumiu a margem (no DRE)

### Estoque / fornecedores

- [x] Pedido WhatsApp/HTML
- [x] Previsão dias de estoque
- [x] Inventário guiado
- [x] Unidades por caixa (cadastro)
- [x] Validade
- [ ] Transferência entre lojas
- [x] Preço promoção + data fim
- [x] Combos leve/pague
- [x] Código interno + EAN
- [ ] Import CSV fornecedor dedicado

### Clientes

- [x] Cadastro + WhatsApp
- [x] Histórico “costuma levar”
- [x] Aniversário
- [x] Cashback %
- [x] Fiado + quitar + cobrança WA
- [x] Cupom 1 uso
- [x] Pontos fidelidade (carimbo digital básico)
- [x] Cupom/resumo WA pós-venda

### CybhorIA

- [x] Cardápio da semana
- [ ] Análise por foto (precisa vision API + UI)
- [x] Treino do caixa (quiz)
- [ ] Resumo automático 20h (agendador)
- [ ] Sugestão de mix dedicada (usar modo compras)
- [x] Placa de oferta
- [x] Modo crise
- [ ] Biblioteca de nichos pronta
- [ ] IA no CSV import
- [ ] Voz → IA (Web Speech)

### Equipe

- [ ] Áreas liberando rotas de verdade
- [x] Escala de turnos
- [ ] Comissão automática
- [x] Auditoria
- [ ] PIN troca operador
- [x] Checklist abertura/fechamento
- [x] Avaliação 1–5 pós-venda

### Hardware

- [x] Gaveta ESC/POS
- [ ] 2ª via cozinha
- [ ] Display do cliente
- [ ] Auto-update
- [ ] Offline queue
- [ ] Backup automático semanal
- [ ] Kiosk instalador
- [ ] Perfil impressora genérico 80mm

### Fiscal (parceiro — não no core)

- [ ] NFC-e
- [ ] TEF
- [ ] PIX QR API
- [ ] Split TEF

### Venda do Cybhor

- [ ] Vídeo demo
- [ ] Página comparação
- [x] CSV modelo (landing)
- [ ] Afiliados
- [x] Garantia 30 dias (landing — comunicar)
- [x] Onboarding 5 passos
- [ ] Cases
- [ ] Grupo WhatsApp donos

### Segurança

- [ ] Rules com Auth
- [ ] Senha master doc
- [ ] 2FA
- [ ] Export LGPD cliente
- [ ] Alerta multi-PC
