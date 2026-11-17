#Requires -Version 5.1
<#
Pester-free tests for core\windows\mccluster-node.ps1. Run from any platform that has a PowerShell:

  pwsh -NoProfile -NonInteractive -File core/windows/tests/mccluster-node.tests.ps1

The doctor is dot-sourced as a library (MCCLUSTER_NODE_PS_LIBRARY=1, so its dispatcher never
runs), and every Windows-only wrapper it calls (CIM, registry, memory, scheduled tasks, icacls,
user environment) is redefined here by name, over the recorded fixtures in .\fixtures. Nothing
here touches the host: files go to a temporary -StateRoot that is removed at the end.
Exit code 0 means every check passed; the summary names every failure.
scripts/test/windows-node-script.test.mjs runs this file where a pwsh is executable and otherwise
reports it as unverified.
#>
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = Join-Path (Split-Path -Parent $here) 'mccluster-node.ps1'
$fixtureDir = Join-Path $here 'fixtures'
$repoRoot = (Resolve-Path (Join-Path $here '..' | Join-Path -ChildPath '..' | Join-Path -ChildPath '..')).Path
$templatePath = [System.IO.Path]::Combine($repoRoot, 'core', 'node-manifests', 'owner-windows-gpu.json')
$env:MCCLUSTER_NODE_PS_LIBRARY = '1'
. $scriptPath

$script:Passed = 0
$script:Failed = 0
$script:Failures = New-Object System.Collections.Generic.List[string]

function Assert-Equal {
  param($Expected, $Actual, [string]$Name)
  if ("$Expected" -ceq "$Actual") {
    $script:Passed++
    Write-Output ('ok   ' + $Name)
  } else {
    $script:Failed++
    $script:Failures.Add($Name)
    Write-Output ('FAIL ' + $Name + ': expected <' + "$Expected" + '> got <' + "$Actual" + '>')
  }
}
function Assert-True {
  param($Condition, [string]$Name)
  Assert-Equal -Expected $true -Actual ([bool]$Condition) -Name $Name
}
function Assert-Null {
  param($Value, [string]$Name)
  Assert-Equal -Expected $true -Actual ($null -eq $Value) -Name $Name
}

function Read-Fixture {
  param([string]$Name)
  return [System.IO.File]::ReadAllText((Join-Path $fixtureDir $Name))
}
function Read-CimFixture {
  param([string]$Name)
  $parsed = (Read-Fixture $Name) | ConvertFrom-Json
  return @($parsed)
}

# ---- mocks for the Windows-only wrappers -------------------------------------------------------
$script:MockControllers = @()
$script:MockRegistry = @()
$script:MockMemory = $null
$script:MockUserEnvironment = @{}
$script:MockIcaclsCalls = New-Object System.Collections.Generic.List[string]
$script:MockTaskRegistrations = 0
function Get-McCimVideoControllers { return @($script:MockControllers) }
function Get-McRegistryDisplayEntries { return @($script:MockRegistry) }
function Get-McMemoryInfo { return $script:MockMemory }
function Set-McUserEnvironment {
  param([string]$Name, [string]$Value)
  if ($script:MockUserEnvironment.ContainsKey($Name) -and ([string]$script:MockUserEnvironment[$Name] -ceq $Value)) { return $false }
  $script:MockUserEnvironment[$Name] = $Value
  return $true
}
function Invoke-McIcacls {
  param([string]$Target, [string]$Rights)
  $script:MockIcaclsCalls.Add($Target + ' ' + $Rights)
  return $true
}
function Register-McScheduledTasks {
  param([string]$StateRoot, [string]$UserId)
  $script:MockTaskRegistrations++
  return $true
}
function Use-Fixture {
  param([string]$Cim, [string]$Reg, [int64]$FreeBytes = 12000000000)
  $script:MockControllers = @()
  if ($Cim) { $script:MockControllers = Read-CimFixture $Cim }
  $script:MockRegistry = @()
  if ($Reg) { $script:MockRegistry = @(ConvertFrom-McRegQueryText (Read-Fixture $Reg)) }
  $script:MockMemory = [pscustomobject]@{ TotalBytes = [int64]17179869184; FreeBytes = $FreeBytes }
}

# ---- qwMemorySize conversion -------------------------------------------------------------------
Assert-Equal 8589934592 (ConvertTo-McInt64 ([int64]8589934592)) 'int64 passes through'
Assert-Equal 8589934592 (ConvertTo-McInt64 '0x200000000') 'REG_QWORD hex string 0x200000000 is 8 GiB'
Assert-Equal 536870912 (ConvertTo-McInt64 '0x20000000') 'REG_QWORD hex string 0x20000000 is 512 MiB'
Assert-Equal 536870912 (ConvertTo-McInt64 '536870912') 'decimal string converts'
Assert-Equal 4293918720 (ConvertTo-McInt64 ([double]4293918720)) 'double converts (CIM AdapterRAM arrives as a number)'
Assert-Null (ConvertTo-McInt64 $null) 'null stays null'
Assert-Null (ConvertTo-McInt64 'abc') 'junk is null'
Assert-Equal 7 (ConvertTo-McInt64 @(7, 8)) 'an array takes its first element'
Assert-Equal '8.0 GiB' (Format-McBytes 8589934592) 'formats GiB'
Assert-Equal '512 MiB' (Format-McBytes 536870912) 'formats MiB'

