# Servidor de impressao do CybhorPDV: fica aberto enquanto o app roda.
#
# Abrir um PowerShell e compilar o helper Win32 (Add-Type) custava segundos por
# cupom (bem mais no Windows 7). Aqui isso acontece uma vez; cada pedido e uma
# linha no stdin. Compativel com PowerShell 2.0 (Windows 7 sem atualizacoes).
#
# Protocolo (ASCII, evita problemas de codepage do console):
#   pedido:   <id> TAB <acao> TAB <arg1 base64> TAB <arg2 base64>
#   resposta: <id> TAB OK|ERRO TAB <texto base64 UTF-8>
# Acoes: ping | listar | diagnosticar <impressora> | imprimir <impressora> <bytes>

$ErrorActionPreference = "Stop"

$assinatura = @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPWStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);

  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
}
"@

Add-Type -TypeDefinition $assinatura

function De64([string]$texto) {
  if (-not $texto) { return "" }
  return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($texto))
}

function Para64([string]$texto) {
  return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$texto))
}

function Responder([string]$id, [string]$status, [string]$texto) {
  [Console]::Out.WriteLine($id + "`t" + $status + "`t" + (Para64 $texto))
  [Console]::Out.Flush()
}

function CodigoWin32 {
  return [Runtime.InteropServices.Marshal]::GetLastWin32Error()
}

function Listar-Impressoras {
  $linhas = @()
  foreach ($p in @(Get-WmiObject Win32_Printer)) {
    $padrao = "0"
    if ($p.Default) { $padrao = "1" }
    $linhas += ($p.Name + "`t" + $padrao + "`t" + $p.PrinterStatus)
  }
  return ($linhas -join "`n")
}

function Diagnosticar-Impressora([string]$nome) {
  # Filtro WQL consulta so a impressora pedida (enumerar todas e lento com impressoras de rede).
  $nomeWql = $nome.Replace("\", "\\").Replace("'", "\'")
  $p = Get-WmiObject Win32_Printer -Filter ("Name='" + $nomeWql + "'") | Select-Object -First 1
  if (-not $p) { return "MISSING" }
  return ("STATUS=" + $p.PrinterStatus + ";PORT=" + $p.PortName + ";WORKOFFLINE=" + $p.WorkOffline)
}

function Imprimir-Raw([string]$nome, [byte[]]$bytes) {
  if (-not $bytes -or $bytes.Length -le 0) { throw "Cupom vazio." }

  $handle = [IntPtr]::Zero
  if (-not [RawPrinterHelper]::OpenPrinter($nome, [ref]$handle, [IntPtr]::Zero)) {
    throw ("Impressora nao encontrada: " + $nome + " (win32=" + (CodigoWin32) + ")")
  }

  $doc = New-Object RawPrinterHelper+DOCINFOW
  $doc.pDocName = "CybhorPDV Cupom"
  $doc.pOutputFile = $null
  $doc.pDataType = "RAW"

  $ptr = [IntPtr]::Zero
  $documentoAberto = $false
  try {
    if (-not [RawPrinterHelper]::StartDocPrinter($handle, 1, $doc)) {
      throw ("StartDocPrinter falhou (win32=" + (CodigoWin32) + ")")
    }
    $documentoAberto = $true
    if (-not [RawPrinterHelper]::StartPagePrinter($handle)) {
      throw ("StartPagePrinter falhou (win32=" + (CodigoWin32) + ")")
    }

    $ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)

    $escritos = 0
    if (-not [RawPrinterHelper]::WritePrinter($handle, $ptr, $bytes.Length, [ref]$escritos)) {
      throw ("WritePrinter falhou (win32=" + (CodigoWin32) + ")")
    }
    if ($escritos -ne $bytes.Length) {
      throw ("Escrita incompleta (" + $escritos + " de " + $bytes.Length + " bytes)")
    }
    [void][RawPrinterHelper]::EndPagePrinter($handle)
    [void][RawPrinterHelper]::EndDocPrinter($handle)
    $documentoAberto = $false
    return ("OK:" + $escritos)
  }
  finally {
    if ($documentoAberto) {
      [void][RawPrinterHelper]::EndPagePrinter($handle)
      [void][RawPrinterHelper]::EndDocPrinter($handle)
    }
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr) }
    [void][RawPrinterHelper]::ClosePrinter($handle)
  }
}

[Console]::Out.WriteLine("PRONTO")
[Console]::Out.Flush()

while ($true) {
  $linha = [Console]::In.ReadLine()
  # stdin fechado = app encerrou (inclusive se o Electron morrer sem matar este processo).
  if ($linha -eq $null) { break }
  if (-not $linha.Trim()) { continue }

  $partes = $linha.Split("`t")
  $id = $partes[0]
  $acao = ""
  if ($partes.Length -gt 1) { $acao = $partes[1] }
  $arg1 = ""
  if ($partes.Length -gt 2) { $arg1 = $partes[2] }
  $arg2 = ""
  if ($partes.Length -gt 3) { $arg2 = $partes[3] }

  try {
    switch ($acao) {
      "ping" { Responder $id "OK" "pong" }
      "listar" { Responder $id "OK" (Listar-Impressoras) }
      "diagnosticar" { Responder $id "OK" (Diagnosticar-Impressora (De64 $arg1)) }
      "imprimir" { Responder $id "OK" (Imprimir-Raw (De64 $arg1) ([Convert]::FromBase64String($arg2))) }
      default { Responder $id "ERRO" ("Acao desconhecida: " + $acao) }
    }
  }
  catch {
    Responder $id "ERRO" $_.Exception.Message
  }
}
