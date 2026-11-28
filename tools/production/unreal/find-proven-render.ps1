<#
.SYNOPSIS
  Read-only: find the Unreal render that worked on Prime (s31, in-editor Movie Render Queue)
  and print what the production executor needs to reuse it.

.DESCRIPTION
  Looks under the get-it-back production folder (and any extra -SearchRoot) for:
    * the verified proof MP4 (renders\s31-prime-radeon-unreal-proof-720p.mp4): size, sha256, ffprobe frame count;
    * every .uproject, newest first, with its Saved\Logs;
    * in those logs: the engine version, the RHI and GPU lines, Movie Render Queue lines (the
      executor used, the sequence and map rendered, frame ranges, output folder, errors such as
      the queue-manifest parse failure of the old -MoviePipelineConfig launch);
    * saved queue assets and MRQ config/manifest files.
  It writes one JSON report (default %TEMP%\mcc-proven-render.json) with a suggested
  "unreal_projects" entry for %LOCALAPPDATA%\McCluster\production-executor.json. Fields it could
  not determine are left as "<fill in: ...>"; check them against the editor before using them.

  It changes nothing: no file is written except the report, no editor is started.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\production\unreal\find-proven-render.ps1
#>
param(
  [string]$Root = (Join-Path $env:LOCALAPPDATA 'McCluster\Productions\get-it-back'),
  [string[]]$SearchRoot = @(),
  [string]$Out = (Join-Path $env:TEMP 'mcc-proven-render.json'),
  [string]$FFprobe = 'ffprobe'
)
$ErrorActionPreference = 'Stop'
$report = [ordered]@{ schema = 'mccluster-proven-render-discovery/1'; at = (Get-Date).ToString('o'); root = $Root; proof_mp4 = $null; projects = @(); suggested_executor_entry = $null; notes = @() }

$mp4 = Join-Path $Root 'renders\s31-prime-radeon-unreal-proof-720p.mp4'
if (Test-Path $mp4) {
  $item = Get-Item $mp4
  $probe = $null
  try { $probe = & $FFprobe -v error -count_frames -select_streams v:0 -show_entries 'stream=nb_read_frames,width,height,r_frame_rate:format=duration' -of json $mp4 | ConvertFrom-Json } catch { $report.notes += "ffprobe not run: $($_.Exception.Message)" }
  $report.proof_mp4 = [ordered]@{ path = $mp4; bytes = $item.Length; written = $item.LastWriteTime.ToString('o'); sha256 = (Get-FileHash $mp4 -Algorithm SHA256).Hash.ToLower(); probe = $probe }
} else { $report.notes += "proof MP4 not found at $mp4" }

