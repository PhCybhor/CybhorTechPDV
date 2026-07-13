# Materiais oficiais Jetway JP-800 (links para Downloads)

Este diretorio aponta para os pacotes oficiais usados no desenvolvimento:

- `Driver_Utilitarios_JP-800/` — driver Windows + JetwayPrinterTool + manuais
- `Exemplo_JP800_Delphi/` — exemplo oficial (RAW via COM ou WritePrinter)

## Instalacao no Windows (caixa real)

1. Conecte a JP-800 (USB recomendado).
2. Execute `Driver_Utilitarios_JP-800/JetwayPrinterDriverJP-800.exe` → Install.
3. Selecione o modelo **Jetway JP-800** e interface **USB** (ou Serial).
4. Reinicie se o instalador pedir.
5. Em **Dispositivos e impressoras**, confirme **Jetway JP-800**.
6. (Opcional) Abra `JetwayPrinterTool/PrinterTool.exe` → USB → teste de impressao.
7. (Opcional) Rode `Exemplo_JP800_Delphi/Win32/Release/ExemploJP800.exe` e escolha
   a impressora no modo Driver (RAW).

## Configuracao no CybhorPDV (.env)

```env
IMPRESSORA_NOME=Jetway JP-800
# Alternativa serial (como RadioButton COM do exemplo Delphi):
# IMPRESSORA_PORTA=COM3
# So para gerar arquivo sem imprimir (Linux/dev):
# IMPRESSORA_MODO=teste
LOJA_NOME=
LOJA_CNPJ=
LOJA_ENDERECO=
LOJA_TELEFONE=
```

O PDV envia o cupom em **ESC/POS RAW**, igual ao `TP650.pas` + `WritePrinter`
do exemplo Delphi (nao usa GDI/HTML no caminho principal do Windows).
