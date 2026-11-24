#Requires -Version 5.1
<#
.SYNOPSIS
Build McCluster for Windows, its tests and its per-user installer with the compiler that ships inside Windows (no .NET SDK, no NuGet, no NSIS).

.DESCRIPTION
Uses C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe (the .NET Framework 4.8 C# 5 compiler)
against the framework's own assemblies and the Microsoft WebView2 managed assemblies from -WebView2Dir
(Authenticode-checked; unsigned copies are refused). It downloads nothing.

Order, tests first: the desktop tests (tests\DesktopTests.cs) must pass before the installer is built;
the installer is compiled as dist\tests\Setup-candidate.exe, the installer tests
(installer\tests\InstallerTests.cs) must pass against that candidate with its real embedded payload, and only
then is it moved to dist\McCluster-Windows-x64-Setup-<version>.exe and SHA256SUMS.txt written. A dirty
desktop\windows tree is refused unless -AllowDirty is passed; the manifest records built_from_clean_tree.
Last, release-gate.ps1 checks Authenticode on every binary and the sums, writing dist\release-status.json;
-Installer -Release -Thumbprint signs the app before hashing and embedding it, and signs the setup
before testing the installed bytes. The build requires the signer's certificate and a timestamp.

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
  [string]$SourceCommit,
  [switch]$AllowDirty,
  [switch]$Release,
  [string]$Thumbprint,
  [string]$TimestampUrl = 'http://timestamp.digicert.com'
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $WebView2Dir) { $WebView2Dir = Join-Path $env:LOCALAPPDATA 'McClusterDesktop\App' }
if (-not $OutDir) { $OutDir = Join-Path $here 'dist\app' }
$dist = Split-Path -Parent $OutDir
if ($Release -and (-not $Installer -or -not $Thumbprint)) { throw 'A release requires -Installer -Release -Thumbprint <code-signing certificate>.' }
if ($Thumbprint -and -not $Release) { throw 'Signing requires an explicit -Installer -Release build.' }
if ($Release) {
  $cert = @(Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $Thumbprint }) | Select-Object -First 1
  if (-not $cert) { throw "certificate $Thumbprint not found in CurrentUser\My or LocalMachine\My" }
  if (-not $cert.HasPrivateKey) { throw 'certificate has no private key here' }
  if ($cert.Subject -eq $cert.Issuer) { throw 'refusing a self-signed certificate: it cannot give public trust' }
  if (-not ($cert.EnhancedKeyUsageList | Where-Object { $_.ObjectId -eq '1.3.6.1.5.5.7.3.3' })) { throw 'certificate lacks the Code Signing enhanced key usage' }
  $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
  if (-not $chain.Build($cert)) { throw 'certificate does not chain to a trusted root on this machine; refusing' }
}
function Set-ReleaseSignature([string]$File) {
  $signature = Set-AuthenticodeSignature -FilePath $File -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $TimestampUrl -IncludeChain NotRoot
  if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate -or $signature.SignerCertificate.Thumbprint -ne $cert.Thumbprint) {
    throw "Release signing failed or returned no trusted timestamp for $File"
  }
}
# Exactly what ships. Anything else in the output folder is a build error, not payload.
$shipped = @('McCluster.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','README.txt','MICROSOFT-WEBVIEW2-LICENSE.txt')
if (Test-Path $OutDir) { Remove-Item (Join-Path $OutDir '*') -Force -ErrorAction SilentlyContinue }
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
$version = (Get-Item $exe).VersionInfo.FileVersion -replace '\.0$',''
# The shipped README carries the built version so it cannot drift from the binary.
((Get-Content (Join-Path $here 'package\README.txt') -Raw) -replace '__VERSION__', $version) | Set-Content (Join-Path $OutDir 'README.txt') -Encoding ascii -NoNewline
$licenseSrc = Join-Path $WebView2Dir 'MICROSOFT-WEBVIEW2-LICENSE.txt'
if (-not (Test-Path $licenseSrc)) { $licenseSrc = Join-Path $WebView2Dir 'LICENSE.txt' }
if (-not (Test-Path $licenseSrc)) { $licenseSrc = Join-Path $here 'package\MICROSOFT-WEBVIEW2-LICENSE.txt' }
if (Test-Path $licenseSrc) { Copy-Item $licenseSrc (Join-Path $OutDir 'MICROSOFT-WEBVIEW2-LICENSE.txt') -Force }
elseif ($Installer) { throw 'WebView2 licence text (BSD-3-Clause notice) not found; the payload must ship it (LICENSES.md)' }
else { Write-Warning 'WebView2 licence text not found beside the DLLs; -Installer will refuse until it is present' }
Get-ChildItem $OutDir | Select-Object Name, Length, @{n='Version';e={$_.VersionInfo.FileVersion}}, @{n='SHA256';e={(Get-FileHash $_.FullName).Hash}} | Format-Table -AutoSize | Out-String | Write-Host