# ---- reg query text parser ---------------------------------------------------------------------
$twoEntries = @(ConvertFrom-McRegQueryText (Read-Fixture 'reg-780m-rx7600s.txt'))
Assert-Equal 2 $twoEntries.Count 'reg-780m-rx7600s.txt has two display subkeys'
Assert-Equal '0000' $twoEntries[0].Subkey 'first subkey is 0000'
Assert-Equal 'AMD Radeon 780M Graphics' $twoEntries[0].DriverDesc 'DriverDesc of 0000'
Assert-Equal 'PCI\VEN_1002&DEV_15BF&SUBSYS_8B4A103C' $twoEntries[0].MatchingDeviceId 'MatchingDeviceId of 0000, upper-cased, backslash kept'
Assert-Equal 536870912 $twoEntries[0].QwMemorySize 'qwMemorySize of the 780M from 0x20000000'
Assert-Equal 8589934592 $twoEntries[1].QwMemorySize 'qwMemorySize of the RX 7600S from 0x200000000'
Assert-Equal '32.0.13031.3015' $twoEntries[1].DriverVersion 'DriverVersion of 0001'
Assert-Equal 0 (@(ConvertFrom-McRegQueryText (Read-Fixture 'reg-no-gpu.txt')).Count) 'reg-no-gpu.txt has no display subkey (the access-denied line is ignored)'
Assert-Equal 0 (@(ConvertFrom-McRegQueryText '').Count) 'empty text parses to nothing'
Assert-Equal 1 (@(ConvertFrom-McRegQueryText (Read-Fixture 'reg-nvidia-desktop.txt')).Count) 'reg-nvidia-desktop.txt has one subkey'

# ---- vendor, form, memory ----------------------------------------------------------------------
Assert-Equal '1002' (Get-McVendorId 'PCI\VEN_1002&DEV_15BF&SUBSYS_8B4A103C&REV_C1\3&11583659&0&08') 'vendor id from the PNP id'
Assert-Equal 'amd' (Get-McVendor '1002' '') 'VEN_1002 is amd'
Assert-Equal 'nvidia' (Get-McVendor '10DE' '') 'VEN_10DE is nvidia'
Assert-Equal 'intel' (Get-McVendor '8086' '') 'VEN_8086 is intel'
Assert-Equal 'amd' (Get-McVendor $null 'Advanced Micro Devices, Inc.') 'AdapterCompatibility fallback for amd'
Assert-Equal 'unknown' (Get-McVendor $null '(Standard display types)') 'unknown vendor'
Assert-Equal 'integrated' (Get-McGpuForm 'amd' 'AMD Radeon 780M Graphics') '780M is integrated'
Assert-Equal 'discrete' (Get-McGpuForm 'amd' 'AMD Radeon RX 7600S') 'RX 7600S is discrete'
Assert-Equal 'integrated' (Get-McGpuForm 'amd' 'AMD Radeon(TM) Graphics') 'Radeon(TM) Graphics is integrated'
Assert-Equal 'unknown' (Get-McGpuForm 'amd' 'AMD Radeon Something') 'an unnamed amd adapter is unknown'
Assert-Equal 'discrete' (Get-McGpuForm 'nvidia' 'NVIDIA GeForce RTX 4070') 'nvidia is discrete'
Assert-Equal 'discrete' (Get-McGpuForm 'intel' 'Intel(R) Arc(TM) A770 Graphics') 'Arc A770 is discrete'
Assert-Equal 'integrated' (Get-McGpuForm 'intel' 'Intel(R) Iris(R) Xe Graphics') 'Iris Xe is integrated'
Assert-Equal 'unknown' (Get-McGpuForm 'unknown' 'Whatever') 'unknown vendor is unknown form'
Assert-True (Test-McThinkModel 'qwen3:8b') 'qwen3:8b takes the think key'
Assert-True (Test-McThinkModel 'qwen3:14b') 'qwen3:14b takes the think key'
Assert-Equal $false (Test-McThinkModel 'qwen3:4b-instruct-2507-q4_K_M') 'an instruct build does not'

