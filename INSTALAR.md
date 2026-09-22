# Como instalar o CybhorPDV

Você **não precisa baixar o código-fonte**. Basta o instalador e o **código da loja**.

## Passo a passo

1. Cadastre-se / pague no site e **guarde o código da loja** (visível na Área do cliente após o pagamento).

2. Baixe o instalador em:  
   [github.com/cybhortech/sistemaPDV/releases](https://github.com/cybhortech/sistemaPDV/releases)

   - **Windows 10/11:** `CybhorPDV-Setup-win10-x64.exe`
   - **Windows 7:** `CybhorPDV-Setup-win7-x64.exe` ou `CybhorPDV-Setup-win7-ia32.exe`

3. Instale e abra o **CybhorPDV.exe**.

4. Na tela **Conectar sua loja**, cole o código da loja.

5. No **primeiro acesso desta loja**, crie a conta de **administrador**.

6. Pronto — o PDV desta loja fica isolado das demais.

## Requisitos

- Windows 10/11 (pacote **win10**) **ou** Windows 7 SP1 (pacote **win7** — nunca use o win10 no Windows 7)
- No Windows 7: baixe `CybhorPDV-Setup-win7-x64.exe` (64 bits) ou `CybhorPDV-Setup-win7-ia32.exe` (32 bits)
- Conexão com a internet (ativar a loja e sincronizar dados)
- Um código de loja válido (1 código = 1 loja; use o mesmo código nos outros caixas)

## Problemas comuns

| Problema | Solução |
|----------|---------|
| "Loja não encontrada" / código inválido | Confira o código, a internet e se a API está no ar |
| "Falha ao conectar ao banco de dados" | Verifique a internet e reinstale com o instalador mais recente |
| Assinatura pendente ou cancelada | Conclua o pagamento no site (Área do cliente) — vencida/inadimplente segue liberada com aviso |
| Antivírus bloqueou | Permita o CybhorPDV nas exceções do antivírus |
| Não abre no Windows 7 | Use o instalador **win7** (não o win10), confirme Windows 7 **SP1**, reinstale e abra como administrador |
| Não abre após instalar | Execute o `.exe` como administrador |
| Quero outra loja | Cadastre outra loja no site — cada código cria um espaço separado |

## Impressora térmica (Jetway JP-800)

Após entrar como admin: **Configurações** → escolha a impressora e salve.
Também é possível ajustar nome da loja no cupom nessa tela.

## API (quem hospeda o backend)

Em `NODE_ENV=production` a API **exige** `MP_WEBHOOK_SECRET` no `.env` (além de `DATABASE_URL`, `JWT_SEGREDO`, `MP_ACCESS_TOKEN` e `URL_PUBLICA_API` https). Sem o segredo do webhook do Mercado Pago o processo **não sobe** (falha no boot). Detalhes: `backend/README.md` e `backend/.env.example`.

