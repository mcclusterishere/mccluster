#Requires -Version 5.1
<#
.SYNOPSIS
Build McCluster for Windows, its tests and its per-user installer with the compiler that ships inside Windows (no .NET SDK, no NuGet, no NSIS).

.DESCRIPTION
Uses C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe (the .NET Framework 4.8 C# 5 compiler)
against the framework's own assemblies and the Microsoft WebView2 managed assemblies from -WebView2Dir
(Authenticode-checked; unsigned copies are refused). It downloads nothing.

Order, tests first: the desktop tests (tests\DesktopTests.cs) must pass before the installer is built;
the installer tests (installer\tests\InstallerTests.cs) must pass against the real Setup.exe, with its real
embedded payload, before dist\McCluster-Windows-x64-Setup-<version>.exe is written.

Outputs: dist\app\ (the app and the three WebView2 files), dist\payload.zip (deterministic: fixed entry
timestamps, sorted entries, with manifest.json of SHA-256 hashes), dist\McCluster-Windows-x64-Setup-<version>.exe
(the payload embedded as a resource), dist\SHA256SUMS.txt. The SDK project src\McClusterDesktop.csproj remains the
ordinary build; both compile the same sources, which stay inside the C# 5 subset.
#>
[CmdletBinding()]
param(
  [string]$WebView2Dir,
  [string]$OutDir,
  [switch]$Tests,
  [switch]$Installer,
  [string]$SourceCommit
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $WebView2Dir) { $WebView2Dir = Join-Path $env:LOCALAPPDATA 'McClusterDesktop\App' }
if (-not $OutDir) { $OutDir = Join-Path $here 'dist\app' }
$dist = Split-Path -Parent $OutDir
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
$refNames = @('mscorlib.dll','System.dll','System.Core.dll','System.Drawing.dll','System.Windows.Forms.dll','System.Net.Http.dll','System.Management.dll','System.Web.Extensions.dll','System.Runtime.Serialization.dll','System.Security.dll','System.IO.Compression.dll','System.IO.Compression.FileSystem.dll')
$refs = $refNames | ForEach-Object {
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
Copy-Item (Join-Path $here 'package\README.txt') $OutDir -Force
$licenseSrc = Join-Path $WebView2Dir 'MICROSOFT-WEBVIEW2-LICENSE.txt'
if (-not (Test-Path $licenseSrc)) { $licenseSrc = Join-Path $WebView2Dir 'LICENSE.txt' }
if (Test-Path $licenseSrc) { Copy-Item $licenseSrc (Join-Path $OutDir 'MICROSOFT-WEBVIEW2-LICENSE.txt') -Force } else { Write-Warning 'WebView2 licence text not found beside the DLLs; the payload must ship it (BSD-3-Clause notice)' }
$version = (Get-Item $exe).VersionInfo.FileVersion -replace '\.0$',''
Get-ChildItem $OutDir | Select-Object Name, Length, @{n='Version';e={$_.VersionInfo.FileVersion}}, @{n='SHA256';e={(Get-FileHash $_.FullName).Hash}} | Format-Table -AutoSize | Out-String | Write-Host

if ($Tests -or $Installer) {
  $testOut = Join-Path $dist 'tests'
  New-Item -ItemType Directory -Force $testOut | Out-Null
  $testExe = Join-Path $testOut 'McClusterTests.exe'
  $testSources = @('NavigationPolicy.cs','Json.cs','LocalJobs.cs','DeviceInventory.cs','LocalRuntime.cs','Proof.cs','ExoProbe.cs') | ForEach-Object { Join-Path $src $_ }
  $testSources += (Get-ChildItem (Join-Path $here 'tests\*.cs') | ForEach-Object { $_.FullName })
  $testArgs = @('/nologo','/noconfig','/nostdlib+','/warnaserror+','/target:exe','/platform:x64','/langversion:5',"/out:$testExe") + $refs + $testSources
  & $csc @testArgs
  if ($LASTEXITCODE -ne 0) { throw "test build failed with exit $LASTEXITCODE" }
  & $testExe
  if ($LASTEXITCODE -ne 0) { throw "desktop tests failed with exit $LASTEXITCODE" }
}

if ($Installer) {
  # 1. Deterministic payload: sorted entries, fixed timestamps, manifest of hashes.
  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
  $payload = Join-Path $dist 'payload.zip'
  if (Test-Path $payload) { Remove-Item $payload -Force }
  $files = Get-ChildItem $OutDir -File | Where-Object { $_.Name -ne 'Uninstall.exe' -and $_.Name -ne 'install-receipt.json' } | Sort-Object Name
  $manifestFiles = @()
  foreach ($f in $files) { $manifestFiles += [ordered]@{ name = $f.Name; sha256 = (Get-FileHash $f.FullName).Hash.ToLowerInvariant(); size = $f.Length } }
  if (-not $SourceCommit) { try { $gitExe = Get-Command git -ErrorAction Stop; $SourceCommit = (& $gitExe.Source -C $here rev-parse HEAD 2>$null) } catch { $SourceCommit = $null } }
  $manifest = [ordered]@{ schema = 'mccluster-install-manifest/1'; product = 'McCluster'; version = $version; source_commit = $SourceCommit; built_with = 'in-box csc ' + (Get-Item $csc).VersionInfo.FileVersion; files = $manifestFiles }
  $manifestJson = ($manifest | ConvertTo-Json -Depth 4)
  $fixed = [DateTimeOffset]::new(2026, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
  $zipStream = [IO.File]::Open($payload, [IO.FileMode]::CreateNew)
  $zip = New-Object IO.Compression.ZipArchive($zipStream, [IO.Compression.ZipArchiveMode]::Create)
  try {
    $entry = $zip.CreateEntry('manifest.json', [IO.Compression.CompressionLevel]::Optimal); $entry.LastWriteTime = $fixed
    $s = $entry.Open(); $bytes = [Text.Encoding]::UTF8.GetBytes($manifestJson); $s.Write($bytes, 0, $bytes.Length); $s.Dispose()
    foreach ($f in $files) {
      $entry = $zip.CreateEntry($f.Name, [IO.Compression.CompressionLevel]::Optimal); $entry.LastWriteTime = $fixed
      $s = $entry.Open(); $in = [IO.File]::OpenRead($f.FullName); $in.CopyTo($s); $in.Dispose(); $s.Dispose()
    }
  } finally { $zip.Dispose(); $zipStream.Dispose() }
  Write-Host ("payload.zip {0} bytes sha256 {1}" -f (Get-Item $payload).Length, (Get-FileHash $payload).Hash)

  # 2. Setup.exe = installer sources + the shared Json helper, with payload.zip embedded as a resource.
  $setupExe = Join-Path $dist "McCluster-Windows-x64-Setup-$version.exe"
  $setupSources = @((Join-Path $here 'installer\Setup.cs'), (Join-Path $src 'Json.cs'))
  $setupArgs = @('/nologo','/noconfig','/nostdlib+','/warnaserror+','/optimize+','/target:winexe','/platform:x64','/langversion:5',
    "/win32manifest:$(Join-Path $src 'app.manifest')", "/out:$setupExe", "/resource:$payload,payload.zip") + $refs + $setupSources
  & $csc @setupArgs
  if ($LASTEXITCODE -ne 0) { throw "setup build failed with exit $LASTEXITCODE" }

  # 3. Installer tests against the real Setup.exe into a throwaway root, Start Menu folder and HKCU key.
  $instTestExe = Join-Path $dist 'tests\InstallerTests.exe'
  $instTestSources = @((Join-Path $here 'installer\tests\InstallerTests.cs'), (Join-Path $here 'installer\Setup.cs'), (Join-Path $src 'Json.cs'))
  $instTestArgs = @('/nologo','/noconfig','/nostdlib+','/warnaserror+','/target:exe','/platform:x64','/langversion:5',"/out:$instTestExe", '/main:InstallerTests') + $refs + $instTestSources
  & $csc @instTestArgs
  if ($LASTEXITCODE -ne 0) { throw "installer test build failed with exit $LASTEXITCODE" }
  & $instTestExe $setupExe
  if ($LASTEXITCODE -ne 0) { throw "installer tests failed with exit $LASTEXITCODE" }

  $sums = Join-Path $dist 'SHA256SUMS.txt'
  "$((Get-FileHash $setupExe).Hash.ToLowerInvariant())  $(Split-Path $setupExe -Leaf)`n$((Get-FileHash $payload).Hash.ToLowerInvariant())  payload.zip" | Set-Content $sums -Encoding ascii
  Write-Host ("setup {0} bytes sha256 {1}" -f (Get-Item $setupExe).Length, (Get-FileHash $setupExe).Hash)
}