# ---- GPU selection over the fixtures -----------------------------------------------------------
Use-Fixture -Cim 'cim-780m-only.json' -Reg 'reg-780m-only.txt'
$inventory = Get-McGpuInventory
Assert-Equal 1 (@($inventory.Gpus).Count) '780M only: one GPU'
$gpu = @($inventory.Gpus)[0]
Assert-Equal 'amd' $gpu.Vendor '780M only: vendor amd'
Assert-Equal 'AMD Radeon 780M Graphics' $gpu.Name '780M only: name'
Assert-Equal 'integrated' $gpu.Form '780M only: integrated'
Assert-Equal 'shared' $gpu.Memory '780M only: shared memory'
Assert-Equal 536870912 $gpu.VramBytes '780M only: VRAM from the registry QWORD'
Assert-Equal 'registry' $gpu.VramSource '780M only: vram_source registry'
Assert-Equal 'vulkan' $gpu.Compute '780M only: compute vulkan'
Assert-Equal '32.0.13031.3015' $gpu.DriverVersion '780M only: driver'
Assert-Equal $false $gpu.AdapterRamWrapped '780M only: AdapterRAM did not wrap'
Assert-Equal 0 (@($inventory.Ignored).Count) '780M only: nothing ignored'
$primary = Select-McPrimaryGpu $inventory.Gpus
Assert-Equal 'AMD Radeon 780M Graphics' $primary.Name '780M only: the integrated adapter is chosen'
Assert-Equal 'C' (Get-McModelTier -Gpu $primary -FreePhysicalMemoryBytes 12000000000) '780M only with 12 GB free: tier C'
Assert-Equal 'D' (Get-McModelTier -Gpu $primary -FreePhysicalMemoryBytes 6000000000) '780M only with 6 GB free: tier D'

Use-Fixture -Cim 'cim-780m-rx7600s.json' -Reg 'reg-780m-rx7600s.txt'
$inventory = Get-McGpuInventory
Assert-Equal 2 (@($inventory.Gpus).Count) '780M + RX 7600S: two GPUs in CIM order'
$second = @($inventory.Gpus)[1]
Assert-Equal 'AMD Radeon RX 7600S' $second.Name '780M + RX 7600S: second is the RX 7600S'
Assert-Equal 'discrete' $second.Form 'RX 7600S: discrete'
Assert-Equal 'dedicated' $second.Memory 'RX 7600S: dedicated memory'
Assert-Equal 8589934592 $second.VramBytes 'RX 7600S: 8 GiB from the registry, not the wrapped AdapterRAM'
Assert-Equal 'registry' $second.VramSource 'RX 7600S: vram_source registry'
Assert-Equal 4293918720 $second.AdapterRamBytes 'RX 7600S: the wrapped uint32 is kept for the report'
Assert-True $second.AdapterRamWrapped 'RX 7600S: AdapterRAM wrapped is reported'
$primary = Select-McPrimaryGpu $inventory.Gpus
Assert-Equal 'AMD Radeon RX 7600S' $primary.Name '780M + RX 7600S: the discrete adapter is chosen'
Assert-Equal 'B' (Get-McModelTier -Gpu $primary -FreePhysicalMemoryBytes 12000000000) '780M + RX 7600S: tier B at 8 GiB'

Use-Fixture -Cim 'cim-nvidia-desktop.json' -Reg 'reg-nvidia-desktop.txt'
$inventory = Get-McGpuInventory
$gpu = @($inventory.Gpus)[0]
Assert-Equal 'nvidia' $gpu.Vendor 'RTX 4070: nvidia'
Assert-Equal 12884901888 $gpu.VramBytes 'RTX 4070: 12 GiB from the registry'
Assert-Equal 'cuda' $gpu.Compute 'RTX 4070: compute cuda'
Assert-Equal 'discrete' $gpu.Form 'RTX 4070: discrete'
Assert-Equal 'A' (Get-McModelTier -Gpu (Select-McPrimaryGpu $inventory.Gpus) -FreePhysicalMemoryBytes 12000000000) 'RTX 4070: tier A'

Use-Fixture -Cim 'cim-no-gpu.json' -Reg 'reg-no-gpu.txt'
$inventory = Get-McGpuInventory
Assert-Equal 0 (@($inventory.Gpus).Count) 'Basic Display Adapter: no GPU'
Assert-Equal 'Microsoft Basic Display Adapter' (@($inventory.Ignored) -join ',') 'Basic Display Adapter: ignored by name'
Assert-Null (Select-McPrimaryGpu $inventory.Gpus) 'Basic Display Adapter: no primary GPU'
Assert-Equal 'D' (Get-McModelTier -Gpu $null -FreePhysicalMemoryBytes 12000000000) 'no GPU: tier D'

