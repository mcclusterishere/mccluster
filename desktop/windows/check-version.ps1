#Requires -Version 5.1
<#
.SYNOPSIS
Confirm EquityNet's assembly, project and NSIS versions all say the same three-part number.

.DESCRIPTION
src/Version.cs (AssemblyVersion / AssemblyFileVersion) is the source of truth stamped onto
McCluster.exe by the in-box compiler. The csproj <Version> and package/mccluster.nsi
PRODUCT_VERSION / PRODUCT_VERSION_QUAD must match. Run this off Windows against the sources.
With -Artifacts, also require dist\EquityNet-Windows-x64-Setup-<version>.exe and, on Windows,
McCluster.exe FileVersion to match. release-gate.ps1 dotsources this script and applies the
artifact checks after the setup has been built.
#>
[CmdletBinding()]
param(
  [string]$Root,
  [string]$Dist,
  [string]$AppDir,
  [switch]$Artifacts
)

function Get-EquityNetSourceVersion {
  [CmdletBinding()]
  param([Parameter(Mandatory=$true)][string]$Root)

  $versionCs = Join-Path $Root 'src/Version.cs'
  $csproj = Join-Path $Root 'src/McClusterDesktop.csproj'
  $nsi = Join-Path $Root 'package/mccluster.nsi'
  foreach ($path in @($versionCs, $csproj, $nsi)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing $path" }
  }

  $cs = [IO.File]::ReadAllText($versionCs)
  $asm = [regex]::Match($cs, '\[assembly:\s*AssemblyVersion\("([0-9]+\.[0-9]+\.[0-9]+\.0)"\)\]')
  $file = [regex]::Match($cs, '\[assembly:\s*AssemblyFileVersion\("([0-9]+\.[0-9]+\.[0-9]+\.0)"\)\]')
  if (-not $asm.Success -or -not $file.Success) {
    throw 'Version.cs must declare AssemblyVersion and AssemblyFileVersion as X.Y.Z.0'
  }
  if ($asm.Groups[1].Value -ne $file.Groups[1].Value) {
    throw "Version.cs AssemblyVersion $($asm.Groups[1].Value) does not match AssemblyFileVersion $($file.Groups[1].Value)"
  }
  $quad = $asm.Groups[1].Value
  $marketing = $quad -replace '\.0$',''

  $proj = [IO.File]::ReadAllText($csproj)
  $projVer = [regex]::Match($proj, '<Version>([0-9]+\.[0-9]+\.[0-9]+)</Version>')
  if (-not $projVer.Success) { throw 'McClusterDesktop.csproj must contain <Version>X.Y.Z</Version>' }
  if ($projVer.Groups[1].Value -ne $marketing) {
    throw "McClusterDesktop.csproj Version $($projVer.Groups[1].Value) does not match Version.cs $marketing"
  }

  $nsiText = [IO.File]::ReadAllText($nsi)
  $pv = [regex]::Match($nsiText, '!define\s+PRODUCT_VERSION\s+"([0-9]+\.[0-9]+\.[0-9]+)"')
  $pq = [regex]::Match($nsiText, '!define\s+PRODUCT_VERSION_QUAD\s+"([0-9]+\.[0-9]+\.[0-9]+\.0)"')
  if (-not $pv.Success -or -not $pq.Success) {
    throw 'mccluster.nsi must !define PRODUCT_VERSION "X.Y.Z" and PRODUCT_VERSION_QUAD "X.Y.Z.0"'
  }
  if ($pv.Groups[1].Value -ne $marketing) {
    throw "mccluster.nsi PRODUCT_VERSION $($pv.Groups[1].Value) does not match Version.cs $marketing"
  }
  if ($pq.Groups[1].Value -ne $quad) {
    throw "mccluster.nsi PRODUCT_VERSION_QUAD $($pq.Groups[1].Value) does not match Version.cs $quad"
  }
  if ($nsiText -match 'EquityNet-Windows-x64-Setup-[0-9]') {
    throw 'mccluster.nsi has a hardcoded setup filename; use ${PRODUCT_VERSION}'
  }
  if ($nsiText -match 'VIProductVersion\s+"[0-9]' -or $nsiText -match 'DisplayVersion"\s+"[0-9]') {
    throw 'mccluster.nsi has a hardcoded product version; use ${PRODUCT_VERSION} / ${PRODUCT_VERSION_QUAD}'
  }
  return $marketing
}

function Test-EquityNetArtifactVersions {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory=$true)][string]$Root,
    [Parameter(Mandatory=$true)][string]$Dist,
    [string]$AppDir
  )
  $version = Get-EquityNetSourceVersion -Root $Root
  $expectedSetup = "EquityNet-Windows-x64-Setup-$version.exe"
  if (-not (Test-Path -LiteralPath $Dist)) { throw "Dist folder not found: $Dist" }
  $setups = @(Get-ChildItem -LiteralPath $Dist -File -Filter 'EquityNet-Windows-x64-Setup-*.exe' -ErrorAction SilentlyContinue)
  if ($setups.Count -eq 0) { throw "No EquityNet setup found in $Dist (expected $expectedSetup)" }
  foreach ($setup in $setups) {
    if ($setup.Name -ne $expectedSetup) {
      throw "Setup $($setup.Name) does not match source version $version (expected $expectedSetup)"
    }
  }
  if ($AppDir) {
    $exe = Join-Path $AppDir 'McCluster.exe'
    if (-not (Test-Path -LiteralPath $exe)) { throw "McCluster.exe not found in $AppDir" }
    $fileVersion = $null
    try { $fileVersion = (Get-Item -LiteralPath $exe).VersionInfo.FileVersion } catch { $fileVersion = $null }
    if ([string]::IsNullOrWhiteSpace($fileVersion)) {
      Write-Host "McCluster.exe is present but FileVersion is unavailable on this platform; source and setup filename agree on $version."
    } else {
      $normalized = $fileVersion -replace '\.0$',''
      if ($normalized -ne $version) {
        throw "McCluster.exe FileVersion $fileVersion does not match source version $version"
      }
    }
  }
  return $version
}

if ($MyInvocation.InvocationName -ne '.') {
  $ErrorActionPreference = 'Stop'
  if (-not $Root) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Path }
  try {
    if ($Artifacts) {
      if (-not $Dist) { $Dist = Join-Path $Root 'dist' }
      if (-not $AppDir) { $AppDir = Join-Path $Dist 'app' }
      $version = Test-EquityNetArtifactVersions -Root $Root -Dist $Dist -AppDir $AppDir
      Write-Host "EquityNet ${version}: sources, setup filename and app FileVersion agree."
    } else {
      $version = Get-EquityNetSourceVersion -Root $Root
      Write-Host "EquityNet ${version}: Version.cs, McClusterDesktop.csproj and mccluster.nsi agree."
    }
    exit 0
  } catch {
    Write-Error $_
    exit 1
  }
}
