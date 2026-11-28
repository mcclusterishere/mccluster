#Requires -Version 5.1
<#
.SYNOPSIS
Get It Back: clearly labelled SCRATCH dialogue from the script, with Windows' own speech engine.

.DESCRIPTION
Placeholder voices only, so the cut can be timed before the real performances are
recorded (Table Read). Uses System.Speech (built into Windows; nothing is downloaded,
nothing leaves the machine). Every file is named SCRATCH_<id>.wav and conform_cut.py
labels it "SCRATCH AUDIO" on screen. No voice is cloned or imitated: these are the
stock Windows voices.

  powershell -ExecutionPolicy Bypass -File scratch_voice.ps1 -Lines lines.json -OutDir audio

lines.json: [{"id": "dave-01", "speaker": "DAVE", "text": "I'm a whole new man, man.", "rate": 0}]
Optional per line: "voice" (an installed voice name), "rate" (-10..10).
#>
param(
  [Parameter(Mandatory = $true)][string]$Lines,
  [string]$OutDir = "audio"
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$items = Get-Content -Raw -LiteralPath $Lines | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name }
Write-Host ("Installed voices: " + ($voices -join ', '))
$bySpeaker = @{}
$i = 0
foreach ($it in $items) {
  if ($it.id -notmatch '^[A-Za-z0-9_-]{1,40}$') { throw "Bad id: $($it.id)" }
  $voice = $it.voice
  if (-not $voice) {
    if (-not $bySpeaker.ContainsKey($it.speaker)) { $bySpeaker[$it.speaker] = $voices[$i % $voices.Count]; $i++ }
    $voice = $bySpeaker[$it.speaker]
  }
  $synth.SelectVoice($voice)
  $synth.Rate = [int]($(if ($null -ne $it.rate) { $it.rate } else { 0 }))
  $path = Join-Path $OutDir ("SCRATCH_{0}.wav" -f $it.id)
  $fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $synth.SetOutputToWaveFile($path, $fmt)
  $synth.Speak([string]$it.text)
  $synth.SetOutputToNull()
  Write-Host ("SCRATCH {0,-10} {1,-12} {2} -> {3}" -f $it.speaker, $it.id, $voice, $path)
}
$synth.Dispose()