$registryWithoutCim = Merge-McGpuInventory -Controllers @([pscustomobject]@{ Name = 'AMD Radeon 780M Graphics'; AdapterCompatibility = 'Advanced Micro Devices, Inc.'; DriverVersion = ''; PNPDeviceID = 'PCI\VEN_1002&DEV_15BF&SUBSYS_8B4A103C&REV_C1\3&11583659&0&08'; AdapterRAM = 536870912; VideoProcessor = $null; Status = 'OK' }) -RegistryEntries @()
Assert-Equal 'cim' (@($registryWithoutCim.Gpus)[0].VramSource) 'without a registry match the CIM AdapterRAM is the source'
$byName = Merge-McGpuInventory -Controllers @([pscustomobject]@{ Name = 'AMD Radeon 780M Graphics'; AdapterCompatibility = 'Advanced Micro Devices, Inc.'; DriverVersion = ''; PNPDeviceID = 'PCI\VEN_1002&DEV_FFFF&SUBSYS_0000&REV_00\0'; AdapterRAM = 0; VideoProcessor = $null; Status = 'OK' }) -RegistryEntries @((New-McRegistryEntry -Subkey '0000' -DriverDesc 'AMD Radeon 780M Graphics' -MatchingDeviceId 'PCI\VEN_1002&DEV_15BF' -QwMemorySize '0x20000000' -DriverVersion '1.0'))
Assert-Equal 'registry' (@($byName.Gpus)[0].VramSource) 'no prefix match falls back to DriverDesc = Name'
Assert-Equal '1.0' (@($byName.Gpus)[0].DriverVersion) 'the registry driver fills an empty CIM driver'

# ---- tier matrix and settings ------------------------------------------------------------------
function New-TestGpu {
  param([string]$Form, [int64]$Vram)
  return [pscustomobject]@{ Name = 'test'; Form = $Form; Memory = 'unknown'; VramBytes = $Vram }
}
$gib = [int64]1073741824
Assert-Equal 'A' (Get-McModelTier -Gpu (New-TestGpu 'discrete' (16 * $gib)) -FreePhysicalMemoryBytes 0) 'discrete 16 GiB: A'
Assert-Equal 'A' (Get-McModelTier -Gpu (New-TestGpu 'discrete' (12 * $gib)) -FreePhysicalMemoryBytes 0) 'discrete 12 GiB: A (boundary)'
Assert-Equal 'B' (Get-McModelTier -Gpu (New-TestGpu 'discrete' (8 * $gib)) -FreePhysicalMemoryBytes 0) 'discrete 8 GiB: B'
Assert-Equal 'B' (Get-McModelTier -Gpu (New-TestGpu 'discrete' (6 * $gib)) -FreePhysicalMemoryBytes 0) 'discrete 6 GiB: B (boundary)'
Assert-Equal 'D' (Get-McModelTier -Gpu (New-TestGpu 'discrete' (4 * $gib)) -FreePhysicalMemoryBytes 32000000000) 'discrete 4 GiB: D even with free RAM'
Assert-Equal 'C' (Get-McModelTier -Gpu (New-TestGpu 'integrated' (512 * 1048576)) -FreePhysicalMemoryBytes 12000000000) 'integrated + 12 GB free: C'
Assert-Equal 'C' (Get-McModelTier -Gpu (New-TestGpu 'integrated' (512 * 1048576)) -FreePhysicalMemoryBytes 10000000000) 'integrated + 10 GB free: C (boundary)'
Assert-Equal 'D' (Get-McModelTier -Gpu (New-TestGpu 'integrated' (512 * 1048576)) -FreePhysicalMemoryBytes 6000000000) 'integrated + 6 GB free: D'
Assert-Equal 'D' (Get-McModelTier -Gpu (New-TestGpu 'unknown' (8 * $gib)) -FreePhysicalMemoryBytes 12000000000) 'unknown form: D'
$override = Get-McTierDecision -Gpu (New-TestGpu 'integrated' (512 * 1048576)) -FreePhysicalMemoryBytes 12000000000 -Override 'A'
Assert-Equal 'A' $override.Tier '-Tier override wins'
Assert-True ($override.Reason -like '*owner override*') 'override is named in the reason'
Assert-True ($override.Reason -like '*rule says Tier C*') 'the rule''s own answer is still printed'
$ruled = Get-McTierDecision -Gpu (New-TestGpu 'integrated' (512 * 1048576)) -FreePhysicalMemoryBytes 12000000000 -Override ''
Assert-Equal 'C' $ruled.Tier 'no override keeps the rule'
Assert-True ($ruled.Reason -like 'test, integrated, VRAM 512 MiB*free RAM*') 'reason names gpu, form, VRAM and free RAM'

