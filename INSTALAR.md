# Como instalar o CybhorPDV

Você **não precisa baixar o código-fonte**. Basta o instalador e o **código da loja**.

## Passo a passo

1. Cadastre-se / pague no site e **guarde o código da loja** (visível na Área do cliente após o pagamento).

2. Baixe o instalador em:  
   [github.com/cybhortech/sistemaPDV/releases](https://github.com/cybhortech/sistemaPDV/releases)

   - **Windows 7, 8, 10 ou 11 (64 bits):** `CybhorPDV-Setup-x64.exe`
   - **PC de 32 bits:** `CybhorPDV-Setup-ia32.exe`

3. Instale e abra o **CybhorPDV.exe**.

4. Na tela **Conectar sua loja**, cole o código da loja.

5. No **primeiro acesso desta loja**, crie a conta de **administrador**.

6. Pronto — o PDV desta loja fica isolado das demais.

## Requisitos

- Windows 7 SP1, 8, 10 ou 11 — o mesmo instalador serve para todos
- 64 bits: `CybhorPDV-Setup-x64.exe`; 32 bits: `CybhorPDV-Setup-ia32.exe`
- Conexão com a internet (ativar a loja e sincronizar dados)
- Um código de loja válido (1 código = 1 loja; use o mesmo código nos outros caixas)

## Problemas comuns

| Problema | Solução |
|----------|---------|
| "Loja não encontrada" / código inválido | Confira o código, a internet e se a API está no ar |
| "Falha ao conectar ao banco de dados" | Verifique a internet e reinstale com o instalador mais recente |
| Assinatura pendente ou cancelada | Conclua o pagamento no site (Área do cliente) — vencida/inadimplente segue liberada com aviso |
| Antivírus bloqueou | Permita o CybhorPDV nas exceções do antivírus |
| Não abre no Windows 7 | Confirme o Windows 7 **SP1**, reinstale e abra como administrador |
| Não abre após instalar | Execute o `.exe` como administrador |
| Quero outra loja | Cadastre outra loja no site — cada código cria um espaço separado |

## Impressora térmica (Jetway JP-800)

O PDV detecta sozinho a impressora térmica que está ligada e pronta (Jetway,
Bematech, Elgin, Epson TM, "Generic / Text Only" etc.). Se a impressora
escolhida estiver offline, ele usa outra térmica pronta. Para fixar uma
impressora: **Configurações** → escolha a impressora e salve. Nessa tela também
dá para ajustar o nome da loja no cupom.

## API (quem hospeda o backend)

Em `NODE_ENV=production` a API **exige** `MP_WEBHOOK_SECRET` no `.env` (além de `DATABASE_URL`, `JWT_SEGREDO`, `MP_ACCESS_TOKEN` e `URL_PUBLICA_API` https). Sem o segredo do webhook do Mercado Pago o processo **não sobe** (falha no boot). Detalhes: `backend/README.md` e `backend/.env.example`.

