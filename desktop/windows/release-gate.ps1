#Requires -Version 5.1
<#
.SYNOPSIS
Release gate for McCluster for Windows: every first-party binary and the setup must carry a valid,
timestamped Authenticode signature chained to a publicly trusted root, and SHA256SUMS.txt must match.

.DESCRIPTION
Run after build-inbox.ps1 -Installer. Without -Sign it only checks and writes dist\release-status.json;
the exit code is 0 only when the gate passes. With -Sign it signs the first-party files with the
certificate named by -Thumbprint (CurrentUser\My or LocalMachine\My) and the RFC 3161 timestamp server
-TimestampUrl, then checks. It refuses to sign with a self-signed or test certificate and never installs
or trusts a certificate: public trust comes only from a certificate issued by a publicly trusted CA
(see Microsoft's Smart App Control code-signing guidance). Smart App Control is not changed or probed
here; whether SAC admits the result is decided by SAC on the installed machine.

Status values per file: valid-public (signed, timestamped, chain to a trusted root, not self-signed),
valid-microsoft (third-party Microsoft file), unsigned, self-signed, untimestamped, invalid.
#>
[CmdletBinding()]
param(
  [string]$Dist,
  [switch]$Sign,
  [string]$Thumbprint,
  [string]$TimestampUrl = 'http://timestamp.digicert.com',
  [switch]$AllowUntimestamped
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Dist) { $Dist = Join-Path $here 'dist' }
$firstParty = @('app\McCluster.exe')
$thirdParty = @('app\Microsoft.Web.WebView2.Core.dll', 'app\Microsoft.Web.WebView2.WinForms.dll', 'app\WebView2Loader.dll')
$setup = Get-ChildItem $Dist -Filter 'McCluster-Windows-x64-Setup-*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $setup) { throw "no setup in ${Dist}; run build-inbox.ps1 -Installer first" }

function Get-SignatureFacts([string]$path) {
  $sig = Get-AuthenticodeSignature $path
  $cert = $sig.SignerCertificate
  $facts = [ordered]@{ file = $path; status = 'unsigned'; authenticode = [string]$sig.Status; subject = $null; issuer = $null; self_signed = $null; timestamped = $false; timestamp_signer = $null; chain_trusted = $null; not_after = $null }
  if ($null -eq $cert) { return $facts }
  $facts.subject = $cert.Subject; $facts.issuer = $cert.Issuer; $facts.not_after = $cert.NotAfter.ToString('o')
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

if ($Sign) {
  if (-not $Thumbprint) { throw '-Sign needs -Thumbprint of a code-signing certificate with a private key' }
  $cert = @(Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $Thumbprint }) | Select-Object -First 1
  if (-not $cert) { throw "certificate $Thumbprint not found in CurrentUser\My or LocalMachine\My" }
  if (-not $cert.HasPrivateKey) { throw 'certificate has no private key here' }
  if ($cert.Subject -eq $cert.Issuer) { throw 'refusing a self-signed certificate: it cannot give public trust' }
  if (-not ($cert.EnhancedKeyUsageList | Where-Object { $_.ObjectId -eq '1.3.6.1.5.5.7.3.3' })) { throw 'certificate lacks the Code Signing enhanced key usage' }
  $chain = New-Object System.Security.Cryptography.X509Certificates.X509Chain
  if (-not $chain.Build($cert)) { throw 'certificate does not chain to a trusted root on this machine; refusing' }
  foreach ($rel in $firstParty + @($setup.Name)) {
    $path = Join-Path $Dist $rel
    $r = Set-AuthenticodeSignature -FilePath $path -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $TimestampUrl -IncludeChain NotRoot
    if ($r.Status -ne 'Valid') { throw "signing $rel failed: $($r.Status) $($r.StatusMessage)" }
    Write-Host "signed  $rel  $($cert.Subject)"
  }
  Write-Warning 'The setup was signed after SHA256SUMS.txt was written; the sums are recomputed below.'
  $sums = Join-Path $Dist 'SHA256SUMS.txt'
  "$((Get-FileHash $setup.FullName).Hash.ToLowerInvariant())  $($setup.Name)`n$((Get-FileHash (Join-Path $Dist 'payload.zip')).Hash.ToLowerInvariant())  payload.zip" | Set-Content $sums -Encoding ascii
}

# 1. Sums: the file named in SHA256SUMS.txt must hash to the recorded value.
$sumsPath = Join-Path $Dist 'SHA256SUMS.txt'
$sumsOk = $true
$sumRows = @()
foreach ($line in Get-Content $sumsPath) {
  if ($line -notmatch '^([0-9a-f]{64})\s+(.+)$') { continue }
  $expected = $matches[1]; $name = $matches[2].Trim()
  $actual = (Get-FileHash (Join-Path $Dist $name)).Hash.ToLowerInvariant()
  $sumRows += [ordered]@{ file = $name; expected = $expected; actual = $actual; ok = ($expected -eq $actual) }
  if ($expected -ne $actual) { $sumsOk = $false }
}

# 2. Signatures.
$rows = @()
foreach ($rel in $firstParty + @($setup.Name)) { $f = Get-SignatureFacts (Join-Path $Dist $rel); $f.role = 'first-party'; $rows += $f }
foreach ($rel in $thirdParty) { $f = Get-SignatureFacts (Join-Path $Dist $rel); $f.role = 'third-party'; $rows += $f }
$firstPartyOk = @($rows | Where-Object { $_.role -eq 'first-party' -and -not ($_.status -eq 'valid-public' -or ($AllowUntimestamped -and $_.status -eq 'untimestamped')) }).Count -eq 0
$thirdPartyOk = @($rows | Where-Object { $_.role -eq 'third-party' -and $_.status -notin @('valid-microsoft', 'valid-public') }).Count -eq 0
$pass = $sumsOk -and $firstPartyOk -and $thirdPartyOk
$blocker = $null
if (-not $firstPartyOk) {
  $unsigned = @($rows | Where-Object { $_.role -eq 'first-party' -and $_.status -eq 'unsigned' }).Count
  if ($unsigned -gt 0) { $blocker = 'No code-signing identity: first-party binaries are unsigned. Public trust needs a certificate issued by a publicly trusted CA (an OV or EV code-signing certificate, or Azure Trusted Signing) in the signer''s store, then release-gate.ps1 -Sign -Thumbprint <id>. Self-signed and test certificates are refused by this gate and do not satisfy Smart App Control.' }
  else { $blocker = 'First-party signature present but not acceptable: ' + ((@($rows | Where-Object { $_.role -eq 'first-party' -and $_.status -ne 'valid-public' }) | ForEach-Object { "$($_.file) $($_.status)" }) -join '; ') }
}
$status = [ordered]@{
  schema = 'mccluster-release-status/1'
  checked_at = [DateTime]::UtcNow.ToString('o')
  dist = $Dist
  setup = $setup.Name
  setup_sha256 = (Get-FileHash $setup.FullName).Hash.ToLowerInvariant()
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