$a = Get-McTierSettings 'A'
Assert-Equal 'qwen3:14b' $a.ResidentModels 'A: 14b resident'
Assert-Equal 2 (@($a.Implementations).Count) 'A: both entries'
Assert-Equal 16384 $a.Context 'A: context 16384'
Assert-Equal 'qwen3:14b' $a.BenchmarkModel 'A: benchmark model 14b'
$b = Get-McTierSettings 'B'
Assert-Equal '' $b.ResidentModels 'B: no extra resident model'
Assert-Equal 2 (@($b.Implementations).Count) 'B: both entries'
$c = Get-McTierSettings 'C'
Assert-Equal 'qwen3.8b.local' (@($c.Implementations) -join ',') 'C: 8b entry only'
Assert-Equal 1 (@($c.PullModels).Count) 'C: pulls 8b only'
$d = Get-McTierSettings 'D'
Assert-Equal 8192 $d.Context 'D: context 8192'
Assert-Equal '10m' $d.KeepAlive 'D: keep-alive 10m'
Assert-Equal 'qwen3.8b.local' (@($d.Implementations) -join ',') 'D: 8b entry only'

# ---- environment, launchers --------------------------------------------------------------------
$values = Get-McNodeEnvironment -Settings $d -StateRoot 'STATE' -NodeName 'owner-windows-gpu' -OrgId '00000000-0000-4000-8000-000000000001' -ComputeUrl 'https://compute.mccluster.org'
Assert-Equal '1000' $values['MCCLUSTER_NODE_POLL_MS'] 'poll 1000 ms (Tier-1 lever)'
Assert-Equal '8192' $values['MCCLUSTER_OLLAMA_CONTEXT'] 'D: context in the environment'
Assert-Equal '10m' $values['OLLAMA_KEEP_ALIVE'] 'D: OLLAMA_KEEP_ALIVE 10m'
Assert-Equal 'true' $values['MCCLUSTER_OLLAMA_WARM_ON_START'] 'warm on start'
Assert-Equal 'qwen3.8b.local=qwen3:8b,qwen3.14b.local=qwen3:14b' $values['MCCLUSTER_OLLAMA_IMPLEMENTATIONS'] 'implementation map'
Assert-Equal $false $values.Contains('MCCLUSTER_OLLAMA_NUM_THREAD') 'never a CPU thread cap on a GPU tier'
Assert-Equal $false $values.Contains('MCCLUSTER_NODE_ENROLL_TOKEN') 'no token in the environment'
$launcher = Get-McLauncherText -Kind 'agent' -Environment $values -RepoPath 'REPO' -StateRoot 'STATE'
Assert-True ($launcher.StartsWith('@echo off')) 'launcher starts with @echo off'
Assert-True ($launcher.Contains('set MCCLUSTER_NODE_POLL_MS=1000')) 'launcher sets the poll'
Assert-True ($launcher.Contains('node src\compute\node-agent.mjs >> ')) 'agent launcher runs the agent'
Assert-True ($launcher.Contains("`r`n")) 'launcher uses CRLF'
Assert-Equal $false $launcher.Contains('ENROLL_TOKEN') 'launcher carries no token'
$adapterLauncher = Get-McLauncherText -Kind 'adapter' -Environment $values -RepoPath 'REPO' -StateRoot 'STATE'
Assert-True ($adapterLauncher.Contains('node src\compute\ollama-adapter.mjs >> ')) 'adapter launcher runs the adapter'

# ---- report masking ----------------------------------------------------------------------------
$savedProfile = $env:USERPROFILE
$savedComputer = $env:COMPUTERNAME
$savedUser = $env:USERNAME
$env:USERPROFILE = '/tmp/mc-home/testuser'
$env:COMPUTERNAME = 'TEST-HOST'
$env:USERNAME = 'testuser'
$masked = Get-McMaskedText 'state /tmp/mc-home/testuser/node on TEST-HOST by testuser, again Testuser'
Assert-Equal 'state %USERPROFILE%/node on <host> by <user>, again <user>' $masked 'profile, host and user are masked (case-insensitive)'
$env:USERPROFILE = $savedProfile
$env:COMPUTERNAME = $savedComputer
$env:USERNAME = $savedUser
$envLines = Format-McEnvironmentLines -Variables @{ MCCLUSTER_NODE_ENROLL_TOKEN = 'secret-value-123'; MCCLUSTER_NODE_NAME = 'owner-windows-gpu'; OLLAMA_KEEP_ALIVE = '24h'; PATH = 'ignored'; GGML_VK_VISIBLE_DEVICES = '0' }
Assert-True (($envLines -join "`n").Contains('MCCLUSTER_NODE_ENROLL_TOKEN = set')) 'token shown as set'
Assert-Equal $false (($envLines -join "`n").Contains('secret-value-123')) 'token value never printed'
Assert-Equal $false (($envLines -join "`n").Contains('PATH')) 'unrelated variables are not listed'
Assert-True (($envLines -join "`n").Contains('GGML_VK_VISIBLE_DEVICES = 0')) 'Vulkan device variable is listed'
$envLines = Format-McEnvironmentLines -Variables @{ MCCLUSTER_NODE_NAME = 'x' }
Assert-True (($envLines -join "`n").Contains('MCCLUSTER_NODE_ENROLL_TOKEN = unset')) 'token shown as unset when absent'