$patterns = @(
  'Engine Version', 'Found D3D12 adapter', 'Chosen D3D12', 'Creating D3D12 RHI', 'RHI Adapter Info', '^\s*LogInit:\s+Name\s*:', 'Driver Version',
  'LogMovieRenderPipeline', 'MoviePipelinePIEExecutor', 'MoviePipelineNewProcessExecutor', 'MoviePipelineConfig', 'QueueManifest', 'manifest',
  'LevelSequence', 'Executor', 'Output Directory', 'Finished', 'Error'
)
$roots = @($Root) + $SearchRoot | Where-Object { $_ -and (Test-Path $_) }
$uprojects = foreach ($r in $roots) { Get-ChildItem -Path $r -Recurse -Filter *.uproject -ErrorAction SilentlyContinue }
foreach ($u in ($uprojects | Sort-Object LastWriteTime -Descending)) {
  $dir = $u.DirectoryName
  $logs = @(Get-ChildItem -Path (Join-Path $dir 'Saved\Logs') -Filter *.log -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 8)
  $logInfo = foreach ($l in $logs) {
    $hits = Select-String -Path $l.FullName -Pattern $patterns -ErrorAction SilentlyContinue | Select-Object -First 80 | ForEach-Object { $_.Line.Trim() }
    [ordered]@{ path = $l.FullName; written = $l.LastWriteTime.ToString('o'); lines = @($hits) }
  }
  $queues = @(Get-ChildItem -Path $dir -Recurse -Include *Queue*.uasset, *.utxt, *MoviePipeline*.ini -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notmatch '\\(Intermediate|DerivedDataCache)\\' } | Select-Object -First 20 | ForEach-Object { [ordered]@{ path = $_.FullName; written = $_.LastWriteTime.ToString('o') } })
  $sequences = @(Get-ChildItem -Path (Join-Path $dir 'Content') -Recurse -Filter *.uasset -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Seq|LS_|Sequence|s31' } | Select-Object -First 20 | ForEach-Object { '/Game/' + ($_.FullName.Substring((Join-Path $dir 'Content').Length + 1) -replace '\\', '/' -replace '\.uasset$', '') })
  $maps = @(Get-ChildItem -Path (Join-Path $dir 'Content') -Recurse -Filter *.umap -ErrorAction SilentlyContinue | Select-Object -First 20 | ForEach-Object { '/Game/' + ($_.FullName.Substring((Join-Path $dir 'Content').Length + 1) -replace '\\', '/' -replace '\.umap$', '') })
  $rendered = @($logInfo | ForEach-Object { $_.lines } | Where-Object { $_ -match '/Game/[A-Za-z0-9_/]+' } | ForEach-Object { [regex]::Matches($_, '/Game/[A-Za-z0-9_/]+(\.[A-Za-z0-9_]+)?') | ForEach-Object { $_.Value } } | Select-Object -Unique -First 20)
  $report.projects += [ordered]@{ uproject = $u.FullName; written = $u.LastWriteTime.ToString('o'); logs = @($logInfo); queue_files = $queues; sequence_assets = $sequences; maps = $maps; object_paths_in_logs = $rendered }
}

$best = $report.projects | Select-Object -First 1
if ($best) {
  $gpu = ($best.logs | ForEach-Object { $_.lines } | Where-Object { $_ -match 'Found D3D12 adapter|\bName\s*:' } | Select-Object -First 1)
  $report.suggested_executor_entry = [ordered]@{
    unreal_projects = [ordered]@{
      'gib-s31-proof' = [ordered]@{
        production_project = 'get-it-back'
        uproject = $best.uproject
        isolate = 'copy'
        rhi = 'd3d12'
        require_adapter = 'Radeon'
        render_offscreen = $false
        sequences = [ordered]@{
          's31-standin' = [ordered]@{
            map = $(if ($best.maps.Count -eq 1) { $best.maps[0] } else { '<fill in: the map the queue rendered; see maps / object_paths_in_logs>' })
            sequence = $(if ($best.sequence_assets.Count -eq 1) { $best.sequence_assets[0] } else { '<fill in: the Level Sequence the queue rendered; see sequence_assets / object_paths_in_logs>' })
            shot_ids = @('s31'); frame_start = 0; frame_end = 119
            settings = [ordered]@{ spatial_samples = 1; temporal_samples = 1 }
          }
        }
      }
    }
    gpu_line_seen = $gpu
  }
  $report.notes += 'Check map, sequence, frame range and anti-aliasing samples against the queue that rendered the proof (Movie Render Queue window, or the queue asset listed above) before using the entry.'
}

$report | ConvertTo-Json -Depth 12 | Set-Content -Path $Out -Encoding UTF8
Write-Host "Wrote $Out"
Write-Host ("Proof MP4: " + $(if ($report.proof_mp4) { "$($report.proof_mp4.path) ($($report.proof_mp4.bytes) bytes)" } else { 'not found' }))
Write-Host ("Projects found: " + $report.projects.Count)
if ($best) { Write-Host "Newest project: $($best.uproject)"; Write-Host "Suggested entry: see suggested_executor_entry in the report" }
