#Requires -Version 5.1
[CmdletBinding()]
param([string]$Destination = (Join-Path $env:LOCALAPPDATA 'McClusterDesktop\voice'))

# Optional, owner-run setup for the offline Windows voice preview.
# Download and verify the complete pack before exposing it to EquityNet.
$ErrorActionPreference = 'Stop'
$target = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $target) { throw 'The destination already exists. Select an empty, new directory.' }
$parent = [IO.Path]::GetDirectoryName($target)
[void][IO.Directory]::CreateDirectory($parent)
$stage = Join-Path $parent ('.equitynet-voice-' + [guid]::NewGuid().ToString('N'))
$pack = Join-Path $stage 'pack'
[void][IO.Directory]::CreateDirectory($pack)
$voiceFiles = 'https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/en/en_US/ljspeech/medium/'
$assets = @(
  @{ file='vosk-win64-0.3.45.zip'; sha='f1dcc9cca460630f81ea8f71794f69c80bed6556d2a4e6237b5785e1d2dff34b'; uri='https://github.com/alphacep/vosk-api/releases/download/v0.3.45/vosk-win64-0.3.45.zip' }
  @{ file='vosk-model-small-en-us-0.15.zip'; sha='30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498'; uri='https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip' }
  @{ file='piper_windows_amd64.zip'; sha='f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea'; uri='https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip' }
  @{ file='en_US-ljspeech-medium.onnx'; sha='6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22'; uri=($voiceFiles + 'en_US-ljspeech-medium.onnx') }
  @{ file='en_US-ljspeech-medium.onnx.json'; sha='141d612cc0a95ed7efc1ca936b845c2364967f2e9217c5dbfcf69fc4d6c65860'; uri=($voiceFiles + 'en_US-ljspeech-medium.onnx.json') }
)
try {
  foreach ($asset in $assets) {
    $file = Join-Path $stage $asset.file
    Write-Host ('Downloading ' + $asset.file)
    Invoke-WebRequest -UseBasicParsing -Uri $asset.uri -OutFile $file
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $asset.sha) {
      throw ('SHA-256 did not match ' + $asset.file)
    }
    if ($asset.file.EndsWith('.zip')) {
      Expand-Archive -LiteralPath $file -DestinationPath $pack
    } else {
      [IO.File]::Move($file, (Join-Path $pack $asset.file))
    }
  }
  # Directory.Move fails if another setup has installed the pack in the meantime.
  [IO.Directory]::Move($pack, $target)
  Write-Host ('Offline voice pack ready at ' + $target)
} finally {
  $resolvedStage = [IO.Path]::GetFullPath($stage)
  if ([IO.Path]::GetDirectoryName($resolvedStage) -eq $parent -and
      [IO.Path]::GetFileName($resolvedStage) -match '^\.equitynet-voice-[0-9a-f]{32}$' -and
      (Test-Path -LiteralPath $resolvedStage -PathType Container)) {
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
  }
}