# ---- candidate partition -----------------------------------------------------------------------
Assert-True (Test-McCandidatePartition 53687091200) '50 GiB is a candidate'
Assert-True (Test-McCandidatePartition 45000000000) '45 GB lower bound'
Assert-Equal $false (Test-McCandidatePartition 44999999999) 'below the lower bound'
Assert-Equal $false (Test-McCandidatePartition 59055800321) 'above the upper bound'
Assert-Equal $false (Test-McCandidatePartition $null) 'null is not a candidate'

# ---- benchmark math and sidecar ----------------------------------------------------------------
$chat = [pscustomobject]@{ prompt_eval_count = 120; prompt_eval_duration = 400000000; eval_count = 256; eval_duration = 12800000000 }
$ps = [pscustomobject]@{ models = @([pscustomobject]@{ name = 'qwen3:8b'; model = 'qwen3:8b'; size = 6000; size_vram = 6000 }) }
$metrics = Get-McBenchmarkMetrics -ChatResponse $chat -PsResponse $ps -ModelName 'qwen3:8b'
Assert-Equal 20 $metrics.generation_tokens_per_second 'eval_count 256 over 1.28e10 ns is 20 tok/s'
Assert-Equal 300 $metrics.prompt_tokens_per_second 'prompt 120 over 4e8 ns is 300 tok/s'
Assert-Equal 100 $metrics.processor_gpu_percent 'size_vram equal to size is 100% GPU'
Assert-Equal 256 $metrics.generation_tokens 'generation tokens kept'
$half = [pscustomobject]@{ models = @([pscustomobject]@{ name = 'qwen3:8b'; model = 'qwen3:8b'; size = 6000; size_vram = 3000 }) }
Assert-Equal 50 (Get-McProcessorGpuPercent -PsResponse $half -ModelName 'qwen3:8b') 'half in VRAM is 50%'
Assert-Null (Get-McProcessorGpuPercent -PsResponse $null -ModelName 'qwen3:8b') 'no /api/ps answer is unknown'
Assert-Null (Get-McProcessorGpuPercent -PsResponse ([pscustomobject]@{ models = @() }) -ModelName 'qwen3:8b') 'nothing loaded is unknown'
$empty = Get-McBenchmarkMetrics -ChatResponse ([pscustomobject]@{ eval_count = 0; eval_duration = 0 }) -PsResponse $null -ModelName 'qwen3:8b'
Assert-Null $empty.generation_tokens_per_second 'zero counts give no rate'
Assert-True (Test-McModelFits ([pscustomobject]@{ processor_gpu_percent = 50; generation_tokens_per_second = 5 })) 'fits at 50% and 5 tok/s'
Assert-Equal $false (Test-McModelFits ([pscustomobject]@{ processor_gpu_percent = 49; generation_tokens_per_second = 20 })) 'does not fit under 50% GPU'
Assert-Equal $false (Test-McModelFits ([pscustomobject]@{ processor_gpu_percent = 100; generation_tokens_per_second = 4.9 })) 'does not fit under 5 tok/s'
Assert-Equal $false (Test-McModelFits ([pscustomobject]@{ processor_gpu_percent = $null; generation_tokens_per_second = 20 })) 'unknown GPU share does not fit'
$existingSidecar = '{"schema":"mccluster-measured-inference/1","measurements":{"qwen3:14b":{"generation_tokens_per_second":9.5,"prompt_tokens_per_second":null,"processor_gpu_percent":60,"measured_at":"2026-11-17T00:00:00Z","num_ctx":16384,"num_predict":256,"prompt_tokens":null,"generation_tokens":null,"ollama_version":null,"backend_note":null}}}'
$mergedJson = Merge-McMeasuredInference -ExistingJson $existingSidecar -Metrics $metrics -MeasuredAt '2026-11-17T20:00:00Z' -NumCtx 16384 -NumPredict 256 -OllamaVersion '0.40.16' -BackendNote 'library=Vulkan name=test'
$merged = $mergedJson | ConvertFrom-Json
Assert-Equal 'mccluster-measured-inference/1' $merged.schema 'sidecar schema'
Assert-Equal 20 $merged.measurements.'qwen3:8b'.generation_tokens_per_second 'new model written'
Assert-Equal 9.5 $merged.measurements.'qwen3:14b'.generation_tokens_per_second 'other model kept'
Assert-Equal '0.40.16' $merged.measurements.'qwen3:8b'.ollama_version 'ollama version recorded'
Assert-Equal 'library=Vulkan name=test' $merged.measurements.'qwen3:8b'.backend_note 'backend note recorded'
$fresh = (Merge-McMeasuredInference -ExistingJson 'not json' -Metrics $metrics -MeasuredAt '2026-11-17T20:00:00Z' -NumCtx 16384 -NumPredict 256 -OllamaVersion '' -BackendNote '') | ConvertFrom-Json
Assert-Equal 1 (@($fresh.measurements.PSObject.Properties).Count) 'invalid existing sidecar is replaced'
Assert-Null $fresh.measurements.'qwen3:8b'.ollama_version 'empty version is null'
Assert-Equal 'library=Vulkan name=AMD description=Radeon 780M total=15.5 GiB available=12.0 GiB' (Get-McBackendNote -LogLines @('x', 'time=1 level=INFO msg="inference compute" id=0 library=Vulkan name=AMD description="Radeon 780M" total="15.5 GiB" available="12.0 GiB"')) 'backend note from the server log'
Assert-Null (Get-McBackendNote -LogLines @()) 'no log lines, no note'

