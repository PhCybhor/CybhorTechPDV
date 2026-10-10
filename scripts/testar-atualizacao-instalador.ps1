<#
.SYNOPSIS
  Instala uma versao antiga do CybhorPDV e depois a nova por cima, e confere que
  sobrou uma unica instalacao (registro, pasta e atalhos) com a licenca intacta.

.DESCRIPTION
  Usado no CI Windows. Os dois instaladores rodam em modo silencioso (/S); os
  argumentos extras simulam a escolha "para todos" (/allusers) ou "somente para
  mim" (/currentuser) que o cliente faz na tela do instalador.
#>
param(
  [Parameter(Mandatory = $true)] [string] $InstaladorAntigo,
  [string] $ArgumentosAntigo = "",
  [Parameter(Mandatory = $true)] [string] $InstaladorNovo,
  [string] $ArgumentosNovo = "",
  [Parameter(Mandatory = $true)] [string] $VersaoNova
)

$ErrorActionPreference = "Stop"

$chavesDesinstalacao = @(
  "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
)

$pastasPrograma = @(
  (Join-Path $env:ProgramFiles "CybhorPDV"),
  (Join-Path ${env:ProgramFiles(x86)} "CybhorPDV"),
  (Join-Path $env:LOCALAPPDATA "Programs\CybhorPDV"),
  "C:\CybhorPDV-Outra"
)

$pastaDadosApp = Join-Path $env:APPDATA "CybhorPDV"
$arquivosDadosApp = @{
  "licenca.enc"      = "licenca-de-teste-nao-pode-sumir"
  "config-app.json"  = '{"impressora":"teste"}'
}

function Get-RegistrosCybhor {
  foreach ($chave in $chavesDesinstalacao) {
    if (-not (Test-Path $chave)) { continue }
    foreach ($item in Get-ChildItem $chave) {
      $propriedades = Get-ItemProperty $item.PSPath
      if ("$($propriedades.DisplayName)" -like "CybhorPDV*") {
        [pscustomobject]@{
          Registro = $chave
          Versao   = "$($propriedades.DisplayVersion)"
          Pasta    = "$($propriedades.InstallLocation)"
        }
      }
    }
  }
}

function Get-AtalhosCybhor([string[]] $tiposPasta) {
  foreach ($tipo in $tiposPasta) {
    $pasta = [Environment]::GetFolderPath($tipo)
    if ($pasta -and (Test-Path $pasta)) {
      Get-ChildItem $pasta -Filter "CybhorPDV*.lnk" -Recurse -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty FullName
    }
  }
}

function Get-PastasComExecutavel {
  $pastasPrograma | Where-Object { Test-Path (Join-Path $_ "CybhorPDV.exe") }
}

function Write-Estado([string] $titulo) {
  Write-Host "===== $titulo ====="
  Write-Host "Registros de desinstalacao:"
  Get-RegistrosCybhor | Format-Table -AutoSize | Out-String | Write-Host
  Write-Host "Atalhos na area de trabalho:"
  Get-AtalhosCybhor @("Desktop", "CommonDesktopDirectory") | ForEach-Object { Write-Host "  $_" }
  Write-Host "Atalhos no menu Iniciar:"
  Get-AtalhosCybhor @("Programs", "CommonPrograms") | ForEach-Object { Write-Host "  $_" }
  Write-Host "Pastas com CybhorPDV.exe:"
  Get-PastasComExecutavel | ForEach-Object { Write-Host "  $_" }
}

function Invoke-InstaladorSilencioso([string] $caminho, [string] $argumentos) {
  $executavel = (Resolve-Path $caminho).Path
  $lista = @("/S") + @($argumentos -split " " | Where-Object { $_ })
  Write-Host "Executando: $executavel $($lista -join ' ')"
  $processo = Start-Process -FilePath $executavel -ArgumentList $lista -Wait -PassThru
  if ($processo.ExitCode -ne 0) {
    throw "Instalador terminou com codigo $($processo.ExitCode): $caminho"
  }
}

New-Item -ItemType Directory -Force -Path $pastaDadosApp | Out-Null
foreach ($nome in $arquivosDadosApp.Keys) {
  Set-Content -Path (Join-Path $pastaDadosApp $nome) -Value $arquivosDadosApp[$nome] -NoNewline
}

Invoke-InstaladorSilencioso $InstaladorAntigo $ArgumentosAntigo
Write-Estado "Depois da versao antiga"

Invoke-InstaladorSilencioso $InstaladorNovo $ArgumentosNovo
Write-Estado "Depois da versao nova"

$falhas = New-Object System.Collections.Generic.List[string]

$registros = @(Get-RegistrosCybhor)
if ($registros.Count -ne 1) {
  $falhas.Add("Esperava 1 registro em Programas e Recursos, encontrou $($registros.Count).")
} elseif ($registros[0].Versao -ne $VersaoNova) {
  $falhas.Add("Registro com versao $($registros[0].Versao); esperava $VersaoNova.")
}

$atalhosAreaTrabalho = @(Get-AtalhosCybhor @("Desktop", "CommonDesktopDirectory"))
if ($atalhosAreaTrabalho.Count -ne 1) {
  $falhas.Add("Esperava 1 atalho na area de trabalho, encontrou $($atalhosAreaTrabalho.Count).")
}

$atalhosMenuIniciar = @(Get-AtalhosCybhor @("Programs", "CommonPrograms"))
if ($atalhosMenuIniciar.Count -ne 1) {
  $falhas.Add("Esperava 1 atalho no menu Iniciar, encontrou $($atalhosMenuIniciar.Count).")
}

$pastasInstaladas = @(Get-PastasComExecutavel)
if ($pastasInstaladas.Count -ne 1) {
  $falhas.Add("Esperava 1 pasta com CybhorPDV.exe, encontrou $($pastasInstaladas.Count).")
}

foreach ($nome in $arquivosDadosApp.Keys) {
  $caminho = Join-Path $pastaDadosApp $nome
  if (-not (Test-Path $caminho) -or (Get-Content $caminho -Raw) -ne $arquivosDadosApp[$nome]) {
    $falhas.Add("Dados do app perdidos ou alterados: $nome.")
  }
}

if ($falhas.Count -gt 0) {
  $falhas | ForEach-Object { Write-Host "::error::$_" }
  exit 1
}
Write-Host "OK: uma unica instalacao $VersaoNova, atalhos unicos e licenca preservada."
