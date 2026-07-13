# RawPrinterHelper — mesmo fluxo do Exemplo_JP800_Delphi (OpenPrinter + datatype RAW).
# Uso: powershell -ExecutionPolicy Bypass -File RawPrint.ps1 -PrinterName "Jetway JP-800" -FilePath cupom.bin

param(
  [Parameter(Mandatory = $true)]
  [string]$PrinterName,

  [Parameter(Mandatory = $true)]
  [string]$FilePath
)

if (-not (Test-Path -LiteralPath $FilePath)) {
  Write-Error "Arquivo nao encontrado: $FilePath"
  exit 1
}

$bytes = [System.IO.File]::ReadAllBytes($FilePath)
if ($bytes.Length -le 0) {
  Write-Error "Arquivo vazio: $FilePath"
  exit 1
}

$assinatura = @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

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

Add-Type -TypeDefinition $assinatura -ErrorAction Stop

$handle = [IntPtr]::Zero
if (-not [RawPrinterHelper]::OpenPrinter($PrinterName, [ref]$handle, [IntPtr]::Zero)) {
  Write-Error "Impressora nao encontrada: $PrinterName"
  exit 2
}

$doc = New-Object RawPrinterHelper+DOCINFOA
$doc.pDocName = "CybhorPDV Cupom"
$doc.pOutputFile = $null
$doc.pDataType = "RAW"

$ok = $false
$ptr = [IntPtr]::Zero
try {
  if (-not [RawPrinterHelper]::StartDocPrinter($handle, 1, $doc)) { throw "StartDocPrinter falhou" }
  if (-not [RawPrinterHelper]::StartPagePrinter($handle)) { throw "StartPagePrinter falhou" }

  $ptr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)

  $written = 0
  if (-not [RawPrinterHelper]::WritePrinter($handle, $ptr, $bytes.Length, [ref]$written)) {
    throw "WritePrinter falhou"
  }
  if ($written -ne $bytes.Length) {
    throw "Escrita incompleta ($written de $($bytes.Length) bytes)"
  }

  [void][RawPrinterHelper]::EndPagePrinter($handle)
  [void][RawPrinterHelper]::EndDocPrinter($handle)
  $ok = $true
  Write-Output "OK:$written"
}
catch {
  Write-Error $_.Exception.Message
  exit 3
}
finally {
  if ($ptr -ne [IntPtr]::Zero) {
    [System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)
  }
  if ($handle -ne [IntPtr]::Zero) {
    [void][RawPrinterHelper]::ClosePrinter($handle)
  }
}

if (-not $ok) { exit 4 }
exit 0