# ---- manifest rendering from the real template -------------------------------------------------
$templateJson = [System.IO.File]::ReadAllText($templatePath)
$template = $templateJson | ConvertFrom-Json
foreach ($tierName in @('A', 'B')) {
  $rendered = (ConvertTo-McManifestJson -TemplateJson $templateJson -Settings (Get-McTierSettings $tierName)) | ConvertFrom-Json
  Assert-Equal 2 (@($rendered.capabilities).Count) ('tier ' + $tierName + ': both entries')
}
foreach ($tierName in @('C', 'D')) {
  $rendered = (ConvertTo-McManifestJson -TemplateJson $templateJson -Settings (Get-McTierSettings $tierName)) | ConvertFrom-Json
  Assert-Equal 1 (@($rendered.capabilities).Count) ('tier ' + $tierName + ': one entry')
  Assert-Equal 'qwen3.8b.local' (@($rendered.capabilities)[0].implementation) ('tier ' + $tierName + ': the 8b entry')
  Assert-Equal 1 $rendered.max_leases ('tier ' + $tierName + ': max_leases kept')
  Assert-Equal 'gpu-laptop' $rendered.labels.role ('tier ' + $tierName + ': labels kept')
  Assert-Equal (@($template.capabilities)[0].input_schema | ConvertTo-Json -Depth 20 -Compress) (@($rendered.capabilities)[0].input_schema | ConvertTo-Json -Depth 20 -Compress) ('tier ' + $tierName + ': input_schema untouched')
  Assert-Equal 'http://127.0.0.1:4790/ready?implementation=qwen3.8b.local' (@($rendered.capabilities)[0].executor.health_url) ('tier ' + $tierName + ': per-implementation readiness URL kept')
}
$pruned = ConvertTo-McManifestJson -TemplateJson $templateJson -Settings (Get-McTierSettings 'C')
$readded = Add-McManifestImplementation -ManifestJson $pruned -TemplateJson $templateJson -Implementation 'qwen3.14b.local'
Assert-Equal 2 (@(($readded | ConvertFrom-Json).capabilities).Count) 'the 14b entry comes back from the template'
Assert-Equal 'qwen3:14b' (@(($readded | ConvertFrom-Json).capabilities)[1].model) 'the re-added entry is the 14b one'
Assert-Equal $readded (Add-McManifestImplementation -ManifestJson $readded -TemplateJson $templateJson -Implementation 'qwen3.14b.local') 'adding it twice changes nothing'

