# Repara a instalacao da Jetway JP-800 para o CybhorPDV.
# Execute como Administrador se pedido.

$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$DriverExe = Join-Path $Root "vendor\jp800\Driver_Utilitarios_JP-800\Driver_Utilitarios_JP-800\JetwayPrinterDriverJP-800.exe"
$ToolExe = Join-Path $Root "vendor\jp800\Driver_Utilitarios_JP-800\Driver_Utilitarios_JP-800\JetwayPrinterTool\PrinterTool.exe"

Write-Host "=== CybhorPDV - Reparar Jetway JP-800 ===" -ForegroundColor Cyan

Write-Host "1) Limpando spooler e filas..."
Stop-Service Spooler -Force -ErrorAction SilentlyContinue
Start-Sleep 2
Remove-Item "$env:SystemRoot\System32\spool\PRINTERS\*" -Force -ErrorAction SilentlyContinue
Start-Service Spooler -ErrorAction SilentlyContinue
Start-Sleep 2

Write-Host "2) Removendo filas Jetway duplicadas/quebradas..."
Get-Printer -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like "Jetway*" } |
  ForEach-Object {
    Write-Host "   Removendo $($_.Name)"
    Remove-Printer -Name $_.Name -ErrorAction SilentlyContinue
  }

Write-Host "3) Conferindo USB Printing Support..."
$usbPrint = Get-PnpDevice -ErrorAction SilentlyContinue |
  Where-Object { $_.InstanceId -like "*USBPRINT*" -or $_.FriendlyName -like "*USB Printing*" }
if ($usbPrint) {
  $usbPrint | Format-Table Status, FriendlyName -AutoSize
} else {
  Write-Host "   AVISO: nenhuma interface USBPRINT encontrada." -ForegroundColor Yellow
  Write-Host "   Conecte o cabo USB da JP-800, ligue a impressora e rode este script de novo." -ForegroundColor Yellow
}

if (Test-Path $DriverExe) {
  Write-Host "4) Abrindo instalador oficial Jetway..."
  Write-Host "   No instalador: modelo Jetway JP-800 + interface USB -> Install"
  Start-Process -FilePath $DriverExe
} else {
  Write-Host "4) Driver nao encontrado em vendor/jp800" -ForegroundColor Red
}

if (Test-Path $ToolExe) {
  Write-Host "5) Abrindo PrinterTool (teste USB)..."
  Start-Process -FilePath $ToolExe
}

Write-Host ""
Write-Host "Depois que a pagina de teste do PrinterTool sair:" -ForegroundColor Green
Write-Host "  - Confirme que existe apenas UMA impressora Jetway JP-800"
Write-Host "  - No .env: IMPRESSORA_NOME=Jetway JP-800"
Write-Host "  - Reinicie o CybhorPDV e finalize uma venda"
Write-Host ""
