# This fixture substitutes the Windows trust provider only at signature inspection.
# The ZIP, manifest, extracted bytes, hash comparisons and cleanup all use real files.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../release-payload.ps1')
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
function Get-SignatureFacts([string]$path) {
  $name = [IO.Path]::GetFileName($path)
  if ([IO.File]::ReadAllText($path) -cne ('fixture/' + $name)) { throw "Wrong bytes inspected for $name" }
  return [ordered]@{ file=$path; status='fixture' }
}
$root = Join-Path ([IO.Path]::GetTempPath()) ('mccluster-archive-test-' + [Guid]::NewGuid().ToString('N'))
$stage = Join-Path $root 'stage'
$app = Join-Path $root 'app'
$archive = Join-Path $root 'payload.zip'
function Check-Payload([string]$embeddedFile) {
  $stream = [IO.File]::OpenRead($embeddedFile)
  try { Get-ReleasePayloadFacts -Embedded $stream -Dist $root -AppDir $app } finally { $stream.Dispose() }
}
function Require-Failure([scriptblock]$Action, [string]$Expected) {
  try { & $Action | Out-Null } catch { if ($_.Exception.Message -match $Expected) { return }; throw }
  throw "Expected failure: $Expected"
}
function Pack-Fixture {
  if (Test-Path -LiteralPath $archive) { [IO.File]::Delete($archive) }
  [IO.Compression.ZipFile]::CreateFromDirectory($stage,$archive)
}
try {
  [void][IO.Directory]::CreateDirectory($stage)
  [void][IO.Directory]::CreateDirectory($app)
  $names = @('McCluster.exe','Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll','WebView2Loader.dll','README.txt','MICROSOFT-WEBVIEW2-LICENSE.txt')
  $files = foreach ($name in $names) {
    $p = Join-Path $stage $name
    [IO.File]::WriteAllText($p, 'fixture/' + $name)
    [IO.File]::Copy($p, (Join-Path $app $name))
    @{ name=$name; sha256=(Get-FileHash -LiteralPath $p).Hash; size=(Get-Item -LiteralPath $p).Length }
  }
  $manifest = @{schema='mccluster-install-manifest/1';files=@($files)}
  $manifestFile = Join-Path $stage 'manifest.json'
  [IO.File]::WriteAllText($manifestFile, ($manifest | ConvertTo-Json -Depth 4))
  Pack-Fixture
  $facts = @(Check-Payload $archive)
  if ($facts.Count -ne 4 -or @($facts | Where-Object { $_.role -eq 'first-party' }).Count -ne 1) { throw 'Expected signatures on four actual embedded binaries.' }
  $original = Join-Path $root 'original.zip'
  [IO.File]::Copy($archive,$original)
  $loose = Join-Path $app 'McCluster.exe'
  [IO.File]::WriteAllText($loose,'signed later')
  Require-Failure { Check-Payload $archive } 'Embedded bytes differ'
  [IO.File]::Copy((Join-Path $stage 'McCluster.exe'),$loose,$true)
  $manifest.files[0].sha256 = '0' * 64
  [IO.File]::WriteAllText($manifestFile, ($manifest | ConvertTo-Json -Depth 4))
  Pack-Fixture
  Require-Failure { Check-Payload $original } 'different payload.zip'
  Require-Failure { Check-Payload $archive } 'Embedded bytes differ'
  [IO.File]::WriteAllText((Join-Path $stage 'unexpected.dll'),'fixture')
  Pack-Fixture
  Require-Failure { Check-Payload $archive } 'file list differs'
  Write-Output 'Extracted release binaries, changed loose app, substituted ZIP, wrong manifest hash, unexpected file: PASS'
} finally { if ([IO.Directory]::Exists($root)) { [IO.Directory]::Delete($root,$true) } }
