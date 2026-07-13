@echo off
REM Instala e valida o driver Jetway JP-800 no Windows
REM (mesmos arquivos de Driver_Utilitarios_JP-800)

set ROOT=%~dp0..\vendor\jp800\Driver_Utilitarios_JP-800
if not exist "%ROOT%\JetwayPrinterDriverJP-800.exe" (
  echo Pacote nao encontrado em:
  echo   %ROOT%
  echo Copie Driver_Utilitarios_JP-800 para vendor\jp800\ e tente de novo.
  pause
  exit /b 1
)

echo === CybhorPDV - Instalacao Jetway JP-800 ===
echo.
echo 1) Instalando driver...
start /wait "" "%ROOT%\JetwayPrinterDriverJP-800.exe"

echo.
echo 2) Abrindo utilitario de teste (PrinterTool)...
if exist "%ROOT%\JetwayPrinterTool\PrinterTool.exe" (
  start "" "%ROOT%\JetwayPrinterTool\PrinterTool.exe"
) else (
  echo PrinterTool.exe nao encontrado.
)

echo.
echo 3) Confira em "Dispositivos e impressoras" se aparece: Jetway JP-800
echo 4) No .env do CybhorPDV use:
echo      IMPRESSORA_NOME=Jetway JP-800
echo      IMPRESSORA_MODO=
echo.
echo Opcional: rode o Exemplo Delphi
echo   vendor\jp800\Exemplo_JP800_Delphi\Win32\Release\ExemploJP800.exe
echo   (modo Driver / impressora RAW)
echo.
pause
