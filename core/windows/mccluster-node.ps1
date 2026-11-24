#Requires -Version 5.1
<#
.SYNOPSIS
McCluster compute node doctor and installer for a Windows GPU laptop.

.DESCRIPTION
The owner's one script for a Windows device that joins the McCluster compute fabric as its own
node (protocol mccluster-compute/1; runbook docs/control-plane/WINDOWS-NODE.md). Nothing runs
unless the owner invokes a switch; with no switch it is -Report, which only reads.

  -Report      GPU (name, the real VRAM from the registry's REG_QWORD, integrated or discrete,
               shared or dedicated memory, driver, PNP id, whether AdapterRAM wrapped), CPU, RAM,
               volumes (a candidate 50 GB partition is flagged), Ollama (version, installed models,
               what is loaded and whether the last load used the GPU, the Vulkan/ROCm line from
               its log), the two scheduled tasks, and the MCCLUSTER_* / OLLAMA_* variables. The
               block between === MCCLUSTER NODE REPORT === and === END REPORT === is pasteable:
               the user profile path, the computer name and the user name are masked; values are
               printed only for the non-secret names -Install writes, OLLAMA_* and
               GGML_VK_VISIBLE_DEVICES, MCCLUSTER_ORG_ID only as set (uuid), and every other
               MCCLUSTER_* name, and any name that says token, key, secret, password or
               credential, only as set or unset.
  -Install     Writes <StateRoot>\capabilities.json from the repository template
               core\node-manifests\owner-windows-gpu.json pruned to the model tier, node.config.json
               (no secrets), the two launchers adapter.cmd and agent.cmd, the user-scope variables,
               and registers the scheduled tasks "McCluster Node Adapter" and "McCluster Node Agent".
               Idempotent; -WhatIf shows every step and writes nothing.
  -Enroll      Reads the one-time enrolment token as a secure string, runs the agent once
               (MCCLUSTER_NODE_ENROLL_ONLY=1), then deletes the token file from this machine.
  -Models      ollama pull for the tier's models (qwen3:14b only on tier A: owner decision 2026-11-17,
               no 12B/14B model on a shared-memory machine).
  -Benchmark   Measures free memory before and after the model loads, prompt and generation tokens per
               second on the local Ollama, and writes <StateRoot>\measured-inference.json (schema
               mccluster-measured-inference/1), which the node agent publishes as evidence. A tier whose
               resident model leaves the machine under 4 GB free is refused (exit 1, the lower tier is
               named); -Model qwen3:8b decides whether the on-demand twin entry qwen3.8b.local stays
               advertised (removed when loading it leaves under 4 GB free, added back when it fits).
  -KeepAwake   Administrator only, explicit opt-in: AC standby and hibernate timeouts to 0.
  -ModelsPath  User-scope OLLAMA_MODELS (for the 50 GB partition).  -Vulkan <n>: GGML_VK_VISIBLE_DEVICES.
  -Browser     The one switch that downloads anything (slice N2, docs/control-plane/AGENT-NODE-BROWSER.md):
               the node's own browser. npm installs the pinned playwright package into <StateRoot>\browser,
               Playwright's own installer shows a dry run of the Chromium download and asks before fetching
               it into <StateRoot>\browser\ms-playwright; then <StateRoot>\browser-policy.json is written
               once (an empty allowlist: every open is refused until you name sites), the profile folder,
               the browser.cmd launcher and the scheduled task "McCluster Node Browser" are set up, and the
               browser.act/chromium.local entry from the template is added to capabilities.json.
               -WhatIf shows every step and writes nothing; declining the download changes nothing.
  -BrowserHeaded  Stops that task, runs the executor headed on this console (a visible Chromium on the
               node's own persistent profile) so you can sign the profile into the allowed sites by hand,
               and starts the task again at Ctrl+C. Nothing from your own browsers is read.
  -Pause       Writes the marker <StateRoot>\paused: the agent stops claiming within one poll and its
               heartbeat says paused=true. Running work finishes.  -Resume removes the marker.
  -Limits      Writes <StateRoot>\limits.json (schema mccluster-node-limits/1) from -IdleOnly, -OnACOnly,
               -MaxConcurrency 1..4 (default 1), -CpuBusyPercent 10..100, -BatteryFloorPercent 0..100 and
               -ThermalLimitC (0 = not set), re-registers the two scheduled tasks to match and sets
               max_leases / max_concurrency in capabilities.json. Idle-only: the tasks start only once
               Windows reports the device idle (RunOnlyIfIdle after 10 min idle, waiting up to 30 days for
               it), carry RestartOnIdle and are NOT stopped when the idle state ends (running work
               finishes); a third task, "McCluster Node Idle", is the one Windows stops at idle end and
               restarts on idle, and the agent reads whether it runs before each claim. AC-only changes
               no task setting: the tasks stay startable on battery and the agent's own gate refuses
               claims on battery (or when the power state is unknown) while it keeps heartbeating.
               -Install re-applies the plan of an existing limits.json. The agent enforces every limit
               before each claim and reports it in heartbeat labels; a thermal limit on a device whose
               thermal zone cannot be read is reported as unsupported, never silently dropped. Contract:
               docs/control-plane/COMPUTE-CONTRIBUTION-LEDGER.md on branch prime/contribution-ledger
               (not in this tree until that branch is merged).
  -Revoke      Stops and unregisters the McCluster Node tasks, ends the processes their launchers
               started, deletes identity.json (the node's key), verifies it is gone (retrying; if it is
               still there the run says so and exits 2 without claiming a deletion), then writes
               <StateRoot>\revoked.json (node id, time) and prints the node id the owner revokes on the
               Core. Never a token or a key.
  -Uninstall   -Revoke, then removes the state root and the user-scope variables -Install wrote.

Apart from -Browser, this script downloads nothing and evaluates no remote text. Models come through
the owner's own Ollama (-Models); the agent, the adapter and the browser executor are the Node sources
in the checkout given by -RepoPath. The compute node never holds a control-plane secret: the enrolment
token lives in <StateRoot>\enroll.env with an owner-only ACL for the one-shot enrolment and is removed
after it; when the desktop drives -Enroll it hands the token over in the environment variable
MCCLUSTER_NODE_ENROLL_TOKEN instead, and then no file is written at all. Nothing this script prints names
a token, a key, the user or the host.

.NOTES
Tests: core\windows\tests\mccluster-node.tests.ps1 (dot-sources this file with
MCCLUSTER_NODE_PS_LIBRARY=1, so nothing below the function definitions runs).
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$Report,
  [switch]$Install,
  [string]$RepoPath,
  [string]$NodeName = 'owner-windows-gpu',
  [ValidateSet('A', 'B', 'C', 'D')]
  [string]$Tier,
  [switch]$Enroll,
  [switch]$Models,
  [switch]$Benchmark,
  [string]$Model,
  [switch]$KeepAwake,
  [switch]$Browser,
  [switch]$BrowserHeaded,
  [string]$ModelsPath,
  [int]$Vulkan = -1,
  [switch]$Pause,
  [switch]$Resume,
  [switch]$Revoke,
  [switch]$Uninstall,
  [switch]$Limits,
  [switch]$IdleOnly,
  [switch]$OnACOnly,
  [ValidateRange(1, 4)]
  [int]$MaxConcurrency = 1,
  [ValidateRange(10, 100)]
  [int]$CpuBusyPercent = 0,
  [ValidateRange(0, 100)]
  [int]$BatteryFloorPercent = -1,
  [ValidateRange(0, 150)]
  [int]$ThermalLimitC = 0,
  [string]$StateRoot,
  [string]$ComputeUrl = 'https://compute.mccluster.org',
  [string]$OrgId
)

# ---- constants ---------------------------------------------------------------------------------
$script:McOllamaUrl = 'http://127.0.0.1:11434'
$script:McAdapterPort = 4790
# The node's own browser (slice N2): a second loopback executor, the pinned Playwright, the policy file schema.
$script:McBrowserPort = 4791
$script:McBrowserUrl = 'http://127.0.0.1:4791'
$script:McPlaywrightVersion = '1.63.0'
$script:McBrowserImplementation = 'chromium.local'
$script:McBrowserPolicySchema = 'mccluster-browser-policy/1'
$script:McBrowserTaskName = 'McCluster Node Browser'
$script:McDisplayClassKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
$script:McDisplayClassSubkeyPattern = '^HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Class\\\{4d36e968-e325-11ce-bfc1-08002be10318\}\\(\d{4})$'
$script:McRegistryValuePattern = '^\s{4}(\S+)\s{4}(REG_\w+)\s{4}(.*)$'
$script:McTemplateSegments = @('core', 'node-manifests', 'owner-windows-gpu.json')
# The models and the implementation ids that name them (core/node-manifests/owner-windows-gpu.json). Owner
# decision 2026-11-17, headroom first: one resident model per tier, the vision model; the OVH twin qwen3:8b on
# demand only; qwen3:14b on a discrete card with 12 GiB or more only; qwen3-vl:4b when free memory is short.
$script:McVisionModel = 'qwen3-vl:8b'
$script:McVisionImplementation = 'qwen3-vl.8b.local'
$script:McSmallVisionModel = 'qwen3-vl:4b'
$script:McSmallVisionImplementation = 'qwen3-vl.4b.local'
$script:McTwinModel = 'qwen3:8b'
$script:McTwinImplementation = 'qwen3.8b.local'
$script:McBiggerModel = 'qwen3:14b'
$script:McBiggerImplementation = 'qwen3.14b.local'
# Free memory at install that earns the 8B vision model on shared memory; below it the 4B model is resident.
$script:McIntegratedResidentFreeBytes = [int64]8000000000
# No tier may leave the machine under this much free memory once its model is loaded (-Benchmark measures it).
$script:McHeadroomFloorBytes = [int64]4000000000
# qwen3-vl needs this Ollama or newer (older builds answer HTTP 412).
$script:McMinimumOllamaVersion = '0.12.7'
$script:McIgnoredControllerPattern = 'Basic Display|Basic Render|Remote Display|Virtual|VMware|Hyper-V|Parsec|DisplayLink|RDP'
$script:McThinkModelPattern = '^qwen3(?:-vl)?:(?!.*instruct)'
# cmd.exe reads the launchers: & | run what follows, < > redirect, ^ escapes, %NAME% and !NAME! expand, " ends a path.
$script:McLauncherUnsafePattern = '[&|<>^"%!]'
# A variable whose name says so never has its value printed by -Report.
$script:McSecretNamePattern = 'TOKEN|KEY|SECRET|PASSWORD|PASSWD|PASS$|_PASS_|CREDENTIAL'
$script:McCandidatePartitionMin = [int64]45000000000
$script:McCandidatePartitionMax = [int64]59055800320
$script:McGiB = [int64]1073741824
$script:McTaskNames = @('McCluster Node Adapter', 'McCluster Node Agent')
$script:McMeasuredSchema = 'mccluster-measured-inference/1'
# The owner's contribution controls: the pause marker, the limits file the agent enforces before every claim,
# the revocation record, and the heartbeat file the agent writes. The contract is
# docs/control-plane/COMPUTE-CONTRIBUTION-LEDGER.md on branch prime/contribution-ledger; that file is not in
# this tree until that branch is merged.
# Idle-only: the third task Windows stops at idle end and restarts on idle (the agent's live idle signal when
# its own session cannot measure the console's input), the idle time before a start, and how long a trigger
# waits for idle (Task Scheduler's default of 1 h silently drops the start).
$script:McIdleTaskName = 'McCluster Node Idle'
$script:McIdleDurationMinutes = 10
$script:McIdleWaitDays = 30
# -Revoke: how often and how far apart the delete of identity.json is retried before it is reported as failed.
$script:McDeleteAttempts = 5
$script:McDeleteRetryMs = 500
$script:McLimitsSchema = 'mccluster-node-limits/1'
$script:McRevokedSchema = 'mccluster-node-revoked/1'
$script:McMaxConcurrencyLimit = 4
# About 100 public words, the OVH-style request: an operations brief into bullet points.
$script:McBenchmarkPrompt = 'Summarize the following operations brief into five short bullet points for a weekly status note. The brief: the compute fabric ran twenty-nine chat tasks this week, and every one was claimed within two seconds of being queued. One node went offline for a night and its queued work was picked up by the other node without a retry. Model downloads finished for both models, and the larger one is measured before it is advertised. The team wants the note to name what shipped, what is measured, what is pending owner approval, and what the next review should look at first. Keep each bullet under twenty words.'
# Windows PowerShell 5.1 has no $IsWindows; its edition is Desktop and it only runs on Windows.
$script:McIsWindowsHost = ($PSVersionTable.PSEdition -eq 'Desktop') -or ($IsWindows -eq $true)

# ---- pure helpers (tested by core\windows\tests\mccluster-node.tests.ps1) -----------------------
function Test-McWindowsOnly {
  # Every Windows-only call sits behind this guard so the tests never touch the host.
  return ($script:McIsWindowsHost -or [bool]$env:MCCLUSTER_NODE_PS_FORCE)
}

function ConvertTo-McInt64 {
  param($Value)
  if ($null -eq $Value) { return $null }
  if ($Value -is [System.Array]) {
    if ($Value.Length -eq 0) { return $null }
    $Value = $Value[0]
  }
  if ($Value -is [int64] -or $Value -is [int32] -or $Value -is [int16] -or $Value -is [uint32] -or $Value -is [uint16] -or $Value -is [byte]) { return [int64]$Value }
  if ($Value -is [uint64]) {
    if ($Value -gt [uint64][int64]::MaxValue) { return $null }
    return [int64]$Value
  }
  if ($Value -is [double] -or $Value -is [single] -or $Value -is [decimal]) { return [int64][math]::Floor([double]$Value) }
  $text = ([string]$Value).Trim()
  if ($text -eq '') { return $null }
  if ($text -match '^0[xX]([0-9A-Fa-f]{1,16})$') { return [int64][System.Convert]::ToUInt64($matches[1], 16) }
  if ($text -match '^-?\d{1,18}$') { return [int64]$text }
  return $null
}

function Format-McBytes {
  param($Bytes)
  $n = ConvertTo-McInt64 $Bytes
  if ($null -eq $n) { return 'unknown' }
  $invariant = [System.Globalization.CultureInfo]::InvariantCulture
  if ($n -ge $script:McGiB) { return [string]::Format($invariant, '{0:0.0} GiB', ($n / $script:McGiB)) }
  if ($n -ge 1048576) { return [string]::Format($invariant, '{0:0} MiB', ($n / 1048576)) }
  return [string]::Format($invariant, '{0} bytes', $n)
}

function Get-McVendorId {
  param([string]$PnpDeviceId)
  if ([string]$PnpDeviceId -match 'VEN_([0-9A-Fa-f]{4})') { return $matches[1].ToUpperInvariant() }
  return $null
}

function Get-McVendor {
  param([string]$VendorId, [string]$AdapterCompatibility)
  switch ([string]$VendorId) {
    '1002' { return 'amd' }
    '10DE' { return 'nvidia' }
    '8086' { return 'intel' }
  }
  $compat = [string]$AdapterCompatibility
  if ($compat -match 'advanced micro|\bAMD\b|ATI') { return 'amd' }
  if ($compat -match 'nvidia') { return 'nvidia' }
  if ($compat -match 'intel') { return 'intel' }
  return 'unknown'
}

function Get-McGpuForm {
  # The same name rules as core/src/compute/hardware.mjs: an APU is integrated (shared memory).
  param([string]$Vendor, [string]$Name)
  $n = [string]$Name
  switch ([string]$Vendor) {
    'nvidia' { return 'discrete' }
    'amd' {
      if ($n -match '\bVega \d+ Graphics\b|\b\d{3}M\b|Radeon\(TM\) Graphics|Radeon Graphics$') { return 'integrated' }
      if ($n -match '\bRX\b|\bPRO\b|\bW\d{4}\b') { return 'discrete' }
      return 'unknown'
    }
    'intel' {
      if ($n -match '\bArc(?:\(TM\))?\s+[AB]\d{3}\b') { return 'discrete' }
      return 'integrated'
    }
  }
  return 'unknown'
}

function New-McRegistryEntry {
  param([string]$Subkey, [string]$DriverDesc, [string]$MatchingDeviceId, $QwMemorySize, [string]$DriverVersion)
  $matching = $null
  if ($MatchingDeviceId) { $matching = $MatchingDeviceId.ToUpperInvariant() }
  $qw = ConvertTo-McInt64 $QwMemorySize
  return [pscustomobject]@{
    Subkey = $Subkey
    DriverDesc = $DriverDesc
    MatchingDeviceId = $matching
    QwMemorySize = $qw
    DriverVersion = $DriverVersion
  }
}

function ConvertFrom-McRegQueryText {
  # Parses `reg query <display class key> /s` text (the recorded fixtures) into registry entries;
  # unknown lines and "ERROR: Access is denied." are ignored; never throws.
  param([string]$Text)
  $entries = New-Object System.Collections.ArrayList
  $current = $null
  foreach ($line in ([string]$Text -split "`r?`n")) {
    if ($line -match $script:McDisplayClassSubkeyPattern) {
      if ($null -ne $current) { [void]$entries.Add((New-McRegistryEntry @current)) }
      $current = @{ Subkey = $matches[1]; DriverDesc = $null; MatchingDeviceId = $null; QwMemorySize = $null; DriverVersion = $null }
      continue
    }
    if ($line -match '^HKEY_') {
      if ($null -ne $current) { [void]$entries.Add((New-McRegistryEntry @current)) }
      $current = $null
      continue
    }
    if ($null -eq $current) { continue }
    if ($line -match $script:McRegistryValuePattern) {
      $name = $matches[1]
      $data = $matches[3].TrimEnd()
      switch ($name) {
        'DriverDesc' { $current.DriverDesc = $data }
        'MatchingDeviceId' { $current.MatchingDeviceId = $data }
        'DriverVersion' { $current.DriverVersion = $data }
        'HardwareInformation.qwMemorySize' { $current.QwMemorySize = $data }
      }
    }
  }
  if ($null -ne $current) { [void]$entries.Add((New-McRegistryEntry @current)) }
  return @($entries.ToArray())
}

