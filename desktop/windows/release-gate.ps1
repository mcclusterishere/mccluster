#Requires -Version 5.1
<#
.SYNOPSIS
Release gate for EquityNet (McCluster compute network client for Windows): every first-party binary and the setup must carry a valid,
timestamped Authenticode signature chained to a publicly trusted root, and SHA256SUMS.txt must match.

.DESCRIPTION
Run after build-inbox.ps1 -Installer. This check writes dist\release-status.json and verifies
the executables delivered by the setup. Use build-inbox.ps1 -Installer -Release -Thumbprint
to sign a release with a timestamp. Smart App Control admission requires a separate device check.

Status values per file: valid-public (signed, timestamped, chain to a trusted root, not self-signed),
valid-microsoft (third-party Microsoft file), unsigned, self-signed, untimestamped, invalid.
#>
[CmdletBinding()]
param(
  [string]$Dist,
  [string]$AppDir,
  [switch]$Sign,
  [string]$Thumbprint,
  [string]$TimestampUrl = 'http://timestamp.digicert.com',
  [switch]$AllowUntimestamped
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($Sign -or $AllowUntimestamped) { throw 'Release verification requires timestamped artifacts. Sign before bundling with build-inbox.ps1 -Installer -Release -Thumbprint <id>.' }
if (-not $Dist) { $Dist = Join-Path $here 'dist' }
if (-not $AppDir) { $AppDir = Join-Path $Dist 'app' }
. (Join-Path $here 'release-payload.ps1')
. (Join-Path $here 'check-version.ps1')
$sourceVersion = Get-EquityNetSourceVersion -Root $here
$setups = @(Get-ChildItem -LiteralPath $Dist -File -Filter 'EquityNet-Windows-x64-Setup-*.exe')
if ($setups.Count -ne 1) { throw "Expected exactly one setup in $Dist; run build-inbox.ps1 -Installer first" }
$setup = $setups[0]
$expectedSetup = "EquityNet-Windows-x64-Setup-$sourceVersion.exe"
if ($setup.Name -ne $expectedSetup) { throw "Setup $($setup.Name) does not match Version.cs / csproj / NSIS version $sourceVersion (expected $expectedSetup)" }
$appExe = Join-Path $AppDir 'McCluster.exe'
if (-not (Test-Path -LiteralPath $appExe)) { throw "McCluster.exe not found in $AppDir" }
$appVersion = (Get-Item -LiteralPath $appExe).VersionInfo.FileVersion
$appNormalized = $appVersion -replace '\.0$',''
if ($appNormalized -ne $sourceVersion) { throw "McCluster.exe FileVersion $appVersion does not match source version $sourceVersion" }

function Get-SignatureFacts([string]$path) {
  $sig = Get-AuthenticodeSignature $path
  $cert = $sig.SignerCertificate
  $facts = [ordered]@{ file = $path; status = 'unsigned'; authenticode = [string]$sig.Status; subject = $null; thumbprint = $null; issuer = $null; self_signed = $null; timestamped = $false; timestamp_signer = $null; chain_trusted = $null; not_after = $null }
  if ($null -eq $cert) { return $facts }
  $facts.subject = $cert.Subject; $facts.thumbprint = $cert.Thumbprint; $facts.issuer = $cert.Issuer; $facts.not_after = $cert.NotAfter.ToString('o')
  $facts.self_signed = ($cert.Subject -eq $cert.Issuer)
  $facts.timestamped = ($null -ne $sig.TimeStamperCertificate)
  if ($facts.timestamped) { $facts.timestamp_signer = $sig.TimeStamperCertificate.Subject }
  $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
  $chain.ChainPolicy.RevocationMode = 'NoCheck'
  $facts.chain_trusted = $chain.Build($cert)
  if ($sig.Status -ne 'Valid') { $facts.status = 'invalid' }
  elseif ($facts.self_signed -or -not $facts.chain_trusted) { $facts.status = 'self-signed' }
  elseif (-not $facts.timestamped) { $facts.status = 'untimestamped' }
  elseif ($cert.Subject -match 'O=Microsoft Corporation') { $facts.status = 'valid-microsoft' }
  else { $facts.status = 'valid-public' }
  return $facts
}

# SHA256SUMS must cover exactly the artifacts this installer builds.
$expectedSums = @($setup.Name, 'payload.zip')
$sumsOk = $true
$sumRows = @()
$seen = @{}
foreach ($line in Get-Content -LiteralPath (Join-Path $Dist 'SHA256SUMS.txt')) {
  if ($line -notmatch '^([0-9a-f]{64})\s+(.+)$') { $sumsOk = $false; continue }
  $expected = $Matches[1]; $name = $Matches[2]
  if ($expectedSums -notcontains $name -or $seen.ContainsKey($name)) { $sumsOk = $false; continue }
  $seen[$name] = $true
  $actual = (Get-FileHash -LiteralPath (Join-Path $Dist $name)).Hash.ToLowerInvariant()
  $sumRows += [ordered]@{ file = $name; expected = $expected; actual = $actual; ok = ($expected -eq $actual) }
  if ($expected -ne $actual) { $sumsOk = $false }
}
$sumsOk = $sumsOk -and $seen.Count -eq $expectedSums.Count

$setupFacts = Get-SignatureFacts $setup.FullName
$setupFacts.role = 'first-party'
$rows = @($setupFacts)
$payloadVerified = $false
$payloadError = $null
# Read resources only from a setup whose outer signature has passed.
$expectedPublisher = $Thumbprint -and $setupFacts.thumbprint -eq $Thumbprint
if ($setupFacts.status -eq 'valid-public' -and $expectedPublisher) {
  try {
    $assembly = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($setup.FullName))
    $stream = $assembly.GetManifestResourceStream('payload.zip')
    if ($null -eq $stream) { throw 'The signed setup has no embedded payload.zip.' }
    try { $rows += @(Get-ReleasePayloadFacts -Embedded $stream -Dist $Dist -AppDir $AppDir) }
    finally { $stream.Dispose() }
    $payloadVerified = $true
  } catch { $payloadError = $_.Exception.Message }
}
$firstPartyOk = $payloadVerified -and $expectedPublisher -and @($rows | Where-Object {
  $_.role -eq 'first-party' -and ($_.status -ne 'valid-public' -or $_.thumbprint -ne $setupFacts.thumbprint)
}).Count -eq 0
$thirdPartyOk = $payloadVerified -and @($rows | Where-Object { $_.role -eq 'third-party' -and $_.status -ne 'valid-microsoft' }).Count -eq 0
$pass = $sumsOk -and $firstPartyOk -and $thirdPartyOk
$blocker = $null
if ($payloadError) { $blocker = $payloadError }
elseif ($setupFacts.status -ne 'valid-public') { $blocker = "The setup needs a publicly trusted, timestamped release signature ($($setupFacts.status))." }
elseif (-not $expectedPublisher) { $blocker = 'Verify with the approved publicly issued publisher thumbprint using -Thumbprint.' }
elseif (-not $firstPartyOk) { $blocker = 'The embedded app needs a valid timestamped signature from the setup signer.' }
elseif (-not $thirdPartyOk) { $blocker = 'The embedded WebView2 files need valid Microsoft signatures.' }
elseif (-not $sumsOk) { $blocker = 'The two release artifact checksums must be complete and match.' }
$status = [ordered]@{
  schema = 'mccluster-release-status/1'
  checked_at = [DateTime]::UtcNow.ToString('o')
  dist = $Dist
  setup = $setup.Name
  setup_sha256 = (Get-FileHash $setup.FullName).Hash.ToLowerInvariant()
  embedded_payload_verified = $payloadVerified
  sums_ok = $sumsOk
  sums = $sumRows
  first_party_signed_publicly = $firstPartyOk
  third_party_signed = $thirdPartyOk
  gate_passed = $pass
  blocker = $blocker
  smart_app_control_note = 'Not probed or changed by this gate. SAC admits publicly signed, reputable binaries; an unsigned setup may be blocked by hash on a SAC-enforcing machine.'
  files = $rows
}
$status | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Dist 'release-status.json') -Encoding utf8
foreach ($r in $rows) { Write-Host ("{0,-14} {1,-12} {2}" -f $r.status, $r.role, $r.file) }
Write-Host ("sums {0}; first-party publicly signed {1}; gate {2}" -f $sumsOk, $firstPartyOk, $(if ($pass) { 'PASSED' } else { 'FAILED' }))
if ($blocker) { Write-Host "blocker: $blocker" }
if (-not $pass) { exit 2 }
exit 0