if ($Tests -or $Installer) {
  $testOut = Join-Path $dist 'tests'
  New-Item -ItemType Directory -Force $testOut | Out-Null
  $testExe = Join-Path $testOut 'McClusterTests.exe'
  $testSources = @('NavigationPolicy.cs','Json.cs','LocalJobs.cs','DeviceInventory.cs','LocalRuntime.cs','Proof.cs','ExoProbe.cs','Contribution.cs','CoreJobs.cs','PanelRuns.cs') | ForEach-Object { Join-Path $src $_ }
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
  foreach ($stale in @($payload, (Join-Path $dist 'SHA256SUMS.txt')) + (Get-ChildItem $dist -Filter 'McCluster-Windows-x64-Setup-*.exe' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })) { if ($stale -and (Test-Path $stale)) { Remove-Item $stale -Force } }
  $present = Get-ChildItem $OutDir -File | ForEach-Object { $_.Name }
  $extra = $present | Where-Object { $shipped -notcontains $_ }
  if ($extra) { throw "unexpected files in ${OutDir}: $($extra -join ', ')" }
  $missing = $shipped | Where-Object { $present -notcontains $_ }
  if ($missing) { throw "shipped files missing from ${OutDir}: $($missing -join ', ')" }
  $names = [string[]]$shipped; [Array]::Sort($names, [StringComparer]::Ordinal)
  # Source commit and tree state come from git, never from a guess; a dirty tree needs -AllowDirty.
  $gitExe = $null
  foreach ($candidate in @((Get-Command git -ErrorAction SilentlyContinue | ForEach-Object Source), (Join-Path $env:LOCALAPPDATA 'github-copilot-git-2.56.0-1\cmd\git.exe'))) { if ($candidate -and (Test-Path $candidate)) { $gitExe = $candidate; break } }
  $sourceDirty = $null
  if ($gitExe) {
    $head = (& $gitExe -C $here rev-parse HEAD 2>$null)
    if ($Release -and ($LASTEXITCODE -ne 0 -or $head -notmatch '^[0-9a-f]{40}$')) { throw 'Git could not verify the release source revision.' }
    if ($head -match '^[0-9a-f]{40}$') { if ($SourceCommit -and $SourceCommit -ne $head -and -not $head.StartsWith($SourceCommit)) { throw "-SourceCommit $SourceCommit does not match HEAD $head" }; $SourceCommit = $head }
    $sourceDirty = [bool]((& $gitExe -C $here status --porcelain -- . 2>$null) | Where-Object { $_ })
    if ($LASTEXITCODE -ne 0) { throw 'Git could not determine whether the desktop source is clean.' }
    if ($sourceDirty -and -not $AllowDirty) { throw 'the desktop/windows tree has uncommitted changes; commit them or pass -AllowDirty (the manifest will say built_from_clean_tree=false)' }
  } elseif ($SourceCommit -and $SourceCommit -notmatch '^[0-9a-f]{7,40}$') { throw '-SourceCommit must be a hex commit id' }
  if ($Release) {
    if ($sourceDirty -ne $false -or $SourceCommit -notmatch '^[0-9a-f]{40}$') { throw 'A release requires a verified clean desktop source revision.' }
    Set-ReleaseSignature $exe
  }
  $files = $names | ForEach-Object { Get-Item (Join-Path $OutDir $_) }
  $manifestFiles = @()
  foreach ($f in $files) { $manifestFiles += [ordered]@{ name = $f.Name; sha256 = (Get-FileHash $f.FullName).Hash.ToLowerInvariant(); size = $f.Length } }
  $manifest = [ordered]@{ schema = 'mccluster-install-manifest/1'; product = 'McCluster'; version = $version; source_commit = $SourceCommit; built_from_clean_tree = $(if ($null -eq $sourceDirty) { $null } else { -not $sourceDirty }); built_with = 'in-box csc ' + (Get-Item $csc).VersionInfo.FileVersion; files = $manifestFiles }
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

  # 2. Setup candidate = installer sources + the shared Json helper, with payload.zip embedded as a resource.
  #    It gets its final name only after the installer tests pass against it.
  $candidate = Join-Path $dist 'tests\Setup-candidate.exe'
  if (Test-Path $candidate) { Remove-Item $candidate -Force }
  $setupSources = @((Join-Path $here 'installer\Setup.cs'), (Join-Path $src 'Json.cs'))
  $setupArgs = @('/nologo','/noconfig','/nostdlib+','/warnaserror+','/optimize+','/target:winexe','/platform:x64','/langversion:5',
    "/win32manifest:$(Join-Path $src 'app.manifest')", "/out:$candidate", "/resource:$payload,payload.zip") + $refs + $setupSources
  & $csc @setupArgs
  if ($LASTEXITCODE -ne 0) { throw "setup build failed with exit $LASTEXITCODE" }

  if ($Release) { Set-ReleaseSignature $candidate }

  # 3. Installer tests against the candidate into a throwaway per-user root, Start Menu folder and HKCU key.
  $instTestExe = Join-Path $dist 'tests\InstallerTests.exe'
  $instTestSources = @((Join-Path $here 'installer\tests\InstallerTests.cs'), (Join-Path $here 'installer\Setup.cs'), (Join-Path $src 'Json.cs'))
  $instTestArgs = @('/nologo','/noconfig','/nostdlib+','/warnaserror+','/target:exe','/platform:x64','/langversion:5',"/out:$instTestExe", '/main:InstallerTests') + $refs + $instTestSources
  & $csc @instTestArgs
  if ($LASTEXITCODE -ne 0) { throw "installer test build failed with exit $LASTEXITCODE" }
  & $instTestExe $candidate $OutDir
  if ($LASTEXITCODE -ne 0) { throw "installer tests failed with exit $LASTEXITCODE; no setup was written" }

  $setupExe = Join-Path $dist "McCluster-Windows-x64-Setup-$version.exe"
  Move-Item $candidate $setupExe -Force
  $sums = Join-Path $dist 'SHA256SUMS.txt'
  "$((Get-FileHash $setupExe).Hash.ToLowerInvariant())  $(Split-Path $setupExe -Leaf)`n$((Get-FileHash $payload).Hash.ToLowerInvariant())  payload.zip" | Set-Content $sums -Encoding ascii
  Write-Host ("setup {0} bytes sha256 {1}" -f (Get-Item $setupExe).Length, (Get-FileHash $setupExe).Hash)

  # 4. Release gate: signatures and sums. Always recorded in dist\release-status.json; fatal only with -Release,
  #    so a developer build still produces an (unsigned) setup for the installer tests while a release cannot
  #    ship unsigned first-party binaries.
  $gateArgs = @('-Dist', $dist, '-AppDir', $OutDir)
  if ($Release) { $gateArgs += @('-Thumbprint', $Thumbprint) }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'release-gate.ps1') @gateArgs
  $gate = $LASTEXITCODE
  if ($gate -ne 0 -and $Release) { throw "release gate failed (exit $gate); see dist\release-status.json. No release without a publicly trusted signature." }
  if ($gate -ne 0) { Write-Warning 'release gate FAILED: this build is a developer build, not a release (dist\release-status.json)' }
}
