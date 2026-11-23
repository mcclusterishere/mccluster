#Requires -Version 5.1
<#
.SYNOPSIS
Build McCluster for Windows with the compiler that ships inside Windows (no .NET SDK, no NuGet).

.DESCRIPTION
Uses C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe (the .NET Framework 4.8 C# 5 compiler)
against the framework's own assemblies and the Microsoft WebView2 managed assemblies from
-WebView2Dir. The WebView2 files are Microsoft-signed; this script checks their Authenticode
signature before using them and refuses unsigned copies. It downloads nothing.

Default -WebView2Dir is an installed McCluster preview (%LOCALAPPDATA%\McClusterDesktop\App) or a
NuGet package folder (lib\net462 + runtimes\win-x64\native). Output: dist\app\McCluster.exe plus the
three WebView2 files, ready for package\mccluster.nsi.

The SDK project src\McClusterDesktop.csproj is the ordinary build (dotnet build). Both compile the
same sources; the sources stay inside the C# 5 subset for that reason.
#>
[CmdletBinding()]
param(
  [string]$WebView2Dir,
  [string]$OutDir,
  [switch]$Tests
)
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 leaves $PSScriptRoot empty while parameter defaults are evaluated.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $WebView2Dir) { $WebView2Dir = Join-Path $env:LOCALAPPDATA 'McClusterDesktop\App' }
if (-not $OutDir) { $OutDir = Join-Path $here 'dist\app' }
$fw = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319'
$csc = Join-Path $fw 'csc.exe'
if (-not (Test-Path $csc)) { throw "in-box compiler not found: $csc" }

function Resolve-WebView2File([string]$name) {
  foreach ($candidate in @((Join-Path $WebView2Dir $name), (Join-Path $WebView2Dir "lib\net462\$name"), (Join-Path $WebView2Dir "runtimes\win-x64\native\$name"))) {
    if (Test-Path $candidate) { return (Resolve-Path $candidate).Path }
  }
  throw "WebView2 file not found under ${WebView2Dir}: $name"
}
$wvCore = Resolve-WebView2File 'Microsoft.Web.WebView2.Core.dll'
$wvForms = Resolve-WebView2File 'Microsoft.Web.WebView2.WinForms.dll'
$wvLoader = Resolve-WebView2File 'WebView2Loader.dll'
foreach ($f in @($wvCore, $wvForms, $wvLoader)) {
  $sig = Get-AuthenticodeSignature $f
  if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    throw "refusing WebView2 file without a valid Microsoft signature: $f ($($sig.Status))"
  }
  Write-Host ("webview2  {0}  {1}  signed by {2}" -f (Split-Path $f -Leaf), (Get-Item $f).VersionInfo.FileVersion, $sig.SignerCertificate.Subject)
}

New-Item -ItemType Directory -Force $OutDir | Out-Null
$src = Join-Path $here 'src'
$sources = Get-ChildItem (Join-Path $src '*.cs') | Sort-Object Name | ForEach-Object { $_.FullName }
$refs = @('mscorlib.dll','System.dll','System.Core.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Net.Http.dll','System.Management.dll','System.Web.Extensions.dll','System.Runtime.Serialization.dll') | ForEach-Object {
  $p = Join-Path $fw $_
  if (-not (Test-Path $p)) { throw "framework assembly missing: $p" }
  "/r:$p"
}
$exe = Join-Path $OutDir 'McCluster.exe'
# The in-box compiler predates /deterministic; the SDK project keeps <Deterministic>true</Deterministic>.
$cscArgs = @('/nologo','/noconfig','/nostdlib+','/warnaserror+','/optimize+','/target:winexe','/platform:x64','/langversion:5',
  "/win32manifest:$(Join-Path $src 'app.manifest')", "/out:$exe") + $refs + @("/r:$wvCore","/r:$wvForms") + $sources
Write-Host "csc $(Split-Path $csc -Leaf) $((Get-Item $csc).VersionInfo.FileVersion) -> $exe"
& $csc @cscArgs
if ($LASTEXITCODE -ne 0) { throw "csc failed with exit $LASTEXITCODE" }
Copy-Item $wvCore, $wvForms, $wvLoader $OutDir -Force
Get-ChildItem $OutDir | Select-Object Name, Length, @{n='Version';e={$_.VersionInfo.FileVersion}}, @{n='SHA256';e={(Get-FileHash $_.FullName).Hash}} | Format-Table -AutoSize | Out-String | Write-Host

if ($Tests) {
  $testOut = Join-Path $here 'dist\tests'
  New-Item -ItemType Directory -Force $testOut | Out-Null
  $testExe = Join-Path $testOut 'McClusterTests.exe'
  $testSources = @((Join-Path $src 'NavigationPolicy.cs'), (Join-Path $src 'Json.cs'), (Join-Path $src 'LocalJobs.cs'), (Join-Path $src 'DeviceInventory.cs'), (Join-Path $src 'LocalRuntime.cs')) + (Get-ChildItem (Join-Path $here 'tests\*.cs') | ForEach-Object { $_.FullName })
  $testArgs = @('/nologo','/noconfig','/nostdlib+','/warnaserror+','/target:exe','/platform:x64','/langversion:5',"/out:$testExe") + $refs + $testSources
  & $csc @testArgs
  if ($LASTEXITCODE -ne 0) { throw "test build failed with exit $LASTEXITCODE" }
  & $testExe
  if ($LASTEXITCODE -ne 0) { throw "tests failed with exit $LASTEXITCODE" }
}