# ---- install into a temporary state root: -WhatIf writes nothing, a real run is idempotent ------
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('mccluster-node-tests-' + [guid]::NewGuid().ToString('N'))
try {
  Use-Fixture -Cim 'cim-780m-only.json' -Reg 'reg-780m-only.txt' -FreeBytes 12000000000
  $script:MockUserEnvironment = @{}
  $script:MockIcaclsCalls.Clear()
  $script:MockTaskRegistrations = 0
  Invoke-McInstall -RepoPath $repoRoot -StateRoot $tempRoot -NodeName 'owner-windows-gpu' -OrgId '00000000-0000-4000-8000-000000000001' -ComputeUrl 'https://compute.mccluster.org' -TierOverride '' -WhatIf | Out-Null
  Assert-Equal $false (Test-Path -LiteralPath $tempRoot) '-WhatIf creates no state root'
  Assert-Equal 0 $script:MockUserEnvironment.Count '-WhatIf sets no user variable'
  Assert-Equal 0 $script:MockTaskRegistrations '-WhatIf registers no task'
  Assert-Equal 0 $script:MockIcaclsCalls.Count '-WhatIf applies no ACL'

  $first = Invoke-McInstall -RepoPath $repoRoot -StateRoot $tempRoot -NodeName 'owner-windows-gpu' -OrgId '00000000-0000-4000-8000-000000000001' -ComputeUrl 'https://compute.mccluster.org' -TierOverride ''
  Assert-Equal 'C' $first.Tier 'install: 780M with 12 GB free is tier C'
  Assert-True (Test-Path -LiteralPath (Join-Path $tempRoot 'capabilities.json')) 'install: capabilities.json written'
  Assert-True (Test-Path -LiteralPath (Join-Path $tempRoot 'node.config.json')) 'install: node.config.json written'
  Assert-True (Test-Path -LiteralPath (Join-Path $tempRoot 'agent.cmd')) 'install: agent.cmd written'
  Assert-True (Test-Path -LiteralPath (Join-Path $tempRoot 'adapter.cmd')) 'install: adapter.cmd written'
  Assert-True (Test-Path -LiteralPath (Join-Path $tempRoot 'logs')) 'install: logs folder written'
  $writtenManifest = [System.IO.File]::ReadAllText((Join-Path $tempRoot 'capabilities.json')) | ConvertFrom-Json
  Assert-Equal 1 (@($writtenManifest.capabilities).Count) 'install: tier C manifest has the 8b entry only'
  $writtenConfig = [System.IO.File]::ReadAllText((Join-Path $tempRoot 'node.config.json')) | ConvertFrom-Json
  Assert-Equal 'C' $writtenConfig.tier 'install: node.config.json records the tier'
  Assert-Equal '00000000-0000-4000-8000-000000000001' $writtenConfig.org_id 'install: node.config.json records the org'
  Assert-Equal $false ((Get-Content -Raw (Join-Path $tempRoot 'node.config.json')).Contains('TOKEN')) 'install: node.config.json carries no token'
  Assert-Equal '1000' $script:MockUserEnvironment['MCCLUSTER_NODE_POLL_MS'] 'install: user variable for the poll'
  Assert-Equal (Join-Path $tempRoot 'capabilities.json') $script:MockUserEnvironment['MCCLUSTER_NODE_MANIFEST'] 'install: user variable for the manifest path'
  Assert-Equal 1 $script:MockTaskRegistrations 'install: scheduled tasks registered once'
  Assert-True (($script:MockIcaclsCalls -join ';').Contains('(OI)(CI)F')) 'install: owner-only ACL on the state root'

  $second = Invoke-McInstall -RepoPath $repoRoot -StateRoot $tempRoot -NodeName 'owner-windows-gpu' -ComputeUrl 'https://compute.mccluster.org' -TierOverride ''
  Assert-Equal 0 (@($second.Written).Count) 'install again: nothing rewritten (org id taken from node.config.json)'
  Assert-Equal 0 (@($second.EnvironmentChanged).Count) 'install again: no user variable changed'

  $bigger = Invoke-McInstall -RepoPath $repoRoot -StateRoot $tempRoot -NodeName 'owner-windows-gpu' -ComputeUrl 'https://compute.mccluster.org' -TierOverride 'A'
  Assert-Equal 'A' $bigger.Tier 'install with -Tier A: override applied'
  Assert-Equal 2 (@(([System.IO.File]::ReadAllText((Join-Path $tempRoot 'capabilities.json')) | ConvertFrom-Json).capabilities).Count) 'install with -Tier A: both entries written'

  $threw = $false
  try { Invoke-McInstall -RepoPath $repoRoot -StateRoot (Join-Path $tempRoot 'other') -NodeName 'x' -ComputeUrl 'https://compute.mccluster.org' -TierOverride '' | Out-Null } catch { $threw = $true }
  Assert-True $threw 'install without an org id and without node.config.json refuses'
  $threw = $false
  try { Invoke-McInstall -RepoPath $repoRoot -StateRoot (Join-Path $tempRoot 'other') -NodeName 'x' -OrgId '00000000-0000-4000-8000-000000000001' -ComputeUrl 'http://compute.mccluster.org' -TierOverride '' | Out-Null } catch { $threw = $true }
  Assert-True $threw 'install with a plain http compute URL refuses'
} finally {
  if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}

# ---- atomic writes -----------------------------------------------------------------------------
$tempFile = Join-Path ([System.IO.Path]::GetTempPath()) ('mccluster-node-tests-' + [guid]::NewGuid().ToString('N') + '.txt')
try {
  Assert-True (Write-McFileIfChanged -Path $tempFile -Content 'one') 'first write happens'
  Assert-Equal $false (Write-McFileIfChanged -Path $tempFile -Content 'one') 'same content is not rewritten'
  Assert-True (Write-McFileIfChanged -Path $tempFile -Content 'two') 'changed content is written'
  Assert-Equal 'two' ([System.IO.File]::ReadAllText($tempFile)) 'file holds the new content'
  Assert-Equal $false (Test-Path -LiteralPath ($tempFile + '.tmp')) 'no temporary file is left behind'
} finally {
  Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
}

Write-Output ''
Write-Output ('mccluster-node.tests.ps1: {0} passed, {1} failed' -f $script:Passed, $script:Failed)
foreach ($name in $script:Failures) { Write-Output ('  failed: ' + $name) }
if ($script:Failed -gt 0) { exit 1 }
exit 0