function Test-McIgnoredController {
  param($Controller)
  $pnp = [string]$Controller.PNPDeviceID
  if (-not $pnp.ToUpperInvariant().StartsWith('PCI\')) { return $true }
  if ([string]$Controller.Name -match $script:McIgnoredControllerPattern) { return $true }
  return $false
}

function Get-McSubkeyNumber {
  param($Subkey)
  $n = 0
  if ([int]::TryParse([string]$Subkey, [ref]$n)) { return $n }
  return -1
}

function Test-McPreferredRegistryEntry {
  # Windows keeps the 00NN subkeys of earlier driver installs beside the live one, with the same
  # MatchingDeviceId. The longer id wins; among equal ids the entry that carries a qwMemorySize (a stale
  # subkey usually has none), then the highest subkey number (the latest install). The same rule as
  # matchRegistryEntry in core/src/compute/hardware.mjs.
  param($Candidate, $Best)
  if ($null -eq $Best) { return $true }
  $candidateId = [string]$Candidate.MatchingDeviceId
  $bestId = [string]$Best.MatchingDeviceId
  if ($candidateId.Length -ne $bestId.Length) { return ($candidateId.Length -gt $bestId.Length) }
  $candidateHasMemory = ($null -ne $Candidate.QwMemorySize -and [int64]$Candidate.QwMemorySize -gt 0)
  $bestHasMemory = ($null -ne $Best.QwMemorySize -and [int64]$Best.QwMemorySize -gt 0)
  if ($candidateHasMemory -ne $bestHasMemory) { return $candidateHasMemory }
  return ((Get-McSubkeyNumber $Candidate.Subkey) -gt (Get-McSubkeyNumber $Best.Subkey))
}

function Select-McRegistryEntry {
  # Longest MatchingDeviceId that is a case-insensitive prefix of PNPDeviceID, else DriverDesc = Name;
  # equal matches are settled by Test-McPreferredRegistryEntry so a stale subkey never shadows the live one.
  param($Controller, $RegistryEntries)
  $pnpUpper = ([string]$Controller.PNPDeviceID).ToUpperInvariant()
  $best = $null
  foreach ($entry in @($RegistryEntries)) {
    if ($null -eq $entry) { continue }
    $id = [string]$entry.MatchingDeviceId
    if ($id -ne '' -and $pnpUpper.StartsWith($id.ToUpperInvariant())) {
      if (Test-McPreferredRegistryEntry -Candidate $entry -Best $best) { $best = $entry }
    }
  }
  if ($null -ne $best) { return $best }
  $byName = $null
  foreach ($entry in @($RegistryEntries)) {
    if ($null -eq $entry) { continue }
    $desc = [string]$entry.DriverDesc
    if ($desc -ne '' -and $desc.Equals([string]$Controller.Name, [System.StringComparison]::OrdinalIgnoreCase)) {
      if (Test-McPreferredRegistryEntry -Candidate $entry -Best $byName) { $byName = $entry }
    }
  }
  return $byName
}

function Merge-McGpuInventory {
  # CIM controllers joined with the display-class registry: the REG_QWORD is the VRAM (AdapterRAM
  # is a uint32 that wraps above 4 GiB); form and memory say integrated/shared or discrete/dedicated.
  param($Controllers, $RegistryEntries)
  $gpus = New-Object System.Collections.ArrayList
  $ignored = New-Object System.Collections.ArrayList
  foreach ($controller in @($Controllers)) {
    if ($null -eq $controller) { continue }
    if (Test-McIgnoredController $controller) {
      [void]$ignored.Add([string]$controller.Name)
      continue
    }
    $vendorId = Get-McVendorId ([string]$controller.PNPDeviceID)
    $vendor = Get-McVendor $vendorId ([string]$controller.AdapterCompatibility)
    $form = Get-McGpuForm $vendor ([string]$controller.Name)
    $reg = Select-McRegistryEntry $controller $RegistryEntries
    $adapterRam = ConvertTo-McInt64 $controller.AdapterRAM
    if ($null -eq $adapterRam) { $adapterRam = [int64]0 }
    $regBytes = $null
    if ($null -ne $reg) { $regBytes = $reg.QwMemorySize }
    $vram = [int64]0
    $source = 'none'
    if ($null -ne $regBytes -and $regBytes -gt 0) {
      $vram = [int64]$regBytes
      $source = 'registry'
    } elseif ($adapterRam -gt 0) {
      $vram = $adapterRam
      $source = 'cim'
    }
    $wrapped = ($adapterRam -eq 4293918720) -or ($null -ne $regBytes -and $adapterRam -lt $regBytes)
    $memory = 'unknown'
    if ($form -eq 'integrated') { $memory = 'shared' } elseif ($form -eq 'discrete') { $memory = 'dedicated' }
    $compute = $null
    if ($vendor -eq 'nvidia') { $compute = 'cuda' } elseif ($vendor -eq 'amd' -or $vendor -eq 'intel') { $compute = 'vulkan' }
    $driver = [string]$controller.DriverVersion
    if ($driver -eq '' -and $null -ne $reg) { $driver = [string]$reg.DriverVersion }
    $subkey = $null
    if ($null -ne $reg) { $subkey = $reg.Subkey }
    [void]$gpus.Add([pscustomobject]@{
      Name = [string]$controller.Name
      Vendor = $vendor
      VendorId = $vendorId
      Form = $form
      Memory = $memory
      VramBytes = $vram
      VramSource = $source
      AdapterRamBytes = $adapterRam
      AdapterRamWrapped = [bool]$wrapped
      DriverVersion = $driver
      PnpDeviceId = [string]$controller.PNPDeviceID
      Compute = $compute
      RegistrySubkey = $subkey
    })
  }
  return [pscustomobject]@{ Gpus = @($gpus.ToArray()); Ignored = @($ignored.ToArray()) }
}

function Select-McPrimaryGpu {
  # The discrete adapter when one is present (the largest), else the integrated one.
  param($Gpus)
  $list = @($Gpus) | Where-Object { $null -ne $_ }
  $discrete = @($list | Where-Object { $_.Form -eq 'discrete' } | Sort-Object -Property VramBytes -Descending)
  if ($discrete.Count -gt 0) { return $discrete[0] }
  $integrated = @($list | Where-Object { $_.Form -eq 'integrated' })
  if ($integrated.Count -gt 0) { return $integrated[0] }
  $any = @($list)
  if ($any.Count -gt 0) { return $any[0] }
  return $null
}

function Get-McModelTier {
  # A: discrete >= 12 GiB; B: discrete 6..12 GiB; C: integrated with >= 8 GB free RAM at install; D: the rest.
  # Owner decision 2026-11-17 (headroom first): on a shared-memory box the free memory at install decides
  # between the 8B and the 4B vision model, and nothing bigger than 8B is ever resident there.
  param($Gpu, [int64]$FreePhysicalMemoryBytes)
  if ($null -ne $Gpu -and $Gpu.Form -eq 'discrete') {
    if ([int64]$Gpu.VramBytes -ge 12 * $script:McGiB) { return 'A' }
    if ([int64]$Gpu.VramBytes -ge 6 * $script:McGiB) { return 'B' }
    return 'D'
  }
  if ($null -ne $Gpu -and $Gpu.Form -eq 'integrated' -and $FreePhysicalMemoryBytes -ge $script:McIntegratedResidentFreeBytes) { return 'C' }
  return 'D'
}

function Get-McImplementationModelMap {
  # Implementation id -> Ollama model, as core/node-manifests/owner-windows-gpu.json names them.
  $map = [ordered]@{}
  $map[$script:McVisionImplementation] = $script:McVisionModel
  $map[$script:McTwinImplementation] = $script:McTwinModel
  $map[$script:McBiggerImplementation] = $script:McBiggerModel
  $map[$script:McSmallVisionImplementation] = $script:McSmallVisionModel
  return $map
}

function New-McTierSettings {
  param([string]$Tier, [string]$ResidentModel, [string[]]$Implementations, [int]$Context, [string]$Description)
  $map = Get-McImplementationModelMap
  $pairs = New-Object System.Collections.Generic.List[string]
  $pull = New-Object System.Collections.Generic.List[string]
  foreach ($id in $Implementations) {
    $pairs.Add(('{0}={1}' -f $id, $map[$id]))
    if (-not $pull.Contains([string]$map[$id])) { $pull.Add([string]$map[$id]) }
  }
  return [pscustomobject]@{
    Tier = $Tier
    ResidentModel = $ResidentModel
    # MCCLUSTER_OLLAMA_RESIDENT_MODELS stays empty: the adapter keeps exactly its default model resident.
    ResidentModels = ''
    Implementations = @($Implementations)
    ImplementationMap = ($pairs -join ',')
    PullModels = @($pull.ToArray())
    Context = $Context
    KeepAlive = '24h'
    OnDemandKeepAlive = '5m'
    BenchmarkModel = $ResidentModel
    Description = $Description
  }
}

function Get-McTierSettings {
  # One resident model on every tier: the vision model the adapter keeps loaded as its default model (vision,
  # tools and thinking; the agent model of the next slice). Every other model is on demand with a short
  # keep-alive. qwen3:14b exists on tier A only (owner decision 2026-11-17: no 12B/14B model on a
  # shared-memory machine); the twin of the OVH node's implementation, qwen3:8b, is on demand on A, B and C.
  param([string]$Tier)
  $vision = $script:McVisionModel
  $twin = $script:McTwinModel
  switch ([string]$Tier) {
    'A' { return (New-McTierSettings -Tier 'A' -ResidentModel $vision -Implementations @($script:McVisionImplementation, $script:McTwinImplementation, $script:McBiggerImplementation) -Context 16384 -Description ('{0} resident (the adapter default), {1} and {2} on demand, three entries advertised, context 16384' -f $vision, $twin, $script:McBiggerModel)) }
    'B' { return (New-McTierSettings -Tier 'B' -ResidentModel $vision -Implementations @($script:McVisionImplementation, $script:McTwinImplementation) -Context 16384 -Description ('{0} resident, {1} on demand, two entries advertised, context 16384' -f $vision, $twin)) }
    'C' { return (New-McTierSettings -Tier 'C' -ResidentModel $vision -Implementations @($script:McVisionImplementation, $script:McTwinImplementation) -Context 8192 -Description ('{0} resident on shared memory, {1} on demand with a 5m keep-alive (not advertised when -Benchmark -Model {1} leaves under 4 GB free), context 8192' -f $vision, $twin)) }
  }
  return (New-McTierSettings -Tier 'D' -ResidentModel $script:McSmallVisionModel -Implementations @($script:McSmallVisionImplementation) -Context 8192 -Description ('{0} resident (the smaller vision model for a box with little free memory), nothing on demand, context 8192' -f $script:McSmallVisionModel))
}

function Get-McLowerTier {
  # Where a refused tier goes: the smaller vision model; D has no lower tier.
  param([string]$Tier)
  if ($Tier -eq 'D') { return $null }
  return 'D'
}

function Test-McModelAllowedOnTier {
  # qwen3:14b is tier A only (a discrete card with 12 GiB or more); owner decision 2026-11-17.
  param([string]$ModelName, [string]$Tier)
  if ($ModelName -eq $script:McBiggerModel -and $Tier -ne 'A') { return $false }
  return $true
}

function Get-McHeadroomVerdict {
  # The owner's rule (2026-11-17): a tier whose resident model leaves the machine under ~4 GB free is refused;
  # an on-demand model that would is not advertised. Unknown free memory gives no verdict.
  param([string]$Tier, [string]$ModelName, $FreeAfterBytes, $Settings)
  $free = ConvertTo-McInt64 $FreeAfterBytes
  $floor = Format-McBytes $script:McHeadroomFloorBytes
  $role = 'other'
  if ($ModelName -eq [string]$Settings.ResidentModel) { $role = 'resident' }
  elseif ($ModelName -eq $script:McTwinModel -and (@($Settings.Implementations) -contains $script:McTwinImplementation)) { $role = 'twin' }
  if ($null -eq $free) { return [pscustomobject]@{ Role = $role; Fits = $null; Action = 'none'; NextTier = $null; Reason = 'free memory unknown: no verdict, nothing changed' } }
  $fits = ($free -ge $script:McHeadroomFloorBytes)
  if ($role -eq 'resident') {
    if ($fits) { return [pscustomobject]@{ Role = $role; Fits = $true; Action = 'none'; NextTier = $null; Reason = ('{0} loaded leaves {1} free, above the {2} floor: tier {3} stands' -f $ModelName, (Format-McBytes $free), $floor, $Tier) } }
    $next = Get-McLowerTier $Tier
    $advice = 'no lower tier is left: this machine cannot keep a resident model with 4 GB of headroom'
    if ($next) { $advice = ('re-run -Install -Tier {0}' -f $next) }
    return [pscustomobject]@{ Role = $role; Fits = $false; Action = 'refuse'; NextTier = $next; Reason = ('{0} loaded leaves only {1} free, under the {2} floor: tier {3} is refused; {4}' -f $ModelName, (Format-McBytes $free), $floor, $Tier, $advice) }
  }
  if ($role -eq 'twin') {
    if ($fits) { return [pscustomobject]@{ Role = $role; Fits = $true; Action = 'advertise'; NextTier = $null; Reason = ('{0} on demand leaves {1} free: {2} is advertised' -f $ModelName, (Format-McBytes $free), $script:McTwinImplementation) } }
    return [pscustomobject]@{ Role = $role; Fits = $false; Action = 'prune'; NextTier = $null; Reason = ('{0} on demand leaves only {1} free, under the {2} floor: {3} is not advertised' -f $ModelName, (Format-McBytes $free), $floor, $script:McTwinImplementation) }
  }
  return [pscustomobject]@{ Role = $role; Fits = $fits; Action = 'none'; NextTier = $null; Reason = ('{0} loaded leaves {1} free; it is not one of this tier''s models, nothing changed' -f $ModelName, (Format-McBytes $free)) }
}

function Get-McTierDecision {
  param($Gpu, [int64]$FreePhysicalMemoryBytes, [string]$Override)
  $tier = Get-McModelTier -Gpu $Gpu -FreePhysicalMemoryBytes $FreePhysicalMemoryBytes
  $gpuName = 'no GPU'
  $form = 'none'
  $vram = 'VRAM 0'
  if ($null -ne $Gpu) {
    $gpuName = [string]$Gpu.Name
    $form = [string]$Gpu.Form
    $vram = 'VRAM ' + (Format-McBytes $Gpu.VramBytes)
    if ($Gpu.Memory -eq 'shared') { $vram = $vram + ' (shared memory carve-out)' }
  }
  $reason = '{0}, {1}, {2}, free RAM {3}' -f $gpuName, $form, $vram, (Format-McBytes $FreePhysicalMemoryBytes)
  if ($Override) {
    $reason = $reason + ('; rule says Tier {0}; owner override' -f $tier)
    $tier = $Override
  }
  $settings = Get-McTierSettings $tier
  return [pscustomobject]@{ Tier = $tier; Reason = $reason; Settings = $settings; Gpu = $Gpu; FreePhysicalMemoryBytes = $FreePhysicalMemoryBytes }
}

function Get-McNodeEnvironment {
  # The non-secret MCCLUSTER_* and OLLAMA_* configuration: user-scope variables and the launchers.
  param($Settings, [string]$StateRoot, [string]$NodeName, [string]$OrgId, [string]$ComputeUrl)
  $values = [ordered]@{}
  $values['MCCLUSTER_COMPUTE_URL'] = $ComputeUrl
  $values['MCCLUSTER_ORG_ID'] = $OrgId
  $values['MCCLUSTER_NODE_NAME'] = $NodeName
  $values['MCCLUSTER_NODE_STATE_DIR'] = $StateRoot
  $values['MCCLUSTER_NODE_MANIFEST'] = [System.IO.Path]::Combine($StateRoot, 'capabilities.json')
  # 1000 ms is the agent's floor and the Tier-1 preference lever: the laptop reaches the claim before the OVH node's 5000 ms poll.
  $values['MCCLUSTER_NODE_POLL_MS'] = '1000'
  $values['MCCLUSTER_NODE_HEARTBEAT_MS'] = '30000'
  $values['MCCLUSTER_NODE_ENGINE_PROBE_MS'] = '15000'
  $values['MCCLUSTER_OLLAMA_URL'] = $script:McOllamaUrl
  # The adapter's default model is the one resident model; the map names the on-demand ones beside it.
  $values['MCCLUSTER_OLLAMA_MODEL'] = [string]$Settings.ResidentModel
  $values['MCCLUSTER_OLLAMA_IMPLEMENTATIONS'] = [string]$Settings.ImplementationMap
  $values['MCCLUSTER_OLLAMA_RESIDENT_MODELS'] = [string]$Settings.ResidentModels
  $values['MCCLUSTER_OLLAMA_ON_DEMAND_KEEP_ALIVE'] = [string]$Settings.OnDemandKeepAlive
  $values['MCCLUSTER_OLLAMA_CONTEXT'] = [string]$Settings.Context
  $values['MCCLUSTER_OLLAMA_KEEP_ALIVE'] = [string]$Settings.KeepAlive
  $values['MCCLUSTER_OLLAMA_WARM_ON_START'] = 'true'
  $values['MCCLUSTER_OLLAMA_ADAPTER_PORT'] = [string]$script:McAdapterPort
  $values['OLLAMA_KEEP_ALIVE'] = [string]$Settings.KeepAlive
  # Never MCCLUSTER_OLLAMA_NUM_THREAD on a GPU tier: the CPU thread cap is the OVH node's tuning.
  return $values
}

function Test-McNodeName {
  # The display name goes into the launchers and to the Core: letters, digits, dots, hyphens, underscores.
  param([string]$Name)
  return ([string]$Name -match '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')
}

function Test-McLauncherSafeValue {
  # Everything written into the cmd launchers must be inert for cmd.exe: no metacharacter, no control
  # character, no leading or trailing space (a trailing space would become part of the value).
  param([string]$Value)
  $v = [string]$Value
  if ($v -ne $v.Trim()) { return $false }
  if ($v -match $script:McLauncherUnsafePattern) { return $false }
  if ($v -match '[\x00-\x1F\x7F]') { return $false }
  return $true
}

function Assert-McLauncherValues {
  # -Install refuses owner arguments that cmd.exe would read as commands or redirections when the scheduled
  # task runs the launcher at every boot.
  param([string]$NodeName, [string]$StateRoot, [string]$RepoPath, [string]$ComputeUrl)
  if (-not (Test-McNodeName $NodeName)) { throw ('-NodeName must be 1 to 64 letters, digits, dots, hyphens or underscores (got "{0}")' -f $NodeName) }
  foreach ($pair in @(@('-StateRoot', $StateRoot), @('-RepoPath', $RepoPath), @('-ComputeUrl', $ComputeUrl))) {
    if (-not (Test-McLauncherSafeValue ([string]$pair[1]))) { throw ('{0} must not contain & | < > ^ " % ! or control characters, or start or end with a space: it is written into the cmd launchers (got "{1}")' -f $pair[0], $pair[1]) }
  }
}

function Get-McLauncherText {
  # <StateRoot>\adapter.cmd / agent.cmd / browser.cmd: a startup task without an interactive logon does
  # not load HKCU, so the launcher carries the non-secret configuration itself. Every value is checked
  # again here: a cmd metacharacter never reaches a file that cmd.exe runs.
  param([string]$Kind, $Environment, [string]$RepoPath, [string]$StateRoot)
  foreach ($path in @($RepoPath, $StateRoot)) {
    if (-not (Test-McLauncherSafeValue $path)) { throw ('launcher path "{0}" contains a cmd metacharacter or an edge space; refusing to write the launcher' -f $path) }
  }
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add('@echo off')
  $lines.Add('rem Generated by core\windows\mccluster-node.ps1 -Install. Non-secret configuration only; re-run -Install to regenerate.')
  foreach ($key in $Environment.Keys) {
    $value = [string]$Environment[$key]
    if (-not (Test-McLauncherSafeValue ([string]$key)) -or -not (Test-McLauncherSafeValue $value)) { throw ('launcher value for {0} contains a cmd metacharacter or an edge space; refusing to write the launcher' -f $key) }
    $lines.Add(('set {0}={1}' -f $key, $value))
  }
  $lines.Add(('cd /d "{0}"' -f [System.IO.Path]::Combine($RepoPath, 'core')))
  $logName = '{0}.log' -f $Kind
  $log = [System.IO.Path]::Combine($StateRoot, 'logs', $logName)
  $source = 'src\compute\node-agent.mjs'
  if ($Kind -eq 'adapter') { $source = 'src\compute\ollama-adapter.mjs' }
  elseif ($Kind -eq 'browser') { $source = 'src\compute\browser-executor.mjs' }
  $lines.Add(('node {0} >> "{1}" 2>&1' -f $source, $log))
  return (($lines -join "`r`n") + "`r`n")
}

function Get-McTemplatePath {
  param([string]$RepoPath)
  return [System.IO.Path]::Combine($RepoPath, $script:McTemplateSegments[0], $script:McTemplateSegments[1], $script:McTemplateSegments[2])
}

function ConvertTo-McManifestJson {
  # The template pruned to the tier's implementations, plus the ones -Install must keep beside them (the
  # browser.act/chromium.local entry once -Browser installed the executor); no other edit.
  param([string]$TemplateJson, $Settings, [string[]]$ExtraImplementations = @())
  $manifest = $TemplateJson | ConvertFrom-Json
  $keep = @($manifest.capabilities | Where-Object { ($Settings.Implementations -contains $_.implementation) -or ($ExtraImplementations -contains $_.implementation) })
  $manifest.capabilities = $keep
  return ($manifest | ConvertTo-Json -Depth 32)
}

function Add-McManifestImplementation {
  # Puts one template entry back into a written capabilities.json (the on-demand twin once -Benchmark finds headroom).
  param([string]$ManifestJson, [string]$TemplateJson, [string]$Implementation)
  $manifest = $ManifestJson | ConvertFrom-Json
  $present = @($manifest.capabilities | Where-Object { $_.implementation -eq $Implementation })
  if ($present.Count -gt 0) { return $ManifestJson }
  $template = $TemplateJson | ConvertFrom-Json
  $entry = @($template.capabilities | Where-Object { $_.implementation -eq $Implementation })
  if ($entry.Count -eq 0) { throw ('the template has no entry for {0}' -f $Implementation) }
  $manifest.capabilities = @($manifest.capabilities) + @($entry[0])
  return ($manifest | ConvertTo-Json -Depth 32)
}

function Remove-McManifestImplementation {
  # Takes one entry out of a written capabilities.json (the on-demand twin when it leaves too little free
  # memory); unchanged text when the entry is not there.
  param([string]$ManifestJson, [string]$Implementation)
  $manifest = $ManifestJson | ConvertFrom-Json
  $all = @($manifest.capabilities)
  $keep = @($all | Where-Object { $_.implementation -ne $Implementation })
  if ($keep.Count -eq $all.Count) { return $ManifestJson }
  $manifest.capabilities = $keep
  return ($manifest | ConvertTo-Json -Depth 32)
}

# ---- the node's own browser (slice N2): paths, policy, environment, report lines -------------
function Get-McBrowserDir {
  param([string]$StateRoot)
  return [System.IO.Path]::Combine($StateRoot, 'browser')
}

function Get-McBrowserProfileDir {
  param([string]$StateRoot)
  return [System.IO.Path]::Combine($StateRoot, 'browser-profile')
}

function Get-McBrowserPolicyPath {
  param([string]$StateRoot)
  return [System.IO.Path]::Combine($StateRoot, 'browser-policy.json')
}

function Get-McPlaywrightDir {
  # Where npm lands the pinned package: <StateRoot>\browser\node_modules\playwright.
  param([string]$StateRoot)
  return [System.IO.Path]::Combine((Get-McBrowserDir $StateRoot), 'node_modules', 'playwright')
}

function Get-McPlaywrightBrowsersPath {
  # PLAYWRIGHT_BROWSERS_PATH: Chromium stays under the state root, never under the user profile.
  param([string]$StateRoot)
  return [System.IO.Path]::Combine((Get-McBrowserDir $StateRoot), 'ms-playwright')
}

function Get-McBrowserPolicyText {
  # The policy -Browser writes once and never overwrites: no site is allowed until the owner names some.
  $policy = [ordered]@{ schema = $script:McBrowserPolicySchema; allowed_hosts = @(); allow_subdomains = $false }
  return (($policy | ConvertTo-Json -Depth 4) + "`r`n")
}

function ConvertFrom-McBrowserPolicy {
  # The policy file's shape for -Report: how many hosts and the subdomain rule, never the hosts themselves
  # (the pasteable block names no site the owner uses).
  param([string]$Text)
  if ($null -eq $Text -or [string]$Text -eq '') { return [pscustomobject]@{ Present = $false; HostCount = 0; AllowSubdomains = $false; Error = 'absent'; Summary = 'absent (run -Browser, then edit allowed_hosts)' } }
  $policy = $null
  try { $policy = $Text | ConvertFrom-Json } catch { return [pscustomobject]@{ Present = $true; HostCount = 0; AllowSubdomains = $false; Error = 'invalid_json'; Summary = 'unreadable (invalid JSON)' } }
  if ([string]$policy.schema -ne $script:McBrowserPolicySchema) { return [pscustomobject]@{ Present = $true; HostCount = 0; AllowSubdomains = $false; Error = 'schema_mismatch'; Summary = ('unreadable (schema is not {0})' -f $script:McBrowserPolicySchema) } }
  $hosts = @($policy.allowed_hosts | Where-Object { $null -ne $_ -and [string]$_ -ne '' })
  $subdomains = ($policy.allow_subdomains -eq $true)
  $note = ''
  if ($hosts.Count -eq 0) { $note = ' (empty: every open is refused with BROWSER_POLICY_EMPTY)' }
  return [pscustomobject]@{ Present = $true; HostCount = $hosts.Count; AllowSubdomains = $subdomains; Error = $null; Summary = ('allowed_hosts {0}, allow_subdomains {1}{2}' -f $hosts.Count, $subdomains.ToString().ToLowerInvariant(), $note) }
}

function Get-McBrowserEnvironment {
  # The browser executor's non-secret configuration (browser.cmd carries it; -BrowserHeaded adds
  # MCCLUSTER_BROWSER_HEADED=1 for the console run). The port is fixed; the paths are under the state root.
  param([string]$StateRoot)
  $values = [ordered]@{}
  $values['MCCLUSTER_BROWSER_EXECUTOR_PORT'] = [string]$script:McBrowserPort
  $values['MCCLUSTER_BROWSER_PROFILE_DIR'] = Get-McBrowserProfileDir $StateRoot
  $values['MCCLUSTER_BROWSER_POLICY'] = Get-McBrowserPolicyPath $StateRoot
  $values['MCCLUSTER_BROWSER_PLAYWRIGHT_DIR'] = Get-McPlaywrightDir $StateRoot
  $values['PLAYWRIGHT_BROWSERS_PATH'] = Get-McPlaywrightBrowsersPath $StateRoot
  $values['MCCLUSTER_NODE_MANIFEST'] = Get-McManifestPath $StateRoot
  return $values
}

function Get-McPlaywrightInstalledVersion {
  # The version npm landed under the state root (its package.json), or $null when nothing is installed.
  param([string]$StateRoot)
  $text = Read-McTextFile ([System.IO.Path]::Combine((Get-McPlaywrightDir $StateRoot), 'package.json'))
  if ($null -eq $text) { return $null }
  try { return [string](($text | ConvertFrom-Json).version) } catch { return $null }
}

function Format-McBrowserReportLines {
  # The BROWSER block of -Report: the task, what -Browser installed, the policy's shape (never its hosts),
  # and what the executor itself answers on loopback. Pure over its arguments; the tests call it directly.
  param([string]$StateRoot, [string]$TaskState, $Health, $Ready)
  $lines = New-Object System.Collections.Generic.List[string]
  $taskText = 'absent'
  if ([string]$TaskState -ne '') { $taskText = [string]$TaskState }
  $lines.Add(('  task {0}: {1}' -f $script:McBrowserTaskName, $taskText))
  $version = Get-McPlaywrightInstalledVersion $StateRoot
  if ($null -eq $version) { $lines.Add(('  playwright: not installed under {0} (run -Browser)' -f (Get-McBrowserDir $StateRoot))) }
  else { $lines.Add(('  playwright: {0} under {1}' -f $version, (Get-McBrowserDir $StateRoot))) }
  $store = 'absent'
  if (Test-Path -LiteralPath (Get-McPlaywrightBrowsersPath $StateRoot)) { $store = 'present' }
  $lines.Add(('  ms-playwright (Chromium store): {0}' -f $store))
  $profile = 'absent'
  if (Test-Path -LiteralPath (Get-McBrowserProfileDir $StateRoot)) { $profile = 'present' }
  $lines.Add(('  browser-profile: {0}' -f $profile))
  $policy = ConvertFrom-McBrowserPolicy -Text (Read-McTextFile (Get-McBrowserPolicyPath $StateRoot))
  $lines.Add(('  browser-policy.json: {0}' -f $policy.Summary))
  if ($null -eq $Health) { $lines.Add(('  executor {0}/health: not answering' -f $script:McBrowserUrl)) }
  else {
    $lastError = 'none'
    if ([string]$Health.last_error -ne '') { $lastError = Get-McMaskedText ([string]$Health.last_error) }
    $lines.Add(('  executor {0}/health: ok {1}, busy {2}, playwright found {3}, policy hosts {4}, last_error {5}' -f $script:McBrowserUrl, $Health.ok, $Health.busy, $Health.playwright.found, $Health.policy.allowed_hosts_count, $lastError))
  }
  if ($null -eq $Ready) { $lines.Add(('  executor {0}/ready: not ready (503 or not answering)' -f $script:McBrowserUrl)) }
  else { $lines.Add(('  executor {0}/ready: ready, chromium {1}' -f $script:McBrowserUrl, $Ready.chromium_version)) }
  return @($lines.ToArray())
}

function Get-McMaskedText {
  # The pasteable report: user profile path, computer name and user name are masked.
  param([string]$Text)
  $result = [string]$Text
  $pairs = @(
    @($env:USERPROFILE, '%USERPROFILE%'),
    @($env:COMPUTERNAME, '<host>'),
    @($env:USERNAME, '<user>')
  )
  foreach ($pair in $pairs) {
    $needle = [string]$pair[0]
    if ($needle.Length -ge 2) { $result = $result -replace [regex]::Escape($needle), $pair[1] }
  }
  return $result
}

function Get-McReportValueAllowlist {
  # The MCCLUSTER_* names whose values -Report may print: exactly the non-secret ones -Install writes
  # (Get-McNodeEnvironment) plus the agent's hardware refresh cadence. MCCLUSTER_ORG_ID is not here: it is masked.
  return @(
    'MCCLUSTER_COMPUTE_URL', 'MCCLUSTER_NODE_NAME', 'MCCLUSTER_NODE_STATE_DIR', 'MCCLUSTER_NODE_MANIFEST',
    'MCCLUSTER_NODE_POLL_MS', 'MCCLUSTER_NODE_HEARTBEAT_MS', 'MCCLUSTER_NODE_ENGINE_PROBE_MS', 'MCCLUSTER_NODE_HARDWARE_REFRESH_MS',
    'MCCLUSTER_OLLAMA_URL', 'MCCLUSTER_OLLAMA_MODEL', 'MCCLUSTER_OLLAMA_IMPLEMENTATIONS', 'MCCLUSTER_OLLAMA_RESIDENT_MODELS',
    'MCCLUSTER_OLLAMA_ON_DEMAND_KEEP_ALIVE', 'MCCLUSTER_OLLAMA_CONTEXT', 'MCCLUSTER_OLLAMA_KEEP_ALIVE',
    'MCCLUSTER_OLLAMA_WARM_ON_START', 'MCCLUSTER_OLLAMA_ADAPTER_PORT',
    'MCCLUSTER_BROWSER_EXECUTOR_PORT', 'MCCLUSTER_BROWSER_PROFILE_DIR', 'MCCLUSTER_BROWSER_POLICY', 'MCCLUSTER_BROWSER_PLAYWRIGHT_DIR',
    'MCCLUSTER_BROWSER_HEADED', 'MCCLUSTER_BROWSER_MAX_STEPS', 'MCCLUSTER_BROWSER_MAX_MS', 'MCCLUSTER_BROWSER_MAX_OUTPUT_BYTES'
  )
}

function Format-McEnvironmentLines {
  # MCCLUSTER_*, OLLAMA_*, GGML_VK_VISIBLE_DEVICES and PLAYWRIGHT_BROWSERS_PATH. A value is printed only for an
  # allowlisted MCCLUSTER_* name, OLLAMA_*, GGML_VK_VISIBLE_DEVICES and PLAYWRIGHT_BROWSERS_PATH (a path under
  # the state root); any name that says token, key, secret, password or credential
  # is shown as set/unset whatever its prefix (the ecosystem has MCCLUSTER_* secrets beyond the enrolment
  # token); MCCLUSTER_ORG_ID is shown as set (uuid); every other MCCLUSTER_* name as set/unset.
  param([hashtable]$Variables)
  $lines = New-Object System.Collections.Generic.List[string]
  $allow = Get-McReportValueAllowlist
  $names = @($Variables.Keys | Where-Object { $_ -like 'MCCLUSTER_*' -or $_ -like 'OLLAMA_*' -or $_ -eq 'GGML_VK_VISIBLE_DEVICES' -or $_ -eq 'PLAYWRIGHT_BROWSERS_PATH' } | Sort-Object)
  foreach ($name in $names) {
    $value = [string]$Variables[$name]
    $state = 'unset'
    if ($value -ne '') { $state = 'set' }
    if ($name -match $script:McSecretNamePattern) { $lines.Add(('  {0} = {1}' -f $name, $state)); continue }
    if ($name -eq 'MCCLUSTER_ORG_ID') {
      if ($value -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { $state = 'set (uuid)' }
      elseif ($value -ne '') { $state = 'set (not a uuid)' }
      $lines.Add(('  {0} = {1}' -f $name, $state))
      continue
    }
    if (($name -like 'MCCLUSTER_*') -and -not ($allow -contains $name)) { $lines.Add(('  {0} = {1}' -f $name, $state)); continue }
    $lines.Add(('  {0} = {1}' -f $name, $value))
  }
  if (-not $Variables.ContainsKey('MCCLUSTER_NODE_ENROLL_TOKEN')) { $lines.Add('  MCCLUSTER_NODE_ENROLL_TOKEN = unset') }
  if ($lines.Count -eq 0) { $lines.Add('  (none)') }
  return @($lines.ToArray())
}

function Test-McCandidatePartition {
  param($SizeBytes)
  $n = ConvertTo-McInt64 $SizeBytes
  if ($null -eq $n) { return $false }
  return ($n -ge $script:McCandidatePartitionMin -and $n -le $script:McCandidatePartitionMax)
}

function Test-McThinkModel {
  param([string]$ModelName)
  return ([string]$ModelName -match $script:McThinkModelPattern)
}

function Get-McProcessorGpuPercent {
  # From GET /api/ps: round(size_vram / size * 100) for the model (or the first loaded one).
  param($PsResponse, [string]$ModelName)
  if ($null -eq $PsResponse -or $null -eq $PsResponse.models) { return $null }
  foreach ($loaded in @($PsResponse.models)) {
    if ($null -eq $loaded) { continue }
    if ($ModelName -and ($loaded.name -ne $ModelName) -and ($loaded.model -ne $ModelName)) { continue }
    $size = ConvertTo-McInt64 $loaded.size
    $vram = ConvertTo-McInt64 $loaded.size_vram
    if ($null -eq $vram) { $vram = [int64]0 }
    if ($null -ne $size -and $size -gt 0) { return [int][math]::Round(100.0 * $vram / $size) }
  }
  return $null
}

function Get-McBenchmarkMetrics {
  # prompt tok/s = prompt_eval_count * 1e9 / prompt_eval_duration; generation likewise (2 decimals); the free
  # memory before and after the model loaded is kept beside them (the owner's headroom rule reads it).
  param($ChatResponse, $PsResponse, [string]$ModelName, $FreeMemoryBeforeBytes = $null, $FreeMemoryAfterBytes = $null)
  $promptCount = ConvertTo-McInt64 $ChatResponse.prompt_eval_count
  $promptNs = ConvertTo-McInt64 $ChatResponse.prompt_eval_duration
  $evalCount = ConvertTo-McInt64 $ChatResponse.eval_count
  $evalNs = ConvertTo-McInt64 $ChatResponse.eval_duration
  $generation = $null
  $prompt = $null
  if ($null -ne $evalCount -and $null -ne $evalNs -and $evalCount -gt 0 -and $evalNs -gt 0) { $generation = [math]::Round(($evalCount * 1e9) / $evalNs, 2) }
  if ($null -ne $promptCount -and $null -ne $promptNs -and $promptCount -gt 0 -and $promptNs -gt 0) { $prompt = [math]::Round(($promptCount * 1e9) / $promptNs, 2) }
  return [pscustomobject]@{
    model = $ModelName
    generation_tokens_per_second = $generation
    prompt_tokens_per_second = $prompt
    processor_gpu_percent = (Get-McProcessorGpuPercent -PsResponse $PsResponse -ModelName $ModelName)
    prompt_tokens = $promptCount
    generation_tokens = $evalCount
    free_memory_before_bytes = (ConvertTo-McInt64 $FreeMemoryBeforeBytes)
    free_memory_after_bytes = (ConvertTo-McInt64 $FreeMemoryAfterBytes)
  }
}

function Merge-McMeasuredInference {
  # measured-inference.json beside the manifest: one key per model, other models' entries kept.
  param([string]$ExistingJson, $Metrics, [string]$MeasuredAt, $NumCtx, $NumPredict, [string]$OllamaVersion, [string]$BackendNote)
  $measurements = [ordered]@{}
  if ([string]$ExistingJson -ne '') {
    try {
      $existing = $ExistingJson | ConvertFrom-Json
      if ($existing.schema -eq $script:McMeasuredSchema -and $null -ne $existing.measurements) {
        foreach ($prop in $existing.measurements.PSObject.Properties) { $measurements[$prop.Name] = $prop.Value }
      }
    } catch {
      $measurements = [ordered]@{}
    }
  }
  $note = $null
  if ([string]$BackendNote -ne '') { $note = ([string]$BackendNote).Substring(0, [math]::Min(120, ([string]$BackendNote).Length)) }
  $version = $null
  if ([string]$OllamaVersion -ne '') { $version = [string]$OllamaVersion }
  $measurements[[string]$Metrics.model] = [ordered]@{
    generation_tokens_per_second = $Metrics.generation_tokens_per_second
    prompt_tokens_per_second = $Metrics.prompt_tokens_per_second
    processor_gpu_percent = $Metrics.processor_gpu_percent
    measured_at = $MeasuredAt
    num_ctx = $NumCtx
    num_predict = $NumPredict
    prompt_tokens = $Metrics.prompt_tokens
    generation_tokens = $Metrics.generation_tokens
    ollama_version = $version
    backend_note = $note
    free_memory_before_bytes = $Metrics.free_memory_before_bytes
    free_memory_after_bytes = $Metrics.free_memory_after_bytes
  }
  $document = [ordered]@{ schema = $script:McMeasuredSchema; measurements = $measurements }
  return ($document | ConvertTo-Json -Depth 8)
}

function Get-McBackendNote {
  # Ollama's "inference compute" line (library, name, memory) from the tail of its server log.
  param([string[]]$LogLines)
  $hits = @($LogLines | Where-Object { $_ -match 'inference compute' })
  if ($hits.Count -eq 0) { return $null }
  $last = [string]$hits[$hits.Count - 1]
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($key in @('library', 'name', 'description', 'total', 'available')) {
    if ($last -match ('(?:^|\s)' + $key + '=("[^"]*"|\S+)')) { $parts.Add(('{0}={1}' -f $key, $matches[1].Trim('"'))) }
  }
  if ($parts.Count -eq 0) { return $last.Trim() }
  return ($parts -join ' ')
}

function Read-McTextFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return [System.IO.File]::ReadAllText($Path)
}

function Write-McAtomicFile {
  # .tmp beside the target, then Move-Item -Force: a reader sees the old or the new file, never half.
  param([string]$Path, [string]$Content)
  $directory = Split-Path -Parent $Path
  if ($directory -and -not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
  $temporary = $Path + '.tmp'
  [System.IO.File]::WriteAllText($temporary, $Content, (New-Object System.Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Write-McFileIfChanged {
  # Returns $true when the file was written, $false when it already matched (idempotence).
  param([string]$Path, [string]$Content)
  $existing = Read-McTextFile $Path
  if ($null -ne $existing -and $existing -ceq $Content) { return $false }
  Write-McAtomicFile -Path $Path -Content $Content
  return $true
}

function Get-McStateRoot {
  param([string]$Requested)
  if ($Requested) { return $Requested }
  $programData = $env:ProgramData
  if (-not $programData) { $programData = 'C:\ProgramData' }
  return [System.IO.Path]::Combine($programData, 'mccluster-node')
}

function Get-McNodeConfigPath {
  param([string]$StateRoot)
  return [System.IO.Path]::Combine($StateRoot, 'node.config.json')
}

function Get-McManifestPath {
  param([string]$StateRoot)
  return [System.IO.Path]::Combine($StateRoot, 'capabilities.json')
}

function Get-McMeasuredPath {
  param([string]$StateRoot)
  return [System.IO.Path]::Combine($StateRoot, 'measured-inference.json')
}

function Get-McEnrollFilePath {
  param([string]$StateRoot)
  return [System.IO.Path]::Combine($StateRoot, 'enroll.env')
}

# ---- contribution controls: paths, limits.json, the task settings they imply, the manifest's leases ----
function Get-McPausedPath {
  param([string]$StateRoot)
  return [System.IO.Path]::Combine($StateRoot, 'paused')
}

function Get-McLimitsPath {
  param([string]$StateRoot)
  return [System.IO.Path]::Combine($StateRoot, 'limits.json')
}

function Get-McRevokedPath {
  param([string]$StateRoot)
  return [System.IO.Path]::Combine($StateRoot, 'revoked.json')
}

function Get-McIdentityPath {
  param([string]$StateRoot)
  return [System.IO.Path]::Combine($StateRoot, 'identity.json')
}

function Get-McHeartbeatPath {
  param([string]$StateRoot)
  return [System.IO.Path]::Combine($StateRoot, 'last-heartbeat.json')
}

function New-McLimits {
  # The limits object -Limits writes: every limit explicit, unset ones null. -MaxConcurrency is 1..4;
  # -CpuBusyPercent 10..100 or 0 (unset); -BatteryFloorPercent 0..100 or -1 (unset); -ThermalLimitC > 0 or 0 (unset).
  param([bool]$IdleOnly = $false, [bool]$OnACOnly = $false, [int]$MaxConcurrency = 1, [int]$CpuBusyPercent = 0, [int]$BatteryFloorPercent = -1, [int]$ThermalLimitC = 0, [string]$WrittenAt)
  if ($MaxConcurrency -lt 1 -or $MaxConcurrency -gt $script:McMaxConcurrencyLimit) { throw ('-MaxConcurrency must be 1 to {0} (got {1})' -f $script:McMaxConcurrencyLimit, $MaxConcurrency) }
  if ($CpuBusyPercent -ne 0 -and ($CpuBusyPercent -lt 10 -or $CpuBusyPercent -gt 100)) { throw ('-CpuBusyPercent must be 10 to 100 (got {0})' -f $CpuBusyPercent) }
  if ($BatteryFloorPercent -ne -1 -and ($BatteryFloorPercent -lt 0 -or $BatteryFloorPercent -gt 100)) { throw ('-BatteryFloorPercent must be 0 to 100 (got {0})' -f $BatteryFloorPercent) }
  if ($ThermalLimitC -lt 0 -or $ThermalLimitC -gt 150) { throw ('-ThermalLimitC must be 0 (not set) or 1 to 150 (got {0})' -f $ThermalLimitC) }
  $cpu = $null
  if ($CpuBusyPercent -ne 0) { $cpu = $CpuBusyPercent }
  $battery = $null
  if ($BatteryFloorPercent -ne -1) { $battery = $BatteryFloorPercent }
  $thermal = $null
  if ($ThermalLimitC -ne 0) { $thermal = $ThermalLimitC }
  if (-not $WrittenAt) { $WrittenAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
  return [ordered]@{
    schema = $script:McLimitsSchema
    idle_only = $IdleOnly
    on_ac_only = $OnACOnly
    max_concurrency = $MaxConcurrency
    cpu_busy_percent = $cpu
    battery_floor_percent = $battery
    thermal_limit_c = $thermal
    written_at = $WrittenAt
  }
}

function ConvertTo-McLimitsJson {
  param($Limits)
  return (($Limits | ConvertTo-Json -Depth 4) + "`r`n")
}

function ConvertFrom-McLimits {
  # limits.json as the agent reads it: absent means the defaults; a broken or foreign file means the defaults
  # with an Error, never a wider limit.
  param([string]$Text)
  $defaults = [pscustomobject]@{ Present = $false; Error = $null; IdleOnly = $false; OnACOnly = $false; MaxConcurrency = 1; CpuBusyPercent = $null; BatteryFloorPercent = $null; ThermalLimitC = $null; WrittenAt = $null }
  if ($null -eq $Text -or ([string]$Text).Trim() -eq '') { return $defaults }
  $parsed = $null
  try { $parsed = $Text | ConvertFrom-Json } catch { $defaults.Present = $true; $defaults.Error = 'invalid_json'; return $defaults }
  if ($null -eq $parsed -or [string]$parsed.schema -ne $script:McLimitsSchema) { $defaults.Present = $true; $defaults.Error = 'schema_mismatch'; return $defaults }
  $max = ConvertTo-McInt64 $parsed.max_concurrency
  if ($null -eq $max -or $max -lt 1 -or $max -gt $script:McMaxConcurrencyLimit) { $max = 1 }
  $cpu = ConvertTo-McInt64 $parsed.cpu_busy_percent
  if ($null -ne $cpu -and ($cpu -lt 10 -or $cpu -gt 100)) { $cpu = $null }
  $battery = ConvertTo-McInt64 $parsed.battery_floor_percent
  if ($null -ne $battery -and ($battery -lt 0 -or $battery -gt 100)) { $battery = $null }
  $thermal = ConvertTo-McInt64 $parsed.thermal_limit_c
  if ($null -ne $thermal -and $thermal -le 0) { $thermal = $null }
  return [pscustomobject]@{
    Present = $true
    Error = $null
    IdleOnly = ($parsed.idle_only -eq $true)
    OnACOnly = ($parsed.on_ac_only -eq $true)
    MaxConcurrency = [int]$max
    CpuBusyPercent = $cpu
    BatteryFloorPercent = $battery
    ThermalLimitC = $thermal
    WrittenAt = [string]$parsed.written_at
  }
}

function Format-McLimitsSummary {
  # One line for -Report and the desktop: every limit named, unset ones said so, the thermal limit marked
  # "unsupported on this device" when no zone reading exists (never "off": the owner set it).
  param($Limits, $ThermalSupported = $null)
  if ($null -ne $Limits.Error) { return ('limits.json unreadable ({0}): the agent applies the defaults (no limit, max_concurrency 1)' -f $Limits.Error) }
  $parts = New-Object System.Collections.Generic.List[string]
  $parts.Add(('idle_only {0}' -f $Limits.IdleOnly.ToString().ToLowerInvariant()))
  $parts.Add(('on_ac_only {0}' -f $Limits.OnACOnly.ToString().ToLowerInvariant()))
  $parts.Add(('max_concurrency {0}' -f $Limits.MaxConcurrency))
  if ($null -ne $Limits.CpuBusyPercent) { $parts.Add(('cpu_busy_percent {0}' -f $Limits.CpuBusyPercent)) } else { $parts.Add('cpu_busy_percent not set') }
  if ($null -ne $Limits.BatteryFloorPercent) { $parts.Add(('battery_floor_percent {0}' -f $Limits.BatteryFloorPercent)) } else { $parts.Add('battery_floor_percent not set') }
  if ($null -ne $Limits.ThermalLimitC) {
    $note = ''
    if ($ThermalSupported -eq $false) { $note = ' (unsupported on this device: no thermal zone reading; the agent reports the limit as unsupported)' }
    $parts.Add(('thermal_limit_c {0}{1}' -f $Limits.ThermalLimitC, $note))
  } else { $parts.Add('thermal_limit_c not set') }
  $prefix = ''
  if (-not $Limits.Present) { $prefix = 'defaults (no limits.json): ' }
  return ($prefix + ($parts -join ', '))
}

function Get-McTaskSettingsPlan {
  # What the scheduled tasks' settings must say for the limits.
  # Idle-only: the adapter and the agent start only once Windows reports the device idle (RunOnlyIfIdle, after
  # IdleDurationMinutes of idle, waiting up to IdleWaitDays for it instead of Task Scheduler's 1 h default that
  # drops the start), are NOT stopped when the idle state ends (StopOnIdleEnd false: running work finishes, the
  # lease is kept) and carry RestartOnIdle. Because the two tasks outlive the idle state, their RunOnlyIfIdle
  # flag is not a live idle signal; a third task, "McCluster Node Idle" (IdleSentinel), is: Windows stops it
  # when the idle state ends and restarts it when idle resumes, and the agent's probe reads whether it runs.
  # AC-only: nothing at the task level. Task Scheduler evaluates "no start on battery" only when a trigger
  # fires (startup, logon), so a node that booted on battery would never start after being plugged in; the
  # tasks stay startable and running on battery and the agent's own gate refuses claims (on_battery /
  # power_unknown) while it keeps heartbeating.
  param($Limits)
  $idle = $false
  if ($null -ne $Limits) { $idle = ($Limits.IdleOnly -eq $true) }
  return [pscustomobject]@{
    RunOnlyIfIdle = $idle
    RestartOnIdle = $idle
    StopOnIdleEnd = $false
    IdleDurationMinutes = $script:McIdleDurationMinutes
    IdleWaitDays = $script:McIdleWaitDays
    IdleSentinel = $idle
    AllowStartIfOnBatteries = $true
    StopIfGoingOnBatteries = $false
  }
}

function Get-McTaskSettingsArguments {
  # The exact New-ScheduledTaskSettingsSet arguments for a plan (pure: the tests read this, and build a
  # settings object from it without registering anything). -Sentinel is the idle sentinel task: the one task
  # Windows must stop at idle end and restart when idle resumes (StopOnIdleEnd stays at its default, true).
  param($TaskSettings, [switch]$Sentinel, [switch]$NoRestartOnIdle)
  $arguments = @{ ExecutionTimeLimit = ([TimeSpan]::Zero); StartWhenAvailable = $true; MultipleInstances = 'IgnoreNew' }
  if ($Sentinel) {
    $arguments['AllowStartIfOnBatteries'] = $true
    $arguments['DontStopIfGoingOnBatteries'] = $true
    $arguments['RunOnlyIfIdle'] = $true
    $arguments['RestartOnIdle'] = $true
    $arguments['IdleDuration'] = (New-TimeSpan -Minutes ([int]$TaskSettings.IdleDurationMinutes))
    $arguments['IdleWaitTimeout'] = (New-TimeSpan -Days ([int]$TaskSettings.IdleWaitDays))
    return $arguments
  }
  $arguments['RestartCount'] = 3
  $arguments['RestartInterval'] = (New-TimeSpan -Minutes 1)
  if ($TaskSettings.AllowStartIfOnBatteries) { $arguments['AllowStartIfOnBatteries'] = $true }
  if (-not $TaskSettings.StopIfGoingOnBatteries) { $arguments['DontStopIfGoingOnBatteries'] = $true }
  if ($TaskSettings.RunOnlyIfIdle) {
    $arguments['RunOnlyIfIdle'] = $true
    if (-not $TaskSettings.StopOnIdleEnd) { $arguments['DontStopOnIdleEnd'] = $true }
    if ($TaskSettings.RestartOnIdle -and -not $NoRestartOnIdle) { $arguments['RestartOnIdle'] = $true }
    $arguments['IdleDuration'] = (New-TimeSpan -Minutes ([int]$TaskSettings.IdleDurationMinutes))
    $arguments['IdleWaitTimeout'] = (New-TimeSpan -Days ([int]$TaskSettings.IdleWaitDays))
  }
  return $arguments
}

function Format-McTaskSettingsPlan {
  # One line naming what the plan does to the tasks (-Install, -Limits and -WhatIf print it).
  param($TaskSettings)
  if (-not $TaskSettings.RunOnlyIfIdle) { return 'no idle condition, start and keep running on battery (on_ac_only is enforced by the agent''s claim gate, not by the tasks)' }
  return ('RunOnlyIfIdle after {0} min idle (wait up to {1} d), RestartOnIdle, not stopped at idle end, idle sentinel task "{2}", start and keep running on battery' -f $TaskSettings.IdleDurationMinutes, $TaskSettings.IdleWaitDays, $script:McIdleTaskName)
}

function Read-McLimitsTaskPlan {
  # The task plan for the limits.json already under the state root (absent or unreadable: the defaults).
  param([string]$StateRoot)
  $limits = ConvertFrom-McLimits -Text (Read-McTextFile (Get-McLimitsPath $StateRoot))
  return [pscustomobject]@{ Limits = $limits; Plan = (Get-McTaskSettingsPlan -Limits $limits) }
}

function Set-McManifestConcurrency {
  # max_leases and every entry's max_concurrency follow -MaxConcurrency; nothing else in capabilities.json moves.
  param([string]$ManifestJson, [int]$MaxConcurrency)
  if ($MaxConcurrency -lt 1 -or $MaxConcurrency -gt $script:McMaxConcurrencyLimit) { throw ('max_concurrency must be 1 to {0}' -f $script:McMaxConcurrencyLimit) }
  $manifest = $ManifestJson | ConvertFrom-Json
  $manifest | Add-Member -NotePropertyName 'max_leases' -NotePropertyValue $MaxConcurrency -Force
  foreach ($entry in @($manifest.capabilities)) {
    if ($null -eq $entry) { continue }
    if ($null -ne $entry.PSObject.Properties['max_concurrency']) { $entry.max_concurrency = $MaxConcurrency }
  }
  return ($manifest | ConvertTo-Json -Depth 32)
}

function Read-McIdentityNodeId {
  # The node id alone from identity.json; the key material is never read into a variable that is printed.
  param([string]$StateRoot)
  $text = Read-McTextFile (Get-McIdentityPath $StateRoot)
  if ($null -eq $text) { return $null }
  try {
    $identity = $text | ConvertFrom-Json
    $nodeId = [string]$identity.nodeId
    if ($nodeId -eq '') { return $null }
    return $nodeId
  } catch { return $null }
}

function ConvertTo-McRevokedJson {
  param([string]$NodeId, [string]$RevokedAt)
  $record = [ordered]@{ schema = $script:McRevokedSchema; node_id = $NodeId; revoked_at = $RevokedAt; next = 'revoke this node id on the Core (the owner tool in #821; direct SQL until then)' }
  return (($record | ConvertTo-Json -Depth 4) + "`r`n")
}

function Format-McReportTimestamp {
  param($Value)
  # PowerShell can deserialize an ISO JSON timestamp to a DateTime. Keep report times unambiguous.
  if ($Value -is [datetime]) {
    return $Value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.FFFFFFF'Z'", [Globalization.CultureInfo]::InvariantCulture)
  }
  return [string]$Value
}

function Format-McContributionReportLines {
  # The CONTRIBUTION block of -Report: paused, the limits as the agent reads them, thermal_supported, the
  # revocation record and the last heartbeat the agent wrote. Pure over its arguments; never a key or token.
  param([string]$StateRoot, $ThermalReading = $null)
  $lines = New-Object System.Collections.Generic.List[string]
  $paused = 'no'
  if (Test-Path -LiteralPath (Get-McPausedPath $StateRoot)) { $paused = 'yes (marker present: the agent claims nothing)' }
  $lines.Add(('  paused: {0}' -f $paused))
  $thermalSupported = ($null -ne $ThermalReading)
  $limits = ConvertFrom-McLimits -Text (Read-McTextFile (Get-McLimitsPath $StateRoot))
  $lines.Add(('  limits: {0}' -f (Format-McLimitsSummary -Limits $limits -ThermalSupported $thermalSupported)))
  if ($thermalSupported) { $lines.Add(('  thermal_supported: yes (hottest zone {0} C)' -f $ThermalReading)) }
  else { $lines.Add('  thermal_supported: no (MSAcpi_ThermalZoneTemperature not readable here; a thermal limit is reported as unsupported)') }
  $revokedText = Read-McTextFile (Get-McRevokedPath $StateRoot)
  if ($null -ne $revokedText) {
    $revokedLine = 'revoked.json: present (unreadable)'
    try { $revoked = $revokedText | ConvertFrom-Json; $revokedLine = ('revoked.json: node {0} revoked locally at {1}; revoke it on the Core too' -f $revoked.node_id, (Format-McReportTimestamp $revoked.revoked_at)) } catch { }
    $lines.Add('  ' + $revokedLine)
  } else { $lines.Add('  revoked.json: absent') }
  $heartbeatText = Read-McTextFile (Get-McHeartbeatPath $StateRoot)
  if ($null -ne $heartbeatText) {
    $heartbeatLine = 'last-heartbeat.json: present (unreadable)'
    try {
      $heartbeat = $heartbeatText | ConvertFrom-Json
      $gate = ''
      if ($null -ne $heartbeat.labels -and $null -ne $heartbeat.labels.claim_gate) { $gate = ('; claim_gate {0}' -f $heartbeat.labels.claim_gate) }
      $heartbeatLine = ('last-heartbeat.json: node {0} at {1}, agent {2}, {3} advertised{4}' -f $heartbeat.node_id, (Format-McReportTimestamp $heartbeat.at), $heartbeat.agent_version, $heartbeat.advertised, $gate)
    } catch { }
    $lines.Add('  ' + $heartbeatLine)
  } else { $lines.Add('  last-heartbeat.json: absent (no heartbeat accepted yet from this state root)') }
  return @($lines.ToArray())
}

function Get-McInstalledVariableNames {
  # The user-scope names -Install writes and -Uninstall clears (never any other name on the machine).
  $settings = Get-McTierSettings 'D'
  $values = Get-McNodeEnvironment -Settings $settings -StateRoot 'STATE' -NodeName 'x' -OrgId 'x' -ComputeUrl 'https://compute.mccluster.org'
  return @($values.Keys)
}

function Read-McNodeConfig {
  param([string]$StateRoot)
  $text = Read-McTextFile (Get-McNodeConfigPath $StateRoot)
  if ($null -eq $text) { return $null }
  try { return ($text | ConvertFrom-Json) } catch { return $null }
}

function Set-McNodeConfigValue {
  # Writes one value into node.config.json (atomic, other keys kept); $true when the file changed.
  param([string]$StateRoot, [string]$Name, $Value)
  $config = Read-McNodeConfig $StateRoot
  if ($null -eq $config) { throw 'run -Install first: node.config.json is missing' }
  $current = $null
  if ($null -ne $config.PSObject.Properties[$Name]) { $current = $config.$Name }
  if ($null -ne $current -and ("$current" -ceq "$Value")) { return $false }
  $config | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
  Write-McAtomicFile -Path (Get-McNodeConfigPath $StateRoot) -Content ($config | ConvertTo-Json -Depth 6)
  return $true
}

function Get-McCurrentUserId {
  $domain = [string]$env:USERDOMAIN
  $user = [string]$env:USERNAME
  if ($domain -ne '') { return ('{0}\{1}' -f $domain, $user) }
  return $user
}

# ---- Windows-only wrappers (the tests redefine these by name) ----------------------------------
function Get-McCimVideoControllers {
  if (-not (Test-McWindowsOnly)) { return @() }
  try {
    $items = Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop | Select-Object Name, AdapterCompatibility, DriverVersion, PNPDeviceID, AdapterRAM, VideoProcessor, Status
    return @($items)
  } catch {
    Write-Warning ('Win32_VideoController: ' + $_.Exception.Message)
    return @()
  }
}

function Get-McRegistryDisplayEntries {
  if (-not (Test-McWindowsOnly)) { return @() }
  $entries = New-Object System.Collections.ArrayList
  try {
    $items = Get-ItemProperty -Path (Join-Path $script:McDisplayClassKey '0*') -ErrorAction SilentlyContinue
    foreach ($item in @($items)) {
      if ($null -eq $item) { continue }
      [void]$entries.Add((New-McRegistryEntry -Subkey ([string]$item.PSChildName) -DriverDesc ([string]$item.DriverDesc) -MatchingDeviceId ([string]$item.MatchingDeviceId) -QwMemorySize $item.'HardwareInformation.qwMemorySize' -DriverVersion ([string]$item.DriverVersion)))
    }
  } catch {
    Write-Warning ('display class registry: ' + $_.Exception.Message)
  }
  return @($entries.ToArray())
}

function Get-McGpuInventory {
  $controllers = @(Get-McCimVideoControllers)
  $registry = @(Get-McRegistryDisplayEntries)
  return (Merge-McGpuInventory -Controllers $controllers -RegistryEntries $registry)
}

function Get-McProcessorInfo {
  if (-not (Test-McWindowsOnly)) { return $null }
  try {
    $cpu = @(Get-CimInstance -ClassName Win32_Processor -ErrorAction Stop)
    if ($cpu.Count -eq 0) { return $null }
    $cores = 0
    $logical = 0
    foreach ($p in $cpu) { $cores += [int]$p.NumberOfCores; $logical += [int]$p.NumberOfLogicalProcessors }
    return [pscustomobject]@{ Name = ([string]$cpu[0].Name).Trim(); Cores = $cores; LogicalProcessors = $logical }
  } catch { return $null }
}

function Get-McMemoryInfo {
  if (-not (Test-McWindowsOnly)) { return $null }
  try {
    $system = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
    $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    return [pscustomobject]@{ TotalBytes = (ConvertTo-McInt64 $system.TotalPhysicalMemory); FreeBytes = ((ConvertTo-McInt64 $os.FreePhysicalMemory) * 1024) }
  } catch { return $null }
}

function Get-McVolumeInfo {
  if (-not (Test-McWindowsOnly)) { return @() }
  $rows = New-Object System.Collections.ArrayList
  try {
    foreach ($volume in @(Get-Volume -ErrorAction Stop)) {
      if ($null -eq $volume) { continue }
      [void]$rows.Add([pscustomobject]@{ Letter = [string]$volume.DriveLetter; Label = [string]$volume.FileSystemLabel; FileSystem = [string]$volume.FileSystem; SizeBytes = (ConvertTo-McInt64 $volume.Size); FreeBytes = (ConvertTo-McInt64 $volume.SizeRemaining); Kind = 'volume' })
    }
    foreach ($partition in @(Get-Partition -ErrorAction SilentlyContinue)) {
      if ($null -eq $partition) { continue }
      [void]$rows.Add([pscustomobject]@{ Letter = [string]$partition.DriveLetter; Label = ('disk {0} partition {1} {2}' -f $partition.DiskNumber, $partition.PartitionNumber, $partition.Type); FileSystem = ''; SizeBytes = (ConvertTo-McInt64 $partition.Size); FreeBytes = $null; Kind = 'partition' })
    }
  } catch {
    try {
      foreach ($disk in @(Get-CimInstance -ClassName Win32_LogicalDisk -ErrorAction Stop)) {
        [void]$rows.Add([pscustomobject]@{ Letter = ([string]$disk.DeviceID).TrimEnd(':'); Label = [string]$disk.VolumeName; FileSystem = [string]$disk.FileSystem; SizeBytes = (ConvertTo-McInt64 $disk.Size); FreeBytes = (ConvertTo-McInt64 $disk.FreeSpace); Kind = 'volume' })
      }
      foreach ($partition in @(Get-CimInstance -ClassName Win32_DiskPartition -ErrorAction Stop)) {
        [void]$rows.Add([pscustomobject]@{ Letter = ''; Label = [string]$partition.Name; FileSystem = ''; SizeBytes = (ConvertTo-McInt64 $partition.Size); FreeBytes = $null; Kind = 'partition' })
      }
    } catch { }
  }
  return @($rows.ToArray())
}

function Get-McScheduledTaskInfo {
  if (-not (Test-McWindowsOnly)) { return @() }
  try {
    $tasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -like 'McCluster Node*' })
    $rows = New-Object System.Collections.ArrayList
    foreach ($task in $tasks) { [void]$rows.Add([pscustomobject]@{ Name = $task.TaskName; State = [string]$task.State }) }
    return @($rows.ToArray())
  } catch { return @() }
}

function Register-McScheduledTasks {
  # Two tasks (adapter, then the agent 20 s later): AtStartup + AtLogOn, current user, S4U, Limited,
  # restart 3 x 1 min, no time limit, start when available, IgnoreNew; the idle conditions come from the
  # -TaskSettings plan (Get-McTaskSettingsPlan / Get-McTaskSettingsArguments: the install defaults set none).
  # An idle-only plan also registers the idle sentinel task ("McCluster Node Idle": a sleeping powershell.exe
  # that Windows stops at idle end and restarts on idle); any other plan removes it.
  # With -Browser, only the browser executor task (10 s after start) is registered; the others are untouched.
  param([string]$StateRoot, [string]$UserId, [switch]$Browser, $TaskSettings = $null)
  if (-not (Test-McWindowsOnly)) { return $false }
  if ($null -eq $TaskSettings) { $TaskSettings = Get-McTaskSettingsPlan -Limits $null }
  $definitions = @(
    @{ Name = 'McCluster Node Adapter'; Launcher = [System.IO.Path]::Combine($StateRoot, 'adapter.cmd'); Delay = $null },
    @{ Name = 'McCluster Node Agent'; Launcher = [System.IO.Path]::Combine($StateRoot, 'agent.cmd'); Delay = 'PT20S' }
  )
  if ($Browser) { $definitions = @(@{ Name = $script:McBrowserTaskName; Launcher = [System.IO.Path]::Combine($StateRoot, 'browser.cmd'); Delay = 'PT10S' }) }
  elseif ($TaskSettings.IdleSentinel) { $definitions += @{ Name = $script:McIdleTaskName; Sentinel = $true; Delay = $null } }
  else {
    $stale = Get-ScheduledTask -TaskName $script:McIdleTaskName -ErrorAction SilentlyContinue
    if ($stale) { [void](Unregister-McScheduledTasks -Names @($script:McIdleTaskName)) }
  }
  foreach ($definition in $definitions) {
    $existing = Get-ScheduledTask -TaskName $definition.Name -ErrorAction SilentlyContinue
    if ($existing) { Unregister-ScheduledTask -TaskName $definition.Name -Confirm:$false }
    if ($definition.Sentinel) { $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -WindowStyle Hidden -Command "while ($true) { Start-Sleep -Seconds 3600 }"' }
    else { $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c "{0}"' -f $definition.Launcher) }
    $startup = New-ScheduledTaskTrigger -AtStartup
    $logon = New-ScheduledTaskTrigger -AtLogOn -User $UserId
    if ($definition.Delay) {
      $startup.Delay = $definition.Delay
      $logon.Delay = $definition.Delay
    }
    $principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType S4U -RunLevel Limited
    # The browser executor claims nothing by itself: it keeps the install defaults whatever the limits say.
    $plan = $TaskSettings
    if ($Browser) { $plan = Get-McTaskSettingsPlan -Limits $null }
    $settingsArguments = Get-McTaskSettingsArguments -TaskSettings $plan -Sentinel:([bool]$definition.Sentinel)
    $settings = New-ScheduledTaskSettingsSet @settingsArguments
    try {
      Register-ScheduledTask -TaskName $definition.Name -Action $action -Trigger @($startup, $logon) -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
    } catch {
      # A Task Scheduler build that refuses RestartOnIdle on a task it does not stop at idle end: the flag has
      # no effect there (nothing was stopped, so nothing is restarted); register without it and say so.
      if ($definition.Sentinel -or -not $settingsArguments.ContainsKey('RestartOnIdle') -or -not $settingsArguments.ContainsKey('DontStopOnIdleEnd')) { throw }
      Write-Warning ('scheduled task {0}: RestartOnIdle refused together with "do not stop at idle end" ({1}); registered without RestartOnIdle' -f $definition.Name, $_.Exception.Message)
      $settingsArguments = Get-McTaskSettingsArguments -TaskSettings $plan -NoRestartOnIdle
      $settings = New-ScheduledTaskSettingsSet @settingsArguments
      Register-ScheduledTask -TaskName $definition.Name -Action $action -Trigger @($startup, $logon) -Principal $principal -Settings $settings -Force -ErrorAction Stop | Out-Null
    }
  }
  return $true
}

function Unregister-McScheduledTasks {
  # Stops and removes every McCluster Node task that exists (adapter, agent, browser); returns the names removed.
  param([string[]]$Names)
  $removed = New-Object System.Collections.Generic.List[string]
  if (-not (Test-McWindowsOnly)) { return @($removed.ToArray()) }
  foreach ($name in @($Names)) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($null -eq $task) { continue }
    try { if ([string]$task.State -eq 'Running') { Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue } } catch { }
    try { Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction Stop; $removed.Add($name) } catch { Write-Warning ('scheduled task {0}: {1}' -f $name, $_.Exception.Message) }
  }
  return @($removed.ToArray())
}

function Get-McThermalReading {
  # The hottest ACPI thermal zone in degrees C, or $null when the host exposes none or refuses the read (the
  # usual case without administrator rights): then thermal_supported is false and a thermal limit is reported
  # as unsupported, never silently dropped.
  if (-not (Test-McWindowsOnly)) { return $null }
  try {
    $zones = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop)
    $max = $null
    foreach ($zone in $zones) {
      if ($null -eq $zone) { continue }
      $tenths = ConvertTo-McInt64 $zone.CurrentTemperature
      if ($null -eq $tenths -or $tenths -le 0) { continue }
      $celsius = [math]::Round($tenths / 10.0 - 273.15, 1)
      if ($null -eq $max -or $celsius -gt $max) { $max = $celsius }
    }
    return $max
  } catch { return $null }
}

function Start-McScheduledTask {
  param([string]$Name)
  if (-not (Test-McWindowsOnly)) { return $false }
  try {
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction Stop
    if ([string]$task.State -ne 'Running') { Start-ScheduledTask -TaskName $Name -ErrorAction Stop }
    return $true
  } catch {
    Write-Warning ('scheduled task {0}: {1}' -f $Name, $_.Exception.Message)
    return $false
  }
}

function Stop-McScheduledTask {
  param([string]$Name)
  if (-not (Test-McWindowsOnly)) { return $false }
  try {
    $task = Get-ScheduledTask -TaskName $Name -ErrorAction Stop
    if ([string]$task.State -eq 'Running') { Stop-ScheduledTask -TaskName $Name -ErrorAction Stop }
    return $true
  } catch {
    Write-Warning ('scheduled task {0}: {1}' -f $Name, $_.Exception.Message)
    return $false
  }
}

function Invoke-McIcacls {
  # icacls <target> /inheritance:r /grant:r "<DOMAIN\user>:<rights>"; best effort, never fatal.
  param([string]$Target, [string]$Rights)
  if (-not (Test-McWindowsOnly)) { return $false }
  $who = Get-McCurrentUserId
  if ($who -eq '') { return $false }
  try {
    & icacls.exe $Target /inheritance:r /grant:r ('{0}:{1}' -f $who, $Rights) | Out-Null
    return ($LASTEXITCODE -eq 0)
  } catch { return $false }
}

function Set-McUserEnvironment {
  # Returns $true when the user-scope value changed.
  param([string]$Name, [string]$Value)
  if (-not (Test-McWindowsOnly)) { return $false }
  $current = [System.Environment]::GetEnvironmentVariable($Name, 'User')
  if ([string]$current -ceq [string]$Value) { return $false }
  [System.Environment]::SetEnvironmentVariable($Name, $Value, 'User')
  return $true
}

function Get-McUserEnvironment {
  param([string]$Name)
  if (-not (Test-McWindowsOnly)) { return $null }
  return [System.Environment]::GetEnvironmentVariable($Name, 'User')
}

function Test-McAdministrator {
  if (-not (Test-McWindowsOnly)) { return $false }
  try {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { return $false }
}

function Read-McSecret {
  # The enrolment token, read as a secure string and never echoed.
  param([string]$Prompt)
  $secure = Read-Host -AsSecureString $Prompt
  $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Read-McAnswer {
  param([string]$Prompt)
  return [string](Read-Host $Prompt)
}

function Invoke-McPowerCfg {
  param([string[]]$Arguments)
  if (-not (Test-McWindowsOnly)) { return @() }
  try { return @(& powercfg.exe @Arguments 2>&1 | ForEach-Object { [string]$_ }) } catch { return @() }
}

function Get-McOllamaExe {
  $command = Get-Command ollama -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  if ($env:LOCALAPPDATA) {
    $candidate = [System.IO.Path]::Combine($env:LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe')
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

function Invoke-McOllamaJson {
  # Loopback only: GET or POST JSON to the local Ollama daemon; $null when it does not answer.
  param([string]$Path, $Body, [int]$TimeoutSec = 10)
  $uri = $script:McOllamaUrl + $Path
  try {
    if ($null -ne $Body) {
      return Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 12 -Compress) -TimeoutSec $TimeoutSec
    }
    return Invoke-RestMethod -Method Get -Uri $uri -TimeoutSec $TimeoutSec
  } catch { return $null }
}

function Invoke-McBrowserJson {
  # Loopback only: GET JSON from the browser executor on 127.0.0.1:4791; $null when it does not answer or
  # answers 503 (not ready).
  param([string]$Path, [int]$TimeoutSec = 5)
  $uri = $script:McBrowserUrl + $Path
  try { return Invoke-RestMethod -Method Get -Uri $uri -TimeoutSec $TimeoutSec } catch { return $null }
}

function Get-McOllamaLogLines {
  param([int]$Tail = 400)
  if (-not $env:LOCALAPPDATA) { return @() }
  $log = [System.IO.Path]::Combine($env:LOCALAPPDATA, 'Ollama', 'server.log')
  if (-not (Test-Path -LiteralPath $log)) { return @() }
  try { return @(Get-Content -LiteralPath $log -Tail $Tail -ErrorAction Stop) } catch { return @() }
}

function Invoke-McNodeProcess {
  # Runs `node <script> <arguments>` once with an explicit environment (this process's own environment is
  # not touched), bounded by a timeout (0 = none); returns exit code and captured output. -Interactive runs
  # it on this console instead (no capture, no limit): -BrowserHeaded, where the owner ends it with Ctrl+C.
  param([string]$Script, [string[]]$Arguments = @(), [hashtable]$Environment = @{}, [string]$WorkingDirectory, [int]$TimeoutSeconds = 120, [switch]$Interactive)
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) { throw 'node was not found on PATH; install Node.js 20 or newer first' }
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $nodeCommand.Source
  $quoted = New-Object System.Collections.Generic.List[string]
  $quoted.Add('"' + $Script + '"')
  foreach ($argument in @($Arguments)) { $quoted.Add('"' + ([string]$argument -replace '"', '\"') + '"') }
  $info.Arguments = ($quoted -join ' ')
  $info.WorkingDirectory = $WorkingDirectory
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = (-not $Interactive)
  $info.RedirectStandardError = (-not $Interactive)
  $info.CreateNoWindow = (-not $Interactive)
  foreach ($key in $Environment.Keys) { $info.EnvironmentVariables[[string]$key] = [string]$Environment[$key] }
  $process = [System.Diagnostics.Process]::Start($info)
  if ($Interactive) {
    $process.WaitForExit()
    return [pscustomobject]@{ ExitCode = $process.ExitCode; TimedOut = $false; StdOut = ''; StdErr = '' }
  }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $finished = $true
  if ($TimeoutSeconds -le 0) { $process.WaitForExit() }
  else { $finished = $process.WaitForExit($TimeoutSeconds * 1000) }
  if (-not $finished) {
    try { $process.Kill() } catch { }
    $process.WaitForExit()
  }
  $stdout = $stdoutTask.Result
  $stderr = $stderrTask.Result
  return [pscustomobject]@{ ExitCode = $process.ExitCode; TimedOut = (-not $finished); StdOut = $stdout; StdErr = $stderr }
}

function Get-McNpmCliPath {
  # npm's own entry point beside node (node_modules\npm\bin\npm-cli.js), run through node: no cmd.exe and no package-runner lookup.
  $node = Get-Command node -ErrorAction SilentlyContinue
  $npm = Get-Command npm -ErrorAction SilentlyContinue
  $candidates = New-Object System.Collections.Generic.List[string]
  if ($npm) { $candidates.Add([System.IO.Path]::Combine((Split-Path -Parent $npm.Source), 'node_modules', 'npm', 'bin', 'npm-cli.js')) }
  if ($node) {
    $bin = Split-Path -Parent $node.Source
    $candidates.Add([System.IO.Path]::Combine($bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'))
    $candidates.Add([System.IO.Path]::Combine((Split-Path -Parent $bin), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  }
  foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate) { return $candidate } }
  return $null
}

function Invoke-McNpm {
  # node <npm-cli.js> <arguments>: the registry download -Browser makes, bounded by a timeout. The tests
  # redefine this by name; nothing else in the script calls npm.
  param([string[]]$Arguments, [string]$WorkingDirectory, [int]$TimeoutSeconds = 600)
  $cli = Get-McNpmCliPath
  if ($null -eq $cli) { throw 'npm was not found beside node on PATH; install Node.js 20 or newer (it ships npm) first' }
  return (Invoke-McNodeProcess -Script $cli -Arguments $Arguments -Environment @{} -WorkingDirectory $WorkingDirectory -TimeoutSeconds $TimeoutSeconds)
}

function Invoke-McPlaywrightCli {
  # node <StateRoot>\browser\node_modules\playwright\cli.js <arguments>: the installed package's own command
  # line, so the version is the one npm pinned, with PLAYWRIGHT_BROWSERS_PATH keeping Chromium under the
  # state root. The tests redefine this by name.
  param([string]$StateRoot, [string[]]$Arguments, [int]$TimeoutSeconds = 900)
  $cli = [System.IO.Path]::Combine((Get-McPlaywrightDir $StateRoot), 'cli.js')
  if (-not (Test-Path -LiteralPath $cli)) { throw ('playwright cli.js not found under {0}; the npm install did not land' -f (Get-McPlaywrightDir $StateRoot)) }
  $environment = @{ PLAYWRIGHT_BROWSERS_PATH = (Get-McPlaywrightBrowsersPath $StateRoot) }
  return (Invoke-McNodeProcess -Script $cli -Arguments $Arguments -Environment $environment -WorkingDirectory (Get-McBrowserDir $StateRoot) -TimeoutSeconds $TimeoutSeconds)
}

# ---- actions -----------------------------------------------------------------------------------
function Invoke-McReport {
  [CmdletBinding()]
  param([string]$StateRoot)
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add('=== MCCLUSTER NODE REPORT ===')
  $lines.Add(('generated {0}' -f (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')))
  $lines.Add(('PowerShell {0} ({1}); state root {2}' -f $PSVersionTable.PSVersion, $PSVersionTable.PSEdition, $StateRoot))

  $lines.Add('GPU')
  $gpuResult = $null
  try { $gpuResult = Get-McGpuInventory } catch { $lines.Add(('  unavailable: ' + $_.Exception.Message)) }
  $gpus = @()
  if ($null -ne $gpuResult) { $gpus = @($gpuResult.Gpus) }
  if ($gpus.Count -eq 0) { $lines.Add('  none found (no PCI display adapter answered Win32_VideoController)') }
  $index = 0
  foreach ($gpu in $gpus) {
    $memoryNote = $gpu.Memory
    if ($gpu.Form -eq 'integrated') { $memoryNote = 'shared memory (APU)' }
    $wrappedNote = 'no'
    if ($gpu.AdapterRamWrapped) { $wrappedNote = 'yes' }
    $lines.Add(('  [{0}] {1}: {2}, {3}; VRAM {4} ({5}, {6}); driver {7}; compute {8}' -f $index, $gpu.Name, $gpu.Vendor, $gpu.Form, (Format-McBytes $gpu.VramBytes), $gpu.VramSource, $memoryNote, $gpu.DriverVersion, $gpu.Compute))
    $lines.Add(('      PNP {0}; AdapterRAM {1}; AdapterRAM wrapped: {2}' -f $gpu.PnpDeviceId, (Format-McBytes $gpu.AdapterRamBytes), $wrappedNote))
    $index++
  }
  if ($null -ne $gpuResult -and @($gpuResult.Ignored).Count -gt 0) { $lines.Add(('  ignored (not an accelerator): ' + (@($gpuResult.Ignored) -join ', '))) }

  $lines.Add('CPU')
  $cpu = Get-McProcessorInfo
  if ($null -eq $cpu) { $lines.Add('  unavailable') } else { $lines.Add(('  {0}; {1} cores, {2} logical processors' -f $cpu.Name, $cpu.Cores, $cpu.LogicalProcessors)) }

  $lines.Add('RAM')
  $memory = Get-McMemoryInfo
  if ($null -eq $memory) { $lines.Add('  unavailable') } else { $lines.Add(('  total {0}; free {1}' -f (Format-McBytes $memory.TotalBytes), (Format-McBytes $memory.FreeBytes))) }

  $lines.Add('VOLUMES AND PARTITIONS')
  $volumes = @(Get-McVolumeInfo)
  if ($volumes.Count -eq 0) { $lines.Add('  unavailable') }
  foreach ($volume in $volumes) {
    $flag = ''
    if (Test-McCandidatePartition $volume.SizeBytes) { $flag = '  <- candidate 50 GB partition' }
    $letter = [string]$volume.Letter
    if ($letter -eq '') { $letter = '-' }
    $free = 'free unknown'
    if ($null -ne $volume.FreeBytes) { $free = 'free ' + (Format-McBytes $volume.FreeBytes) }
    $lines.Add(('  {0} {1}: {2} {3}, {4} {5}{6}' -f $volume.Kind, $letter, $volume.Label, $volume.FileSystem, (Format-McBytes $volume.SizeBytes), $free, $flag))
  }

  $lines.Add('OLLAMA')
  $exe = Get-McOllamaExe
  if ($null -eq $exe) { $lines.Add('  ollama.exe not found on PATH or under the local app data Programs folder') }
  else {
    $versionText = ''
    try { $versionText = [string](& $exe --version 2>&1 | Select-Object -First 1) } catch { $versionText = 'version unavailable' }
    $lines.Add(('  {0}' -f $versionText.Trim()))
  }
  $apiVersion = Invoke-McOllamaJson -Path '/api/version'
  if ($null -eq $apiVersion) { $lines.Add('  daemon: not answering on ' + $script:McOllamaUrl) }
  else {
    $lines.Add(('  daemon: {0} answers, version {1}' -f $script:McOllamaUrl, $apiVersion.version))
    $tags = Invoke-McOllamaJson -Path '/api/tags'
    if ($null -ne $tags -and $null -ne $tags.models) {
      foreach ($m in @($tags.models)) { $lines.Add(('  installed: {0} ({1})' -f $m.name, (Format-McBytes $m.size))) }
    } else { $lines.Add('  installed: none') }
    $ps = Invoke-McOllamaJson -Path '/api/ps'
    if ($null -ne $ps -and $null -ne $ps.models -and @($ps.models).Count -gt 0) {
      foreach ($m in @($ps.models)) {
        $percent = Get-McProcessorGpuPercent -PsResponse $ps -ModelName ([string]$m.name)
        $usedGpu = 'unknown'
        if ($null -ne $percent) { if ($percent -gt 0) { $usedGpu = 'yes' } else { $usedGpu = 'no' } }
        $lines.Add(('  loaded: {0}; size {1}; size_vram {2}; PROCESSOR {3}% GPU; last load used the GPU: {4}' -f $m.name, (Format-McBytes $m.size), (Format-McBytes $m.size_vram), $percent, $usedGpu))
      }
    } else { $lines.Add('  loaded: nothing; last load used the GPU: unknown') }
  }
  $backend = Get-McBackendNote -LogLines (Get-McOllamaLogLines)
  if ($null -ne $backend) { $lines.Add('  inference compute (server.log): ' + $backend) } else { $lines.Add('  inference compute (server.log): no line found') }

  $lines.Add('SCHEDULED TASKS')
  $tasks = @(Get-McScheduledTaskInfo)
  if ($tasks.Count -eq 0) { $lines.Add('  none named McCluster Node*') }
  foreach ($task in $tasks) { $lines.Add(('  {0}: {1}' -f $task.Name, $task.State)) }

  $lines.Add('BROWSER')
  $browserTask = @($tasks | Where-Object { $_.Name -eq $script:McBrowserTaskName })
  $browserTaskState = $null
  if ($browserTask.Count -gt 0) { $browserTaskState = [string]$browserTask[0].State }
  foreach ($line in (Format-McBrowserReportLines -StateRoot $StateRoot -TaskState $browserTaskState -Health (Invoke-McBrowserJson -Path '/health') -Ready (Invoke-McBrowserJson -Path '/ready'))) { $lines.Add($line) }

  $lines.Add('CONTRIBUTION')
  foreach ($line in (Format-McContributionReportLines -StateRoot $StateRoot -ThermalReading (Get-McThermalReading))) { $lines.Add($line) }

  $lines.Add('NODE FILES')
  foreach ($name in @('capabilities.json', 'node.config.json', 'identity.json', 'measured-inference.json', 'gpu-evidence.json', 'enroll.env', 'browser-policy.json', 'browser.cmd', 'paused', 'limits.json', 'revoked.json', 'last-heartbeat.json')) {
    $present = 'absent'
    if (Test-Path -LiteralPath ([System.IO.Path]::Combine($StateRoot, $name))) { $present = 'present' }
    $lines.Add(('  {0}: {1}' -f $name, $present))
  }
  $config = Read-McNodeConfig $StateRoot
  if ($null -ne $config) {
    $browserFlag = 'no'
    if ($config.browser -eq $true) { $browserFlag = 'yes' }
    $lines.Add(('  node.config.json: tier {0}, node {1}, browser {2}, written {3}' -f $config.tier, $config.node_name, $browserFlag, $config.written_at))
  }

  $lines.Add('ENVIRONMENT')
  $variables = @{}
  foreach ($item in @(Get-ChildItem Env:)) { $variables[[string]$item.Name] = [string]$item.Value }
  foreach ($line in (Format-McEnvironmentLines -Variables $variables)) { $lines.Add($line) }

  $lines.Add('=== END REPORT ===')
  foreach ($line in $lines) { Write-Output (Get-McMaskedText $line) }
}

function Invoke-McInstall {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$RepoPath, [string]$StateRoot, [string]$NodeName, [string]$OrgId, [string]$ComputeUrl, [string]$TierOverride)
  if (-not $RepoPath) { throw '-Install needs -RepoPath <checkout of mcclusterishere/mccluster>' }
  $templatePath = Get-McTemplatePath $RepoPath
  if (-not (Test-Path -LiteralPath $templatePath)) { throw ('template not found: ' + $templatePath) }
  $previous = Read-McNodeConfig $StateRoot
  if (-not $OrgId -and $null -ne $previous -and $previous.org_id) { $OrgId = [string]$previous.org_id }
  # -Browser installed the executor earlier: the browser.act entry stays beside the tier's models.
  $browserOn = ($null -ne $previous -and $previous.browser -eq $true)
  if (-not $OrgId) { throw '-Install needs -OrgId <organization uuid> the first time (it is kept in node.config.json afterwards)' }
  if ($OrgId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { throw '-OrgId must be a uuid' }
  if ($ComputeUrl -notmatch '^https://') { throw '-ComputeUrl must be an https:// URL (the Core compute gateway behind TLS ingress)' }
  Assert-McLauncherValues -NodeName $NodeName -StateRoot $StateRoot -RepoPath $RepoPath -ComputeUrl $ComputeUrl

  $inventory = Get-McGpuInventory
  $memory = Get-McMemoryInfo
  $freeBytes = [int64]0
  if ($null -ne $memory -and $null -ne $memory.FreeBytes) { $freeBytes = [int64]$memory.FreeBytes }
  $primary = Select-McPrimaryGpu $inventory.Gpus
  $decision = Get-McTierDecision -Gpu $primary -FreePhysicalMemoryBytes $freeBytes -Override $TierOverride
  $settings = $decision.Settings
  Write-Host ('Tier {0} because {1}' -f $decision.Tier, $decision.Reason)
  Write-Host ('  ' + $settings.Description)
  Write-Host ('  owner decision 2026-11-17, headroom first: one resident model ({0}), the rest on demand; -Benchmark measures the free memory it leaves and refuses a tier under {1}' -f $settings.ResidentModel, (Format-McBytes $script:McHeadroomFloorBytes))
  if ($browserOn) { Write-Host ('  browser executor installed earlier (-Browser): the {0} entry is kept beside the tier''s models' -f $script:McBrowserImplementation) }

  $values = Get-McNodeEnvironment -Settings $settings -StateRoot $StateRoot -NodeName $NodeName -OrgId $OrgId -ComputeUrl $ComputeUrl
  foreach ($key in $values.Keys) { Write-Host ('  {0}={1}' -f $key, $values[$key]) }

  $written = New-Object System.Collections.Generic.List[string]
  $changedEnvironment = New-Object System.Collections.Generic.List[string]
  $tasksRegistered = $false
  $logs = [System.IO.Path]::Combine($StateRoot, 'logs')

  if ($PSCmdlet.ShouldProcess($StateRoot, 'create the state root and logs folder, owner-only ACL')) {
    foreach ($directory in @($StateRoot, $logs)) {
      if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null; $written.Add($directory) }
    }
    if (-not (Invoke-McIcacls -Target $StateRoot -Rights '(OI)(CI)F')) { Write-Host '  ACL: owner-only ACL not applied (not Windows or icacls unavailable); the agent applies a best-effort ACL too' }
  }

  $manifestPath = Get-McManifestPath $StateRoot
  if ($PSCmdlet.ShouldProcess($manifestPath, ('write capabilities.json from the template pruned to tier ' + $decision.Tier))) {
    $templateJson = Read-McTextFile $templatePath
    $extra = @()
    if ($browserOn) { $extra = @($script:McBrowserImplementation) }
    $manifestJson = ConvertTo-McManifestJson -TemplateJson $templateJson -Settings $settings -ExtraImplementations $extra
    # A re-run keeps the owner's max_concurrency from limits.json (the template alone would reset the leases).
    $keptLimits = (Read-McLimitsTaskPlan -StateRoot $StateRoot).Limits
    if ($keptLimits.Present -and $null -eq $keptLimits.Error) { $manifestJson = Set-McManifestConcurrency -ManifestJson $manifestJson -MaxConcurrency $keptLimits.MaxConcurrency }
    if (Write-McFileIfChanged -Path $manifestPath -Content $manifestJson) { $written.Add($manifestPath) }
  }

  $configPath = Get-McNodeConfigPath $StateRoot
  if ($PSCmdlet.ShouldProcess($configPath, 'write node.config.json (no secrets)')) {
    $chosen = $null
    if ($null -ne $primary) { $chosen = [ordered]@{ name = $primary.Name; vendor = $primary.Vendor; form = $primary.Form; memory = $primary.Memory; vram_bytes = $primary.VramBytes; vram_source = $primary.VramSource } }
    $config = [ordered]@{
      schema = 'mccluster-node-config/1'
      node_name = $NodeName
      org_id = $OrgId
      compute_url = $ComputeUrl
      tier = $decision.Tier
      tier_reason = $decision.Reason
      resident_model = [string]$settings.ResidentModel
      chosen_gpu = $chosen
      repo_path = $RepoPath
      state_root = $StateRoot
      browser = $browserOn
      written_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    }
    $configJson = ($config | ConvertTo-Json -Depth 6)
    $existing = Read-McNodeConfig $StateRoot
    $same = $false
    if ($null -ne $existing) {
      $same = ([string]$existing.node_name -eq $NodeName) -and ([string]$existing.org_id -eq $OrgId) -and ([string]$existing.compute_url -eq $ComputeUrl) -and ([string]$existing.tier -eq $decision.Tier) -and ([string]$existing.repo_path -eq $RepoPath) -and ([string]$existing.state_root -eq $StateRoot) -and (($existing.browser -eq $true) -eq $browserOn)
    }
    if (-not $same) { Write-McAtomicFile -Path $configPath -Content $configJson; $written.Add($configPath) }
  }

  if ($PSCmdlet.ShouldProcess('user-scope environment', ('set {0} MCCLUSTER_* / OLLAMA_* variables' -f $values.Count))) {
    foreach ($key in $values.Keys) {
      if (Set-McUserEnvironment -Name $key -Value ([string]$values[$key])) { $changedEnvironment.Add($key) }
    }
  }

  foreach ($kind in @('adapter', 'agent')) {
    $launcherPath = [System.IO.Path]::Combine($StateRoot, ($kind + '.cmd'))
    if ($PSCmdlet.ShouldProcess($launcherPath, 'write launcher')) {
      $text = Get-McLauncherText -Kind $kind -Environment $values -RepoPath $RepoPath -StateRoot $StateRoot
      if (Write-McFileIfChanged -Path $launcherPath -Content $text) { $written.Add($launcherPath) }
    }
  }

  # A re-run of -Install keeps the owner's limits: the tasks are registered with the plan of the limits.json
  # already under the state root (absent: the install defaults), never silently back at the defaults.
  $existingLimits = Read-McLimitsTaskPlan -StateRoot $StateRoot
  $taskPlan = $existingLimits.Plan
  if ($existingLimits.Limits.Present) {
    if ($null -ne $existingLimits.Limits.Error) { Write-Host ('  limits.json is unreadable ({0}): scheduled tasks get the install defaults; run -Limits to rewrite it' -f $existingLimits.Limits.Error) }
    else { Write-Host ('  limits.json kept; scheduled tasks follow it: ' + (Format-McTaskSettingsPlan $taskPlan)) }
  }
  if ($PSCmdlet.ShouldProcess(($script:McTaskNames -join ', '), ('register scheduled tasks (AtStartup, AtLogOn, current user, restart on failure, no time limit; ' + (Format-McTaskSettingsPlan $taskPlan) + ')'))) {
    $tasksRegistered = Register-McScheduledTasks -StateRoot $StateRoot -UserId (Get-McCurrentUserId) -TaskSettings $taskPlan
    if (-not $tasksRegistered) { Write-Host '  scheduled tasks: not registered (not Windows)' }
  }

  Write-Host ('Install done: {0} file(s) written, {1} user variable(s) changed, scheduled tasks {2}.' -f $written.Count, $changedEnvironment.Count, $(if ($tasksRegistered) { 'registered' } else { 'not registered' }))
  Write-Host 'Next: run -Models (pull the tier models), then -Enroll with the one-time token from the owner''s Core.'
  return [pscustomobject]@{ Tier = $decision.Tier; Settings = $settings; Written = @($written.ToArray()); EnvironmentChanged = @($changedEnvironment.ToArray()); TasksRegistered = $tasksRegistered; TaskPlan = $taskPlan; ManifestPath = $manifestPath }
}

function Invoke-McEnroll {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$StateRoot, [string]$RepoPath)
  $config = Read-McNodeConfig $StateRoot
  if ($null -eq $config) { throw 'run -Install first: node.config.json is missing' }
  if (-not $RepoPath) { $RepoPath = [string]$config.repo_path }
  if (-not $RepoPath) { throw '-Enroll needs -RepoPath (node.config.json has none)' }
  $agent = [System.IO.Path]::Combine($RepoPath, 'core', 'src', 'compute', 'node-agent.mjs')
  if (-not (Test-Path -LiteralPath $agent)) { throw ('node agent not found: ' + $agent) }
  $settings = Get-McTierSettings ([string]$config.tier)
  $values = Get-McNodeEnvironment -Settings $settings -StateRoot $StateRoot -NodeName ([string]$config.node_name) -OrgId ([string]$config.org_id) -ComputeUrl ([string]$config.compute_url)
  $enrollFile = Get-McEnrollFilePath $StateRoot
  $environment = @{}
  foreach ($key in $values.Keys) { $environment[[string]$key] = [string]$values[$key] }

  # The desktop (and any non-interactive caller) hands the one-time token over in this process's environment:
  # it goes straight into the agent's environment and no enroll.env is written. On a console it is read as a
  # secure string and kept in the owner-only file for the length of the run, as before.
  $fromEnvironment = ([string]$env:MCCLUSTER_NODE_ENROLL_TOKEN -ne '')
  if ($fromEnvironment) {
    if (-not $PSCmdlet.ShouldProcess('MCCLUSTER_NODE_ENROLL_TOKEN (environment)', 'enrol once with the token from the environment; no file is written')) { return 0 }
    $environment['MCCLUSTER_NODE_ENROLL_TOKEN'] = [string]$env:MCCLUSTER_NODE_ENROLL_TOKEN
    $env:MCCLUSTER_NODE_ENROLL_TOKEN = ''
    Write-Host 'Enrolment token taken from the environment (not written to any file).'
  } else {
    $enrolSecret = Read-McSecret 'Enrolment token (shown once by the owner''s Core)'
    if ([string]$enrolSecret -eq '') { Write-Host 'No token entered; nothing was written.'; return 2 }
    if (-not $PSCmdlet.ShouldProcess($enrollFile, 'write the one-shot enrolment token file (owner-only ACL), enrol once, delete it')) { return 0 }
    Write-McAtomicFile -Path $enrollFile -Content ('MCCLUSTER_NODE_ENROLL_TOKEN=' + $enrolSecret + "`r`n")
    [void](Invoke-McIcacls -Target $enrollFile -Rights 'F')
    $enrolSecret = $null
    $fileText = Read-McTextFile $enrollFile
    foreach ($line in ([string]$fileText -split "`r?`n")) {
      if ($line -match '^MCCLUSTER_NODE_ENROLL_TOKEN=(.+)$') { $environment['MCCLUSTER_NODE_ENROLL_TOKEN'] = $matches[1] }
    }
    $fileText = $null
  }
  [void](Start-McScheduledTask -Name 'McCluster Node Adapter')

  $environment['MCCLUSTER_NODE_ENROLL_ONLY'] = '1'
  Write-Host 'Enrolling once (up to 120 s)...'
  $result = Invoke-McNodeProcess -Script $agent -Environment $environment -WorkingDirectory ([System.IO.Path]::Combine($RepoPath, 'core')) -TimeoutSeconds 120
  $environment.Clear()

  $nodeId = $null
  $enrolled = $null
  foreach ($line in ([string]$result.StdOut -split "`r?`n")) {
    if ($line -match '"event":"compute_node_enroll_only_done"') {
      try { $event = $line | ConvertFrom-Json; $nodeId = [string]$event.node_id; $enrolled = [string]$event.enrolled } catch { }
    }
  }
  if ($result.ExitCode -eq 0 -and -not $result.TimedOut) {
    Remove-Item -LiteralPath $enrollFile -Force -ErrorAction SilentlyContinue
    [void](Start-McScheduledTask -Name 'McCluster Node Agent')
    Write-Host ('Enrolled. node_id {0}; enrolled {1}' -f $nodeId, $enrolled)
    if ($fromEnvironment) { Write-Host 'token was never written to disk; it is single-use (or rotate CORE_COMPUTE_ENROLL_TOKEN on the Core if it was the bootstrap token)' }
    else { Write-Host 'token removed from this machine; rotate CORE_COMPUTE_ENROLL_TOKEN on the Core (deploy-gated)' }
    return 0
  }
  $why = 'exit code ' + $result.ExitCode
  if ($result.TimedOut) { $why = 'timed out after 120 s' }
  Write-Host ('Enrolment did not finish ({0}).' -f $why)
  foreach ($line in @(([string]$result.StdErr -split "`r?`n") | Where-Object { $_ -ne '' } | Select-Object -Last 5)) { Write-Host ('  ' + (Get-McMaskedText $line)) }
  if ($fromEnvironment) { Write-Host 'nothing to remove: the token was never written to disk; run -Enroll again with a fresh token'; return 1 }
  $answer = Read-McAnswer 'Keep enroll.env on this machine for a retry? [y/N]'
  if ($answer -notmatch '^[Yy]') { Remove-Item -LiteralPath $enrollFile -Force -ErrorAction SilentlyContinue; Write-Host 'token file removed' }
  else { Write-Host 'token file kept; run -Enroll again or remove it by hand' }
  return 1
}

function Invoke-McModels {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$StateRoot, [string]$ModelOverride)
  $exe = Get-McOllamaExe
  if ($null -eq $exe) { throw 'ollama.exe was not found; install Ollama for Windows first' }
  $config = Read-McNodeConfig $StateRoot
  $tier = 'D'
  if ($null -ne $config -and $config.tier) { $tier = [string]$config.tier }
  $settings = Get-McTierSettings $tier
  $models = @($settings.PullModels)
  if ($ModelOverride) {
    if (-not (Test-McModelAllowedOnTier -ModelName $ModelOverride -Tier $tier)) { throw ('{0} is tier A only (a discrete card with 12 GiB or more); owner decision 2026-11-17: no 12B/14B model on a shared-memory machine (this node is tier {1})' -f $ModelOverride, $tier) }
    if (-not ($models -contains $ModelOverride)) { $models = $models + @($ModelOverride) }
  }
  $version = Invoke-McOllamaJson -Path '/api/version'
  if ($null -ne $version -and -not (Test-McVersionAtLeast -Version ([string]$version.version) -Minimum $script:McMinimumOllamaVersion)) {
    Write-Host ('  Ollama {0} is older than {1}: the vision models answer HTTP 412 there; update the Ollama app first' -f $version.version, $script:McMinimumOllamaVersion)
  }
  foreach ($name in $models) {
    if ($PSCmdlet.ShouldProcess($name, 'ollama pull')) {
      Write-Host ('ollama pull {0}' -f $name)
      & $exe pull $name | Out-Host
      if ($LASTEXITCODE -ne 0) { Write-Host ('  pull of {0} returned {1}' -f $name, $LASTEXITCODE) }
    }
  }
  $tags = Invoke-McOllamaJson -Path '/api/tags'
  if ($null -ne $tags -and $null -ne $tags.models) {
    foreach ($m in @($tags.models)) { Write-Host ('  installed: {0} ({1})' -f $m.name, (Format-McBytes $m.size)) }
  }
  return 0
}

function Get-McFreeMemoryBytes {
  # FreePhysicalMemory as bytes, or $null when the host cannot say (the tests redefine Get-McMemoryInfo).
  $memory = Get-McMemoryInfo
  if ($null -eq $memory) { return $null }
  return (ConvertTo-McInt64 $memory.FreeBytes)
}

function Test-McVersionAtLeast {
  # '0.40.16' >= '0.12.7'; a version that does not parse is treated as too old (the caller only warns).
  param([string]$Version, [string]$Minimum)
  $v = ([string]$Version).Trim() -replace '^v', ''
  if ($v -match '^(\d+)\.(\d+)(?:\.(\d+))?') {
    $patch = '0'
    if ($matches[3]) { $patch = $matches[3] }
    $parsed = [version]('{0}.{1}.{2}' -f $matches[1], $matches[2], $patch)
    return ($parsed -ge [version]$Minimum)
  }
  return $false
}

function Invoke-McBenchmark {
  # Measures the tier's resident model (or -Model): free memory before loading and with the model loaded, prompt
  # and generation tokens per second, the PROCESSOR share; writes the sidecar; then applies the owner's headroom
  # rule (2026-11-17): a resident model that leaves under 4 GB free refuses the tier (exit 1, the lower tier is
  # named), the on-demand twin qwen3:8b is advertised or not by the same measure.
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$StateRoot, [string]$ModelOverride, [string]$RepoPath)
  $config = Read-McNodeConfig $StateRoot
  $tier = 'D'
  if ($null -ne $config -and $config.tier) { $tier = [string]$config.tier }
  $settings = Get-McTierSettings $tier
  $modelName = [string]$settings.BenchmarkModel
  if ($ModelOverride) { $modelName = $ModelOverride }
  if (-not (Test-McModelAllowedOnTier -ModelName $modelName -Tier $tier)) { throw ('{0} is tier A only (a discrete card with 12 GiB or more); owner decision 2026-11-17: no 12B/14B model on a shared-memory machine (this node is tier {1})' -f $modelName, $tier) }
  $numCtx = [int]$settings.Context
  if ($env:MCCLUSTER_OLLAMA_CONTEXT -match '^\d+$') { $numCtx = [int]$env:MCCLUSTER_OLLAMA_CONTEXT }
  $numPredict = 256
  $version = Invoke-McOllamaJson -Path '/api/version'
  if ($null -eq $version) { throw ('Ollama does not answer on ' + $script:McOllamaUrl) }
  $body = @{
    model = $modelName
    stream = $false
    messages = @(@{ role = 'user'; content = $script:McBenchmarkPrompt })
    keep_alive = '24h'
    options = @{ temperature = 0; num_ctx = $numCtx; num_predict = $numPredict }
  }
  if (Test-McThinkModel $modelName) { $body['think'] = $false }
  $before = Get-McFreeMemoryBytes
  Write-Host ('Benchmark {0}: warm-up call, then the measured call (num_ctx {1}, num_predict {2}); free memory before loading: {3}' -f $modelName, $numCtx, $numPredict, (Format-McBytes $before))
  $warm = Invoke-McOllamaJson -Path '/api/chat' -Body $body -TimeoutSec 900
  if ($null -eq $warm) { throw ('the warm-up call to /api/chat failed for ' + $modelName + ' (is the model pulled? run -Models)') }
  $after = Get-McFreeMemoryBytes
  $measured = Invoke-McOllamaJson -Path '/api/chat' -Body $body -TimeoutSec 900
  if ($null -eq $measured) { throw 'the measured call to /api/chat failed' }
  $ps = Invoke-McOllamaJson -Path '/api/ps'
  $metrics = Get-McBenchmarkMetrics -ChatResponse $measured -PsResponse $ps -ModelName $modelName -FreeMemoryBeforeBytes $before -FreeMemoryAfterBytes $after
  $backend = Get-McBackendNote -LogLines (Get-McOllamaLogLines)
  Write-Host ('  prompt {0} tok/s; generation {1} tok/s; PROCESSOR {2}% GPU' -f $metrics.prompt_tokens_per_second, $metrics.generation_tokens_per_second, $metrics.processor_gpu_percent)
  Write-Host ('  free memory with {0} loaded: {1} (floor {2})' -f $modelName, (Format-McBytes $after), (Format-McBytes $script:McHeadroomFloorBytes))
  if ($null -ne $backend) { Write-Host ('  backend: ' + $backend) }

  $measuredPath = Get-McMeasuredPath $StateRoot
  if ($PSCmdlet.ShouldProcess($measuredPath, ('merge the measurement for ' + $modelName))) {
    $json = Merge-McMeasuredInference -ExistingJson (Read-McTextFile $measuredPath) -Metrics $metrics -MeasuredAt ((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')) -NumCtx $numCtx -NumPredict $numPredict -OllamaVersion ([string]$version.version) -BackendNote $backend
    Write-McAtomicFile -Path $measuredPath -Content $json
    Write-Host ('  written: ' + $measuredPath)
  }

  $verdict = Get-McHeadroomVerdict -Tier $tier -ModelName $modelName -FreeAfterBytes $after -Settings $settings
  Write-Host ('  ' + $verdict.Reason)
  $exitCode = 0
  if ($verdict.Action -eq 'refuse') { $exitCode = 1 }
  if ($verdict.Action -eq 'prune' -or $verdict.Action -eq 'advertise') {
    $manifestPath = Get-McManifestPath $StateRoot
    if (-not $RepoPath -and $null -ne $config) { $RepoPath = [string]$config.repo_path }
    $current = Read-McTextFile $manifestPath
    if ($null -eq $current) { Write-Host '  capabilities.json is missing; run -Install first' }
    elseif ($verdict.Action -eq 'prune') {
      if ($PSCmdlet.ShouldProcess($manifestPath, ('remove the {0} entry (under the headroom floor)' -f $script:McTwinImplementation))) {
        $updated = Remove-McManifestImplementation -ManifestJson $current -Implementation $script:McTwinImplementation
        if (Write-McFileIfChanged -Path $manifestPath -Content $updated) { Write-Host ('  {0} removed from capabilities.json; the agent re-reads it within 15 s' -f $script:McTwinImplementation) }
        else { Write-Host ('  {0} was not advertised' -f $script:McTwinImplementation) }
      }
    } else {
      $templateJson = $null
      if ($RepoPath) { $templateJson = Read-McTextFile (Get-McTemplatePath $RepoPath) }
      if ($null -eq $templateJson) { Write-Host '  the template is missing (give -RepoPath); capabilities.json unchanged' }
      elseif ($PSCmdlet.ShouldProcess($manifestPath, ('add the {0} entry back from the template (it fits)' -f $script:McTwinImplementation))) {
        $updated = Add-McManifestImplementation -ManifestJson $current -TemplateJson $templateJson -Implementation $script:McTwinImplementation
        if (Write-McFileIfChanged -Path $manifestPath -Content $updated) { Write-Host ('  {0} added back to capabilities.json; the agent re-reads it within 15 s' -f $script:McTwinImplementation) }
        else { Write-Host ('  {0} was already advertised' -f $script:McTwinImplementation) }
      }
    }
  }
  return [pscustomobject]@{ Metrics = $metrics; Verdict = $verdict; ExitCode = $exitCode; FreeMemoryBeforeBytes = $before; FreeMemoryAfterBytes = $after }
}

function Invoke-McKeepAwake {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$ScriptPath)
  if (-not (Test-McAdministrator)) {
    Write-Host 'Administrator rights are needed. Run this in an elevated PowerShell:'
    Write-Host ('  Start-Process powershell -Verb RunAs -ArgumentList ''-ExecutionPolicy Bypass -File "{0}" -KeepAwake''' -f $ScriptPath)
    return 1
  }
  $queries = @(@('/query', 'SCHEME_CURRENT', 'SUB_SLEEP', 'STANDBYIDLE'), @('/query', 'SCHEME_CURRENT', 'SUB_SLEEP', 'HIBERNATEIDLE'))
  Write-Host 'Before:'
  foreach ($query in $queries) { foreach ($line in @(Invoke-McPowerCfg -Arguments $query | Where-Object { $_ -match 'AC Power Setting|Hibernate|Sleep after' })) { Write-Host ('  ' + $line.Trim()) } }
  if ($PSCmdlet.ShouldProcess('power plan', 'standby-timeout-ac 0 and hibernate-timeout-ac 0')) {
    [void](Invoke-McPowerCfg -Arguments @('/change', 'standby-timeout-ac', '0'))
    [void](Invoke-McPowerCfg -Arguments @('/change', 'hibernate-timeout-ac', '0'))
  }
  Write-Host 'After:'
  foreach ($query in $queries) { foreach ($line in @(Invoke-McPowerCfg -Arguments $query | Where-Object { $_ -match 'AC Power Setting|Hibernate|Sleep after' })) { Write-Host ('  ' + $line.Trim()) } }
  Write-Host 'Lid close and battery behaviour are unchanged; set them in Power Options if the node should keep running on battery.'
  return 0
}

function Invoke-McModelsPath {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$Path)
  if ($PSCmdlet.ShouldProcess($Path, 'create the model store folder and set user-scope OLLAMA_MODELS')) {
    if (-not (Test-Path -LiteralPath $Path)) { New-Item -ItemType Directory -Path $Path -Force | Out-Null }
    $changed = Set-McUserEnvironment -Name 'OLLAMA_MODELS' -Value $Path
    if ($changed) { Write-Host ('OLLAMA_MODELS set to ' + $Path) } else { Write-Host ('OLLAMA_MODELS already ' + $Path) }
  }
  try {
    $drive = New-Object System.IO.DriveInfo((Resolve-Path -LiteralPath $Path).Path)
    Write-Host ('free space on that volume: ' + (Format-McBytes $drive.AvailableFreeSpace))
  } catch { }
  Write-Host 'restart the Ollama tray app (or sign out/in) for Ollama to pick this up'
  return 0
}

function Invoke-McVulkan {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([int]$DeviceIndex)
  $inventory = Get-McGpuInventory
  $index = 0
  foreach ($gpu in @($inventory.Gpus)) {
    Write-Host ('  [{0}] {1} ({2}, {3}, VRAM {4})' -f $index, $gpu.Name, $gpu.Vendor, $gpu.Form, (Format-McBytes $gpu.VramBytes))
    $index++
  }
  if ($PSCmdlet.ShouldProcess('GGML_VK_VISIBLE_DEVICES', ('set user-scope value ' + $DeviceIndex))) {
    $changed = Set-McUserEnvironment -Name 'GGML_VK_VISIBLE_DEVICES' -Value ([string]$DeviceIndex)
    if ($changed) { Write-Host ('GGML_VK_VISIBLE_DEVICES set to ' + $DeviceIndex) } else { Write-Host ('GGML_VK_VISIBLE_DEVICES already ' + $DeviceIndex) }
  }
  Write-Host 'restart the Ollama tray app (or sign out/in) for Ollama to pick this up'
  return 0
}

function Invoke-McBrowserInstall {
  # The node's own browser (slice N2, docs/control-plane/AGENT-NODE-BROWSER.md): the pinned playwright
  # package into <StateRoot>\browser through npm, Chromium through Playwright's own installer after a dry
  # run the owner answers, a policy file with an empty allowlist written once, the persistent profile
  # folder, the browser.cmd launcher, the "McCluster Node Browser" scheduled task, and the
  # browser.act/chromium.local entry from the template. This is the one switch of this script that
  # downloads anything; -WhatIf shows every step and writes nothing; declining the download changes nothing.
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$StateRoot, [string]$RepoPath)
  $config = Read-McNodeConfig $StateRoot
  if ($null -eq $config) { throw 'run -Install first: node.config.json is missing' }
  if (-not $RepoPath) { $RepoPath = [string]$config.repo_path }
  if (-not $RepoPath) { throw '-Browser needs -RepoPath (node.config.json has none)' }
  $templatePath = Get-McTemplatePath $RepoPath
  if (-not (Test-Path -LiteralPath $templatePath)) { throw ('template not found: ' + $templatePath) }
  $executorSource = [System.IO.Path]::Combine($RepoPath, 'core', 'src', 'compute', 'browser-executor.mjs')
  if (-not (Test-Path -LiteralPath $executorSource)) { throw ('browser executor not found in the checkout (pull the latest main): ' + $executorSource) }
  if ($null -eq (Get-McNpmCliPath)) { throw 'npm was not found beside node on PATH; install Node.js 20 or newer (it ships npm) first' }
  Assert-McLauncherValues -NodeName ([string]$config.node_name) -StateRoot $StateRoot -RepoPath $RepoPath -ComputeUrl ([string]$config.compute_url)

  $browserDir = Get-McBrowserDir $StateRoot
  $profileDir = Get-McBrowserProfileDir $StateRoot
  $policyPath = Get-McBrowserPolicyPath $StateRoot
  $browsersPath = Get-McPlaywrightBrowsersPath $StateRoot
  $written = New-Object System.Collections.Generic.List[string]
  Write-Host ('Browser executor for node {0}: playwright {1} into {2}, Chromium into {3}, profile {4}, policy {5}' -f $config.node_name, $script:McPlaywrightVersion, $browserDir, $browsersPath, $profileDir, $policyPath)
  Write-Host '  this switch downloads two things and nothing else in the script does: npm fetches the pinned playwright package from the npm registry; Playwright''s own installer fetches Chromium after the dry run below and your answer.'

  if ($PSCmdlet.ShouldProcess(($browserDir + ', ' + $profileDir), 'create the browser and browser-profile folders, owner-only ACL')) {
    foreach ($directory in @($browserDir, $profileDir)) {
      if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null; $written.Add($directory) }
      if (-not (Invoke-McIcacls -Target $directory -Rights '(OI)(CI)F')) { Write-Host ('  ACL: owner-only ACL not applied to {0} (not Windows or icacls unavailable)' -f $directory) }
    }
  }

  if ($PSCmdlet.ShouldProcess($browserDir, ('npm install --no-save playwright@' + $script:McPlaywrightVersion))) {
    Write-Host ('npm install --prefix {0} --no-audit --no-fund --no-save playwright@{1} (up to 600 s)' -f $browserDir, $script:McPlaywrightVersion)
    $npm = Invoke-McNpm -Arguments @('install', '--prefix', $browserDir, '--no-audit', '--no-fund', '--no-save', ('playwright@' + $script:McPlaywrightVersion)) -WorkingDirectory $browserDir -TimeoutSeconds 600
    if ($npm.TimedOut -or $npm.ExitCode -ne 0) {
      foreach ($line in @(([string]$npm.StdErr -split "`r?`n") | Where-Object { $_ -ne '' } | Select-Object -Last 5)) { Write-Host ('  ' + (Get-McMaskedText $line)) }
      throw ('npm install of playwright@{0} did not finish (exit {1}, timed out {2})' -f $script:McPlaywrightVersion, $npm.ExitCode, $npm.TimedOut)
    }
    $installedVersion = Get-McPlaywrightInstalledVersion $StateRoot
    if ([string]$installedVersion -ne $script:McPlaywrightVersion) { throw ('playwright {0} was expected under {1}, found {2}' -f $script:McPlaywrightVersion, $browserDir, $installedVersion) }
    Write-Host ('  playwright {0} installed' -f $installedVersion)
  }

  if ($PSCmdlet.ShouldProcess($browsersPath, 'dry run, then download Chromium through Playwright''s installer if you say so')) {
    Write-Host 'Dry run (names the Chromium build, its download URL and size; downloads nothing):'
    $dry = Invoke-McPlaywrightCli -StateRoot $StateRoot -Arguments @('install', '--dry-run', 'chromium') -TimeoutSeconds 120
    foreach ($line in @((([string]$dry.StdOut + "`n" + [string]$dry.StdErr) -split "`r?`n") | Where-Object { $_.Trim() -ne '' })) { Write-Host ('  ' + (Get-McMaskedText $line)) }
    if ($dry.TimedOut -or $dry.ExitCode -ne 0) { throw ('the Playwright dry run did not finish (exit {0}, timed out {1})' -f $dry.ExitCode, $dry.TimedOut) }
    $answer = Read-McAnswer 'Download it? [y/N]'
    if ($answer -notmatch '^[Yy]') {
      Write-Host 'Chromium not downloaded; nothing else was changed. Run -Browser again when ready.'
      return [pscustomobject]@{ Installed = $false; Written = @($written.ToArray()); TaskRegistered = $false; ExitCode = 2 }
    }
    Write-Host 'Downloading Chromium through Playwright''s installer (up to 900 s)...'
    $get = Invoke-McPlaywrightCli -StateRoot $StateRoot -Arguments @('install', 'chromium') -TimeoutSeconds 900
    if ($get.TimedOut -or $get.ExitCode -ne 0) {
      foreach ($line in @(([string]$get.StdErr -split "`r?`n") | Where-Object { $_ -ne '' } | Select-Object -Last 5)) { Write-Host ('  ' + (Get-McMaskedText $line)) }
      throw ('the Chromium download did not finish (exit {0}, timed out {1})' -f $get.ExitCode, $get.TimedOut)
    }
  }

  if ($PSCmdlet.ShouldProcess($policyPath, 'write browser-policy.json with an empty allowlist, only when absent')) {
    if (Test-Path -LiteralPath $policyPath) { Write-Host ('  {0} kept as you left it (never overwritten)' -f $policyPath) }
    else {
      Write-McAtomicFile -Path $policyPath -Content (Get-McBrowserPolicyText)
      $written.Add($policyPath)
      Write-Host ('  {0} written: edit allowed_hosts; empty means every open is refused (BROWSER_POLICY_EMPTY)' -f $policyPath)
    }
  }

  $values = Get-McBrowserEnvironment -StateRoot $StateRoot
  $launcherPath = [System.IO.Path]::Combine($StateRoot, 'browser.cmd')
  if ($PSCmdlet.ShouldProcess($launcherPath, 'write launcher')) {
    $text = Get-McLauncherText -Kind 'browser' -Environment $values -RepoPath $RepoPath -StateRoot $StateRoot
    if (Write-McFileIfChanged -Path $launcherPath -Content $text) { $written.Add($launcherPath) }
  }

  $taskRegistered = $false
  if ($PSCmdlet.ShouldProcess($script:McBrowserTaskName, 'register the scheduled task (AtStartup, AtLogOn, 10 s delay, current user) and start it')) {
    $taskRegistered = Register-McScheduledTasks -StateRoot $StateRoot -UserId (Get-McCurrentUserId) -Browser
    if ($taskRegistered) { [void](Start-McScheduledTask -Name $script:McBrowserTaskName) }
    else { Write-Host '  scheduled task: not registered (not Windows)' }
  }

  $manifestPath = Get-McManifestPath $StateRoot
  if ($PSCmdlet.ShouldProcess($manifestPath, ('add the {0} entry from the template and record browser=true in node.config.json' -f $script:McBrowserImplementation))) {
    $current = Read-McTextFile $manifestPath
    if ($null -eq $current) { throw 'capabilities.json is missing; run -Install first' }
    $updated = Add-McManifestImplementation -ManifestJson $current -TemplateJson (Read-McTextFile $templatePath) -Implementation $script:McBrowserImplementation
    if (Write-McFileIfChanged -Path $manifestPath -Content $updated) { $written.Add($manifestPath); Write-Host ('  {0} added to capabilities.json; the agent re-reads it within 15 s' -f $script:McBrowserImplementation) }
    else { Write-Host ('  {0} was already advertised' -f $script:McBrowserImplementation) }
    if (Set-McNodeConfigValue -StateRoot $StateRoot -Name 'browser' -Value $true) { $written.Add((Get-McNodeConfigPath $StateRoot)) }
  }

  Write-Host ('Browser install done: {0} file(s) or folder(s) written, scheduled task {1}.' -f $written.Count, $(if ($taskRegistered) { 'registered' } else { 'not registered' }))
  Write-Host ('Next: name the sites the agent may open in {0} (allowed_hosts), sign the profile into them with -BrowserHeaded, then turn on "Use the browser" in Control for a turn.' -f $policyPath)
  return [pscustomobject]@{ Installed = $true; Written = @($written.ToArray()); TaskRegistered = $taskRegistered; ExitCode = 0 }
}

function Invoke-McBrowserHeaded {
  # Signs the node's own profile into sites by hand: the scheduled task is stopped, the executor runs on this
  # console with MCCLUSTER_BROWSER_HEADED=1 (a visible Chromium on the same persistent profile) until Ctrl+C,
  # then the task is started again. Nothing from the owner's own browsers is read: the profile is the node's.
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$StateRoot, [string]$RepoPath)
  $config = Read-McNodeConfig $StateRoot
  if ($null -eq $config) { throw 'run -Install first: node.config.json is missing' }
  if ($config.browser -ne $true) { throw 'run -Browser first: this node has no browser executor installed' }
  if (-not $RepoPath) { $RepoPath = [string]$config.repo_path }
  if (-not $RepoPath) { throw '-BrowserHeaded needs -RepoPath (node.config.json has none)' }
  $executorSource = [System.IO.Path]::Combine($RepoPath, 'core', 'src', 'compute', 'browser-executor.mjs')
  if (-not (Test-Path -LiteralPath $executorSource)) { throw ('browser executor not found in the checkout: ' + $executorSource) }
  $values = Get-McBrowserEnvironment -StateRoot $StateRoot
  $environment = @{}
  foreach ($key in $values.Keys) { $environment[[string]$key] = [string]$values[$key] }
  $environment['MCCLUSTER_BROWSER_HEADED'] = '1'
  if (-not $PSCmdlet.ShouldProcess($script:McBrowserTaskName, 'stop the task, run the executor headed on this console until Ctrl+C, start the task again')) { return 0 }
  [void](Stop-McScheduledTask -Name $script:McBrowserTaskName)
  Write-Host 'Headed browser executor on this console: sign the node''s profile into the allowed sites in the Chromium window, then press Ctrl+C here.'
  Write-Host ('If this console closes before the task restarts, start "{0}" from Task Scheduler, or run -Report to check it.' -f $script:McBrowserTaskName)
  $result = $null
  try { $result = Invoke-McNodeProcess -Script $executorSource -Environment $environment -WorkingDirectory ([System.IO.Path]::Combine($RepoPath, 'core')) -TimeoutSeconds 0 -Interactive }
  finally { [void](Start-McScheduledTask -Name $script:McBrowserTaskName) }
  $exit = 'unknown'
  if ($null -ne $result) { $exit = [string]$result.ExitCode }
  Write-Host ('headed session ended (exit {0}); the scheduled task was started again' -f $exit)
  return 0
}

# ---- contribution actions: pause, resume, limits, revoke, uninstall ----------------------------
function Invoke-McPause {
  # The marker the agent honours within one poll: no new claim, running work finishes, heartbeat paused=true.
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$StateRoot)
  if ($null -eq (Read-McNodeConfig $StateRoot)) { throw 'run -Install first: node.config.json is missing' }
  $marker = Get-McPausedPath $StateRoot
  if (Test-Path -LiteralPath $marker) { Write-Host 'Already paused (marker present).'; return 0 }
  if ($PSCmdlet.ShouldProcess($marker, 'write the pause marker')) {
    Write-McAtomicFile -Path $marker -Content ((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') + "`r`n")
    Write-Host 'Paused: the agent stops claiming within one poll (running work finishes) and its heartbeat says paused=true. -Resume lifts it.'
  }
  return 0
}

function Invoke-McResume {
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$StateRoot)
  $marker = Get-McPausedPath $StateRoot
  if (-not (Test-Path -LiteralPath $marker)) { Write-Host 'Not paused (no marker).'; return 0 }
  if ($PSCmdlet.ShouldProcess($marker, 'remove the pause marker')) {
    Remove-Item -LiteralPath $marker -Force
    Write-Host 'Resumed: the agent claims again within one poll.'
  }
  return 0
}

function Invoke-McLimits {
  # Writes limits.json, re-registers the two tasks to match (idle-only, AC-only) and sets the manifest's leases.
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$StateRoot, [bool]$IdleOnly, [bool]$OnACOnly, [int]$MaxConcurrency, [int]$CpuBusyPercent, [int]$BatteryFloorPercent, [int]$ThermalLimitC)
  $config = Read-McNodeConfig $StateRoot
  if ($null -eq $config) { throw 'run -Install first: node.config.json is missing' }
  $limits = New-McLimits -IdleOnly $IdleOnly -OnACOnly $OnACOnly -MaxConcurrency $MaxConcurrency -CpuBusyPercent $CpuBusyPercent -BatteryFloorPercent $BatteryFloorPercent -ThermalLimitC $ThermalLimitC
  $thermalReading = Get-McThermalReading
  $thermalSupported = ($null -ne $thermalReading)
  $summary = Format-McLimitsSummary -Limits (ConvertFrom-McLimits -Text (ConvertTo-McLimitsJson $limits)) -ThermalSupported $thermalSupported
  Write-Host ('Limits: ' + $summary)
  if ($null -ne $limits.thermal_limit_c -and -not $thermalSupported) { Write-Host '  thermal: unsupported on this device (no readable thermal zone); the limit is kept, reported as unsupported by the agent, and never silently dropped' }
  $written = New-Object System.Collections.Generic.List[string]
  $limitsPath = Get-McLimitsPath $StateRoot
  if ($PSCmdlet.ShouldProcess($limitsPath, 'write limits.json')) {
    if (Write-McFileIfChanged -Path $limitsPath -Content (ConvertTo-McLimitsJson $limits)) { $written.Add($limitsPath) }
  }
  $manifestPath = Get-McManifestPath $StateRoot
  if ($PSCmdlet.ShouldProcess($manifestPath, ('set max_leases and max_concurrency to ' + $MaxConcurrency))) {
    $current = Read-McTextFile $manifestPath
    if ($null -eq $current) { Write-Host '  capabilities.json is missing; run -Install first' }
    elseif (Write-McFileIfChanged -Path $manifestPath -Content (Set-McManifestConcurrency -ManifestJson $current -MaxConcurrency $MaxConcurrency)) { $written.Add($manifestPath); Write-Host ('  capabilities.json: max_leases {0}; the agent re-reads it within 15 s' -f $MaxConcurrency) }
  }
  $plan = Get-McTaskSettingsPlan -Limits (ConvertFrom-McLimits -Text (ConvertTo-McLimitsJson $limits))
  $tasksRegistered = $false
  Write-Host ('  scheduled tasks: ' + (Format-McTaskSettingsPlan $plan))
  if ($PSCmdlet.ShouldProcess(($script:McTaskNames -join ', '), ('re-register: ' + (Format-McTaskSettingsPlan $plan)))) {
    $tasksRegistered = Register-McScheduledTasks -StateRoot $StateRoot -UserId (Get-McCurrentUserId) -TaskSettings $plan
    if (-not $tasksRegistered) { Write-Host '  scheduled tasks: not re-registered (not Windows)' }
    elseif ($plan.IdleSentinel) { Write-Host ('  idle-only: "{0}" is not started now (you are at the keyboard); it starts at the next startup or logon once the device has been idle {1} min. Until it runs, an agent that cannot measure the console''s input refuses claims with idle_unknown.' -f $script:McIdleTaskName, $plan.IdleDurationMinutes) }
  }
  Write-Host ('Limits done: {0} file(s) written, scheduled tasks {1}. The agent enforces them before every claim and reports them in heartbeat labels.' -f $written.Count, $(if ($tasksRegistered) { 're-registered' } else { 'unchanged' }))
  return [pscustomobject]@{ Limits = $limits; Plan = $plan; Written = @($written.ToArray()); TasksRegistered = $tasksRegistered; ThermalSupported = $thermalSupported; ExitCode = 0 }
}

function Get-McProcessList {
  # ProcessId, ParentProcessId and CommandLine of every process this user may see (empty off Windows or on error).
  if (-not (Test-McWindowsOnly)) { return @() }
  try { return @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop | Select-Object ProcessId, ParentProcessId, CommandLine) } catch { return @() }
}

function Select-McNodeProcessIds {
  # The processes that belong to THIS state root: every cmd.exe whose command line runs
  # <StateRoot>\adapter.cmd, agent.cmd or browser.cmd, and everything below it (the node.exe the launcher
  # started). Children come first so a parent is not killed before its tree is known. Pure.
  param($Processes, [string]$StateRoot)
  $ids = New-Object System.Collections.Generic.List[int]
  if (-not $StateRoot) { return @() }
  $launcherRoot = $StateRoot.Replace('/', '\').TrimEnd('\') + '\'
  $launchers = @('adapter.cmd', 'agent.cmd', 'browser.cmd') | ForEach-Object { $launcherRoot + $_ }
  $roots = New-Object System.Collections.Generic.List[int]
  foreach ($process in @($Processes)) {
    if ($null -eq $process -or -not $process.CommandLine) { continue }
    # Match the scheduled task's cmd.exe /c invocation. An editor viewing a launcher is not its owner.
    if ($process.CommandLine -notmatch '^\s*(?:"(?:[^"]*\\)?cmd\.exe"|(?:[^\s"]*\\)?cmd\.exe)\s+/c\s+(?:"([^"]+)"|([^\s"]+))\s*$') { continue }
    $launcher = ([string]$Matches[1] + [string]$Matches[2]).Replace('/', '\')
    if ($launchers -contains $launcher) { $roots.Add([int]$process.ProcessId) }
  }
  $queue = New-Object System.Collections.Generic.Queue[int]
  foreach ($root in $roots) { $queue.Enqueue($root) }
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if ($ids.Contains($current)) { continue }
    $ids.Add($current)
    foreach ($process in @($Processes)) {
      if ($null -ne $process -and [int]$process.ParentProcessId -eq $current -and [int]$process.ProcessId -ne $current) { $queue.Enqueue([int]$process.ProcessId) }
    }
  }
  $ordered = @($ids.ToArray())
  [array]::Reverse($ordered)
  return $ordered
}

function Stop-McProcessById {
  param([int]$Id)
  try { Stop-Process -Id $Id -Force -ErrorAction Stop; return $true } catch { return $false }
}

function Stop-McNodeProcesses {
  # Unregistering a task does not end what it started: the launcher's node.exe can still hold files under the
  # state root. Ends this state root's launcher trees; returns the process ids it ended.
  param([string]$StateRoot)
  $stopped = New-Object System.Collections.Generic.List[int]
  foreach ($id in @(Select-McNodeProcessIds -Processes (Get-McProcessList) -StateRoot $StateRoot)) {
    if ($id -eq $PID) { continue }
    if (Stop-McProcessById -Id $id) { $stopped.Add($id) }
  }
  return @($stopped.ToArray())
}

function Remove-McFileOnce {
  param([string]$Path)
  Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
}

function Remove-McFileVerified {
  # Deletes a file and returns $true only when Test-Path says it is gone. A failed delete is retried
  # ($script:McDeleteAttempts times, $script:McDeleteRetryMs apart), ending this state root's node processes
  # again before each retry.
  param([string]$Path, [string]$StateRoot)
  for ($attempt = 1; $attempt -le $script:McDeleteAttempts; $attempt++) {
    if (-not (Test-Path -LiteralPath $Path)) { return $true }
    try { Remove-McFileOnce -Path $Path } catch { }
    if (-not (Test-Path -LiteralPath $Path)) { return $true }
    if ($attempt -lt $script:McDeleteAttempts) {
      if ($StateRoot) { [void](Stop-McNodeProcesses -StateRoot $StateRoot) }
      Start-Sleep -Milliseconds $script:McDeleteRetryMs
    }
  }
  return (-not (Test-Path -LiteralPath $Path))
}

function Invoke-McRevoke {
  # Stops and removes the tasks, records the revocation, deletes the node's key, prints the node id (only).
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$StateRoot)
  $nodeId = Read-McIdentityNodeId $StateRoot
  $identityPath = Get-McIdentityPath $StateRoot
  if ($null -eq $nodeId -and -not (Test-Path -LiteralPath $identityPath)) { Write-Host 'No identity.json under the state root: nothing to revoke locally.' }
  $removed = @()
  $allTasks = $script:McTaskNames + @($script:McBrowserTaskName, $script:McIdleTaskName)
  if ($PSCmdlet.ShouldProcess($allTasks -join ', ', 'stop and unregister the scheduled tasks')) {
    $removed = @(Unregister-McScheduledTasks -Names $allTasks)
    Write-Host ('  scheduled tasks removed: {0}' -f $(if ($removed.Count -gt 0) { $removed -join ', ' } else { 'none registered (or not Windows)' }))
  }
  $revokedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  $identityDeleted = $true
  if ($null -ne $nodeId -or (Test-Path -LiteralPath $identityPath)) {
    if ($PSCmdlet.ShouldProcess($identityPath, 'stop the node processes, delete identity.json, verify it is gone, then write revoked.json (node id, time)')) {
      $stopped = @(Stop-McNodeProcesses -StateRoot $StateRoot)
      if ($stopped.Count -gt 0) { Write-Host ('  node processes stopped: {0}' -f $stopped.Count) }
      $identityDeleted = Remove-McFileVerified -Path $identityPath -StateRoot $StateRoot
      Remove-Item -LiteralPath (Get-McEnrollFilePath $StateRoot) -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath (Get-McHeartbeatPath $StateRoot) -Force -ErrorAction SilentlyContinue
      if (-not $identityDeleted) {
        # The key is still on this machine: say so, write no revocation record that claims otherwise, exit non-zero.
        Write-Host ('REVOKE FAILED: identity.json is STILL PRESENT at {0} after {1} attempts (a process holds it open, or the ACL refuses the delete).' -f $identityPath, $script:McDeleteAttempts)
        Write-Host '  The node''s private key is still on this machine. Close anything using the state root, then run -Revoke again or delete that file by hand.'
        if ($null -ne $nodeId) { Write-Host ('  Revoke the node on the Core regardless: node_id {0}' -f $nodeId) }
        return [pscustomobject]@{ NodeId = $nodeId; TasksRemoved = @($removed); RevokedAt = $null; IdentityDeleted = $false; ExitCode = 2 }
      }
      Write-McAtomicFile -Path (Get-McRevokedPath $StateRoot) -Content (ConvertTo-McRevokedJson -NodeId $nodeId -RevokedAt $revokedAt)
      Write-Host '  identity.json deleted (verified absent: the node''s key is gone from this machine)'
    }
  }
  if ($null -ne $nodeId) {
    Write-Host ('Revoked locally. Now revoke this node on the Core: node_id {0}' -f $nodeId)
    Write-Host '  (the owner tool of #821; direct SQL on ops_compute_nodes until it is promoted)'
  } else { Write-Host 'Revoked locally; no node id was recorded here (identity.json absent or unreadable).' }
  return [pscustomobject]@{ NodeId = $nodeId; TasksRemoved = @($removed); RevokedAt = $revokedAt; IdentityDeleted = (-not (Test-Path -LiteralPath $identityPath)); ExitCode = 0 }
}

function Invoke-McUninstall {
  # -Revoke semantics, then the state root and the user-scope variables -Install wrote are removed.
  [CmdletBinding(SupportsShouldProcess = $true)]
  param([string]$StateRoot)
  $revoke = Invoke-McRevoke -StateRoot $StateRoot
  $cleared = New-Object System.Collections.Generic.List[string]
  if ($PSCmdlet.ShouldProcess('user-scope environment', 'clear the MCCLUSTER_* / OLLAMA_KEEP_ALIVE variables -Install wrote')) {
    foreach ($name in (Get-McInstalledVariableNames)) {
      if (Set-McUserEnvironment -Name $name -Value '') { $cleared.Add($name) }
    }
  }
  $rootRemoved = $false
  $exitCode = 0
  if (Test-Path -LiteralPath $StateRoot) {
    if ($PSCmdlet.ShouldProcess($StateRoot, 'remove the state root (manifest, config, launchers, logs, browser profile)')) {
      try { Remove-Item -LiteralPath $StateRoot -Recurse -Force -ErrorAction Stop } catch { Write-Host ('  state root not fully removed: {0}' -f $_.Exception.Message) }
      $rootRemoved = (-not (Test-Path -LiteralPath $StateRoot))
      if (-not $rootRemoved) { $exitCode = 2 }
    }
  }
  # Never "uninstalled" over a key that is still there: the revoke failure stands unless the root removal took it.
  # (A -WhatIf run deleted nothing on purpose and is not a failure.)
  $identityLeft = (Test-Path -LiteralPath (Get-McIdentityPath $StateRoot))
  if ($identityLeft -and -not $WhatIfPreference) {
    $exitCode = 2
    Write-Host ('UNINSTALL INCOMPLETE: identity.json (the node''s private key) is STILL PRESENT at {0}. Close anything using the state root and run -Uninstall again, or delete it by hand.' -f (Get-McIdentityPath $StateRoot))
  }
  Write-Host ('Uninstalled: state root {0}, {1} user variable(s) cleared.' -f $(if ($rootRemoved) { 'removed' } elseif ($exitCode -ne 0) { 'NOT removed' } else { 'not present or kept' }), $cleared.Count)
  if ($null -ne $revoke.NodeId) { Write-Host ('Remember to revoke node_id {0} on the Core.' -f $revoke.NodeId) }
  return [pscustomobject]@{ NodeId = $revoke.NodeId; TasksRemoved = $revoke.TasksRemoved; RootRemoved = $rootRemoved; EnvironmentCleared = @($cleared.ToArray()); IdentityDeleted = (-not $identityLeft); ExitCode = $exitCode }
}

# ---- dispatcher (not reached when the tests load this file as a library) -----------------------
if ($env:MCCLUSTER_NODE_PS_LIBRARY -eq '1') { return }

$resolvedStateRoot = Get-McStateRoot $StateRoot
$actions = New-Object System.Collections.Generic.List[string]
if ($Install) { $actions.Add('install') }
if ($Enroll) { $actions.Add('enroll') }
if ($Models) { $actions.Add('models') }
if ($Benchmark) { $actions.Add('benchmark') }
if ($KeepAwake) { $actions.Add('keepawake') }
if ($Browser) { $actions.Add('browser') }
if ($BrowserHeaded) { $actions.Add('browserheaded') }
if ($ModelsPath) { $actions.Add('modelspath') }
if ($PSBoundParameters.ContainsKey('Vulkan')) { $actions.Add('vulkan') }
if ($Pause) { $actions.Add('pause') }
if ($Resume) { $actions.Add('resume') }
if ($Limits) { $actions.Add('limits') }
if ($Revoke) { $actions.Add('revoke') }
if ($Uninstall) { $actions.Add('uninstall') }
if ($Report) { $actions.Add('report') }
if ($actions.Count -gt 1) { throw ('one action per run; got: ' + ($actions -join ', ')) }
$action = 'report'
if ($actions.Count -eq 1) { $action = $actions[0] }

$exitCode = 0
switch ($action) {
  'install' { [void](Invoke-McInstall -RepoPath $RepoPath -StateRoot $resolvedStateRoot -NodeName $NodeName -OrgId $OrgId -ComputeUrl $ComputeUrl -TierOverride $Tier) }
  'enroll' { $exitCode = [int](Invoke-McEnroll -StateRoot $resolvedStateRoot -RepoPath $RepoPath) }
  'models' { $exitCode = [int](Invoke-McModels -StateRoot $resolvedStateRoot -ModelOverride $Model) }
  'benchmark' { $exitCode = [int](Invoke-McBenchmark -StateRoot $resolvedStateRoot -ModelOverride $Model -RepoPath $RepoPath).ExitCode }
  'keepawake' { $exitCode = [int](Invoke-McKeepAwake -ScriptPath $MyInvocation.MyCommand.Path) }
  'browser' { $exitCode = [int](Invoke-McBrowserInstall -StateRoot $resolvedStateRoot -RepoPath $RepoPath).ExitCode }
  'browserheaded' { $exitCode = [int](Invoke-McBrowserHeaded -StateRoot $resolvedStateRoot -RepoPath $RepoPath) }
  'modelspath' { $exitCode = [int](Invoke-McModelsPath -Path $ModelsPath) }
  'vulkan' { $exitCode = [int](Invoke-McVulkan -DeviceIndex $Vulkan) }
  'pause' { $exitCode = [int](Invoke-McPause -StateRoot $resolvedStateRoot) }
  'resume' { $exitCode = [int](Invoke-McResume -StateRoot $resolvedStateRoot) }
  'limits' { $exitCode = [int](Invoke-McLimits -StateRoot $resolvedStateRoot -IdleOnly ([bool]$IdleOnly) -OnACOnly ([bool]$OnACOnly) -MaxConcurrency $MaxConcurrency -CpuBusyPercent $CpuBusyPercent -BatteryFloorPercent $BatteryFloorPercent -ThermalLimitC $ThermalLimitC).ExitCode }
  'revoke' { $exitCode = [int](Invoke-McRevoke -StateRoot $resolvedStateRoot).ExitCode }
  'uninstall' { $exitCode = [int](Invoke-McUninstall -StateRoot $resolvedStateRoot).ExitCode }
  default { Invoke-McReport -StateRoot $resolvedStateRoot }
}
exit $exitCode
