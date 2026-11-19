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
$script:MockBrowserTaskRegistrations = 0
$script:MockNpmCalls = New-Object System.Collections.Generic.List[string]
$script:MockPlaywrightCalls = New-Object System.Collections.Generic.List[string]
$script:MockAnswer = 'y'
$script:MockStoppedTasks = New-Object System.Collections.Generic.List[string]
$script:MockStartedTasks = New-Object System.Collections.Generic.List[string]
$script:MockNodeRuns = New-Object System.Collections.Generic.List[object]
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
  param([string]$StateRoot, [string]$UserId, [switch]$Browser)
  if ($Browser) { $script:MockBrowserTaskRegistrations++ } else { $script:MockTaskRegistrations++ }
  return $true
}
function Start-McScheduledTask { param([string]$Name) $script:MockStartedTasks.Add($Name); return $true }
function Stop-McScheduledTask { param([string]$Name) $script:MockStoppedTasks.Add($Name); return $true }
function Get-McNpmCliPath { return 'npm-cli.js' }
function Invoke-McNpm {
  # the mocked registry install lands the package: the package.json the doctor verifies afterwards
  param([string[]]$Arguments, [string]$WorkingDirectory, [int]$TimeoutSeconds = 600)
  $script:MockNpmCalls.Add(($Arguments -join ' '))
  $packageDir = [System.IO.Path]::Combine($WorkingDirectory, 'node_modules', 'playwright')
  New-Item -ItemType Directory -Path $packageDir -Force | Out-Null
  [System.IO.File]::WriteAllText([System.IO.Path]::Combine($packageDir, 'package.json'), ('{"name":"playwright","version":"' + $script:McPlaywrightVersion + '"}'))
  [System.IO.File]::WriteAllText([System.IO.Path]::Combine($packageDir, 'cli.js'), '// fixture')
  return [pscustomobject]@{ ExitCode = 0; TimedOut = $false; StdOut = ''; StdErr = '' }
}
function Invoke-McPlaywrightCli {
  param([string]$StateRoot, [string[]]$Arguments, [int]$TimeoutSeconds = 900)
  $script:MockPlaywrightCalls.Add(($Arguments -join ' '))
  return [pscustomobject]@{ ExitCode = 0; TimedOut = $false; StdOut = "browser: chromium version 143.0.7499.4`n  Install location: STORE`n  Download url: fixture`n"; StdErr = '' }
}
function Read-McAnswer { param([string]$Prompt) return $script:MockAnswer }
function Invoke-McBrowserJson { param([string]$Path, [int]$TimeoutSec = 5) return $null }
function Invoke-McNodeProcess {
  param([string]$Script, [string[]]$Arguments = @(), [hashtable]$Environment = @{}, [string]$WorkingDirectory, [int]$TimeoutSeconds = 120, [switch]$Interactive)
  $script:MockNodeRuns.Add([pscustomobject]@{ Script = $Script; Arguments = @($Arguments); Environment = $Environment.Clone(); Interactive = [bool]$Interactive; TimeoutSeconds = $TimeoutSeconds })
  return [pscustomobject]@{ ExitCode = 0; TimedOut = $false; StdOut = ''; StdErr = '' }
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
Assert-Equal 'discrete' (Get-McGpuForm 'intel' 'Intel Arc A770 Graphics') 'Arc A770 without the trademark marker is discrete'
Assert-Equal 'integrated' (Get-McGpuForm 'intel' 'Intel(R) Arc(TM) Graphics') 'Arc without a discrete card series is integrated'
Assert-Equal 'integrated' (Get-McGpuForm 'intel' 'Intel(R) Iris(R) Xe Graphics') 'Iris Xe is integrated'
Assert-Equal 'unknown' (Get-McGpuForm 'unknown' 'Whatever') 'unknown vendor is unknown form'
Assert-True (Test-McThinkModel 'qwen3:8b') 'qwen3:8b takes the think key'
Assert-True (Test-McThinkModel 'qwen3:14b') 'qwen3:14b takes the think key'
Assert-True (Test-McThinkModel 'qwen3-vl:8b') 'qwen3-vl:8b (vision, tools, thinking) takes the think key'
Assert-True (Test-McThinkModel 'qwen3-vl:4b') 'qwen3-vl:4b takes the think key'
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
Assert-Equal 'C' (Get-McModelTier -Gpu $primary -FreePhysicalMemoryBytes 8000000000) '780M only with 8 GB free: tier C (the owner''s ~8 GB line)'
Assert-Equal 'D' (Get-McModelTier -Gpu $primary -FreePhysicalMemoryBytes 7999999999) '780M only just under 8 GB free: tier D (the 4B vision model)'
Assert-Equal 'D' (Get-McModelTier -Gpu $primary -FreePhysicalMemoryBytes 6000000000) '780M only with 6 GB free: tier D'
Assert-Equal 'D' (Get-McModelTier -Gpu $primary -FreePhysicalMemoryBytes 3500000000) '780M only with 3.5 GB free (the production heartbeat): tier D'

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

# ---- a stale driver subkey never shadows the live one (the same rule as hardware.mjs) -----------
$staleEntries = @(ConvertFrom-McRegQueryText (Read-Fixture 'reg-780m-stale-subkey.txt'))
Assert-Equal 2 $staleEntries.Count 'reg-780m-stale-subkey.txt has two subkeys with the same MatchingDeviceId'
Assert-Null $staleEntries[0].QwMemorySize 'the stale 0000 carries no qwMemorySize'
Use-Fixture -Cim 'cim-780m-only.json' -Reg 'reg-780m-stale-subkey.txt'
$staleInventory = Get-McGpuInventory
$staleGpu = @($staleInventory.Gpus)[0]
Assert-Equal 536870912 $staleGpu.VramBytes 'stale subkey: the live 0001 with a qwMemorySize wins'
Assert-Equal 'registry' $staleGpu.VramSource 'stale subkey: vram_source registry, not the AdapterRAM path'
Assert-Equal '0001' $staleGpu.RegistrySubkey 'stale subkey: the live subkey is the join'
Assert-Equal '32.0.13031.3015' $staleGpu.DriverVersion 'stale subkey: the live driver version'
$sameId = 'PCI\VEN_1002&DEV_15BF&SUBSYS_8B4A103C'
$bothSized = Select-McRegistryEntry -Controller $script:MockControllers[0] -RegistryEntries @((New-McRegistryEntry -Subkey '0001' -DriverDesc 'AMD Radeon 780M Graphics' -MatchingDeviceId $sameId -QwMemorySize '0x10000000' -DriverVersion 'new'), (New-McRegistryEntry -Subkey '0000' -DriverDesc 'AMD Radeon 780M Graphics' -MatchingDeviceId $sameId -QwMemorySize '0x8000000' -DriverVersion 'old'))
Assert-Equal '0001' $bothSized.Subkey 'both sized: the highest subkey (the latest install) wins, whatever the order'
$longerId = Select-McRegistryEntry -Controller $script:MockControllers[0] -RegistryEntries @((New-McRegistryEntry -Subkey '0000' -DriverDesc 'AMD Radeon 780M Graphics' -MatchingDeviceId $sameId -QwMemorySize $null -DriverVersion $null), (New-McRegistryEntry -Subkey '0001' -DriverDesc 'AMD Radeon 780M Graphics' -MatchingDeviceId 'PCI\VEN_1002&DEV_15BF' -QwMemorySize '0x20000000' -DriverVersion $null))
Assert-Equal '0000' $longerId.Subkey 'a longer MatchingDeviceId still outranks a shorter one, memory size or not'

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
Assert-Equal 'C' (Get-McModelTier -Gpu (New-TestGpu 'integrated' (512 * 1048576)) -FreePhysicalMemoryBytes 8000000000) 'integrated + 8 GB free: C (boundary, the owner''s ~8 GB line)'
Assert-Equal 'D' (Get-McModelTier -Gpu (New-TestGpu 'integrated' (512 * 1048576)) -FreePhysicalMemoryBytes 7999999999) 'integrated just under 8 GB free: D'
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
Assert-Equal 'qwen3-vl:8b' $a.ResidentModel 'A: the vision model is the one resident model'
Assert-Equal '' $a.ResidentModels 'A: MCCLUSTER_OLLAMA_RESIDENT_MODELS stays empty (the adapter default is the resident one)'
Assert-Equal 'qwen3-vl.8b.local,qwen3.8b.local,qwen3.14b.local' (@($a.Implementations) -join ',') 'A: three entries, qwen3:14b on demand'
Assert-Equal 'qwen3-vl.8b.local=qwen3-vl:8b,qwen3.8b.local=qwen3:8b,qwen3.14b.local=qwen3:14b' $a.ImplementationMap 'A: implementation map'
Assert-Equal 16384 $a.Context 'A: context 16384'
Assert-Equal 'qwen3-vl:8b' $a.BenchmarkModel 'A: the benchmark measures the resident model'
Assert-Equal 'qwen3-vl:8b,qwen3:8b,qwen3:14b' (@($a.PullModels) -join ',') 'A: pulls the three models'
$b = Get-McTierSettings 'B'
Assert-Equal 'qwen3-vl:8b' $b.ResidentModel 'B: vision model resident'
Assert-Equal 'qwen3-vl.8b.local,qwen3.8b.local' (@($b.Implementations) -join ',') 'B: two entries, no 14b on an 8 GiB card'
Assert-Equal 16384 $b.Context 'B: context 16384'
$c = Get-McTierSettings 'C'
Assert-Equal 'qwen3-vl:8b' $c.ResidentModel 'C: vision model resident on shared memory'
Assert-Equal 'qwen3-vl.8b.local,qwen3.8b.local' (@($c.Implementations) -join ',') 'C: the twin is on demand beside the resident model'
Assert-Equal 8192 $c.Context 'C: context 8192 on shared memory (owner decision)'
Assert-Equal '5m' $c.OnDemandKeepAlive 'C: the on-demand twin unloads after 5 m'
Assert-Equal '24h' $c.KeepAlive 'C: the resident model keeps a long keep-alive'
Assert-Equal 2 (@($c.PullModels).Count) 'C: pulls the vision model and the twin'
$d = Get-McTierSettings 'D'
Assert-Equal 'qwen3-vl:4b' $d.ResidentModel 'D: the smaller vision model'
Assert-Equal 'qwen3-vl.4b.local' (@($d.Implementations) -join ',') 'D: one entry'
Assert-Equal 'qwen3-vl.4b.local=qwen3-vl:4b' $d.ImplementationMap 'D: implementation map'
Assert-Equal 8192 $d.Context 'D: context 8192'
Assert-Equal '24h' $d.KeepAlive 'D: the resident model keeps a long keep-alive'
Assert-Equal 'qwen3-vl:4b' (@($d.PullModels) -join ',') 'D: pulls the small vision model only'
foreach ($tierName in @('A', 'B', 'C', 'D')) {
  $tierSettings = Get-McTierSettings $tierName
  Assert-Equal '' $tierSettings.ResidentModels ('tier ' + $tierName + ': exactly one resident model, the adapter default')
  Assert-Equal $tierSettings.ResidentModel $tierSettings.BenchmarkModel ('tier ' + $tierName + ': the benchmark measures the resident model')
  Assert-Equal ($tierName -eq 'A') (@($tierSettings.Implementations) -contains 'qwen3.14b.local') ('tier ' + $tierName + ': qwen3:14b on tier A only')
}
Assert-True (Test-McModelAllowedOnTier -ModelName 'qwen3:14b' -Tier 'A') '14b allowed on A'
Assert-Equal $false (Test-McModelAllowedOnTier -ModelName 'qwen3:14b' -Tier 'B') '14b refused on B (an 8 GiB card)'
Assert-Equal $false (Test-McModelAllowedOnTier -ModelName 'qwen3:14b' -Tier 'C') '14b refused on C (shared memory, owner decision)'
Assert-Equal $false (Test-McModelAllowedOnTier -ModelName 'qwen3:14b' -Tier 'D') '14b refused on D'
Assert-True (Test-McModelAllowedOnTier -ModelName 'qwen3:8b' -Tier 'D') 'other models are not gated here'
Assert-Equal 'D' (Get-McLowerTier 'C') 'a refused tier C goes to D'
Assert-Null (Get-McLowerTier 'D') 'no tier below D'

# ---- environment, launchers --------------------------------------------------------------------
$values = Get-McNodeEnvironment -Settings $d -StateRoot 'STATE' -NodeName 'owner-windows-gpu' -OrgId '00000000-0000-4000-8000-000000000001' -ComputeUrl 'https://compute.mccluster.org'
Assert-Equal '1000' $values['MCCLUSTER_NODE_POLL_MS'] 'poll 1000 ms (Tier-1 lever)'
Assert-Equal '8192' $values['MCCLUSTER_OLLAMA_CONTEXT'] 'D: context in the environment'
Assert-Equal '24h' $values['OLLAMA_KEEP_ALIVE'] 'D: OLLAMA_KEEP_ALIVE 24h for the resident model'
Assert-Equal 'qwen3-vl:4b' $values['MCCLUSTER_OLLAMA_MODEL'] 'D: the resident model is the adapter default'
Assert-Equal 'qwen3-vl.4b.local=qwen3-vl:4b' $values['MCCLUSTER_OLLAMA_IMPLEMENTATIONS'] 'D: implementation map'
Assert-Equal '' $values['MCCLUSTER_OLLAMA_RESIDENT_MODELS'] 'D: no second resident model'
Assert-Equal '5m' $values['MCCLUSTER_OLLAMA_ON_DEMAND_KEEP_ALIVE'] 'on-demand models unload after 5 m'
Assert-Equal 'true' $values['MCCLUSTER_OLLAMA_WARM_ON_START'] 'warm on start'
$valuesA = Get-McNodeEnvironment -Settings $a -StateRoot 'STATE' -NodeName 'owner-windows-gpu' -OrgId '00000000-0000-4000-8000-000000000001' -ComputeUrl 'https://compute.mccluster.org'
Assert-Equal 'qwen3-vl:8b' $valuesA['MCCLUSTER_OLLAMA_MODEL'] 'A: the vision model is the adapter default'
Assert-Equal 'qwen3-vl.8b.local=qwen3-vl:8b,qwen3.8b.local=qwen3:8b,qwen3.14b.local=qwen3:14b' $valuesA['MCCLUSTER_OLLAMA_IMPLEMENTATIONS'] 'A: implementation map'
Assert-Equal '' $valuesA['MCCLUSTER_OLLAMA_RESIDENT_MODELS'] 'A: no second resident model (the adapter would keep both loaded)'
Assert-Equal $false $values.Contains('MCCLUSTER_OLLAMA_NUM_THREAD') 'never a CPU thread cap on a GPU tier'
Assert-Equal $false $values.Contains('MCCLUSTER_NODE_ENROLL_TOKEN') 'no token in the environment'
foreach ($key in @($values.Keys)) {
  if ($key -like 'MCCLUSTER_*' -and $key -ne 'MCCLUSTER_ORG_ID') { Assert-True ((Get-McReportValueAllowlist) -contains $key) ('the report allowlist names the installed variable ' + $key) }
}
Assert-Equal $false ((Get-McReportValueAllowlist) -contains 'MCCLUSTER_ORG_ID') 'the organization id is never on the value allowlist'

# ---- launcher values are inert for cmd.exe ------------------------------------------------------
Assert-True (Test-McNodeName 'owner-windows-gpu') 'the default node name is valid'
Assert-True (Test-McNodeName 'owner-windows-pilot') 'the earlier node name is valid'
Assert-Equal $false (Test-McNodeName 'laptop & calc.exe') 'a node name with cmd metacharacters is refused'
Assert-Equal $false (Test-McNodeName '') 'an empty node name is refused'
Assert-Equal $false (Test-McNodeName ('a' * 65)) 'a 65-character node name is refused'
Assert-Equal $false (Test-McLauncherSafeValue 'C:\x & calc.exe') 'ampersand is refused'
Assert-Equal $false (Test-McLauncherSafeValue 'C:\x|y') 'pipe is refused'
Assert-Equal $false (Test-McLauncherSafeValue 'C:\x > nul') 'redirection is refused'
Assert-Equal $false (Test-McLauncherSafeValue 'C:\x%PATH%') 'percent is refused'
Assert-Equal $false (Test-McLauncherSafeValue 'C:\x^y') 'caret is refused'
Assert-Equal $false (Test-McLauncherSafeValue 'C:\x ') 'a trailing space is refused'
Assert-True (Test-McLauncherSafeValue 'C:\ProgramData\mccluster-node') 'the default state root passes'
Assert-True (Test-McLauncherSafeValue 'qwen3-vl.8b.local=qwen3-vl:8b,qwen3.8b.local=qwen3:8b') 'the implementation map passes'
Assert-True (Test-McLauncherSafeValue 'https://compute.mccluster.org') 'the compute URL passes'
$hostile = Get-McNodeEnvironment -Settings $d -StateRoot 'C:\x' -NodeName 'laptop & calc.exe' -OrgId '00000000-0000-4000-8000-000000000001' -ComputeUrl 'https://compute.mccluster.org'
$threw = $false
try { Get-McLauncherText -Kind 'agent' -Environment $hostile -RepoPath 'C:\r' -StateRoot 'C:\x' | Out-Null } catch { $threw = $true }
Assert-True $threw 'a launcher is never written with a cmd metacharacter in a value'
$threw = $false
try { Get-McLauncherText -Kind 'agent' -Environment $values -RepoPath 'C:\r & calc.exe' -StateRoot 'C:\x' | Out-Null } catch { $threw = $true }
Assert-True $threw 'a launcher is never written with a cmd metacharacter in a path'
$threw = $false
try { Assert-McLauncherValues -NodeName 'laptop & calc.exe' -StateRoot 'C:\x' -RepoPath 'C:\r' -ComputeUrl 'https://compute.mccluster.org' } catch { $threw = $true }
Assert-True $threw '-Install refuses a node name with cmd metacharacters'
$threw = $false
try { Assert-McLauncherValues -NodeName 'ok' -StateRoot 'C:\x > nul' -RepoPath 'C:\r' -ComputeUrl 'https://compute.mccluster.org' } catch { $threw = $true }
Assert-True $threw '-Install refuses a state root with a redirection'
$threw = $false
try { Assert-McLauncherValues -NodeName 'owner-windows-gpu' -StateRoot 'C:\ProgramData\mccluster-node' -RepoPath 'C:\src\mccluster' -ComputeUrl 'https://compute.mccluster.org' } catch { $threw = $true }
Assert-Equal $false $threw 'ordinary install values pass'

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
$envLines = Format-McEnvironmentLines -Variables @{ MCCLUSTER_NODE_ENROLL_TOKEN = 'secret-value-123'; MCCLUSTER_NODE_NAME = 'owner-windows-gpu'; OLLAMA_KEEP_ALIVE = '24h'; PATH = 'ignored'; GGML_VK_VISIBLE_DEVICES = '0'; MCCLUSTER_RELAY_TOKEN = 'abc123'; MCCLUSTER_CONTEXT_TOKEN = 'ctx-secret'; MCCLUSTER_MEETING_ENGINE_API_KEY = 'k-1'; MCCLUSTER_SMSGATE_PASSWORD = 'p-1'; MCCLUSTER_ORG_ID = '00000000-0000-4000-8000-000000000001'; MCCLUSTER_SOMETHING_ELSE = 'private-value'; OLLAMA_API_KEY = 'ok-1'; MCCLUSTER_OLLAMA_MODEL = 'qwen3-vl:8b' }
$envText = ($envLines -join "`n")
Assert-True ($envText.Contains('MCCLUSTER_NODE_ENROLL_TOKEN = set')) 'token shown as set'
Assert-Equal $false ($envText.Contains('secret-value-123')) 'token value never printed'
Assert-Equal $false ($envText.Contains('PATH')) 'unrelated variables are not listed'
Assert-True ($envText.Contains('GGML_VK_VISIBLE_DEVICES = 0')) 'Vulkan device variable is listed'
Assert-True ($envText.Contains('OLLAMA_KEEP_ALIVE = 24h')) 'an OLLAMA_* value is printed'
Assert-True ($envText.Contains('MCCLUSTER_NODE_NAME = owner-windows-gpu')) 'an allowlisted value is printed'
Assert-True ($envText.Contains('MCCLUSTER_OLLAMA_MODEL = qwen3-vl:8b')) 'the model name is printed'
Assert-True ($envText.Contains('MCCLUSTER_RELAY_TOKEN = set')) 'another MCCLUSTER_* token is shown as set only'
Assert-True ($envText.Contains('MCCLUSTER_CONTEXT_TOKEN = set')) 'the context token is shown as set only'
Assert-True ($envText.Contains('MCCLUSTER_MEETING_ENGINE_API_KEY = set')) 'a key is shown as set only'
Assert-True ($envText.Contains('MCCLUSTER_SMSGATE_PASSWORD = set')) 'a password is shown as set only'
Assert-True ($envText.Contains('OLLAMA_API_KEY = set')) 'an OLLAMA_* key is shown as set only'
Assert-True ($envText.Contains('MCCLUSTER_SOMETHING_ELSE = set')) 'an unknown MCCLUSTER_* name never prints its value'
Assert-True ($envText.Contains('MCCLUSTER_ORG_ID = set (uuid)')) 'the organization id is masked as a uuid'
foreach ($secret in @('abc123', 'ctx-secret', 'k-1', 'p-1', 'ok-1', 'private-value', '00000000-0000-4000-8000-000000000001')) { Assert-Equal $false ($envText.Contains($secret)) ('value never printed: ' + $secret) }
$envLines = Format-McEnvironmentLines -Variables @{ MCCLUSTER_NODE_NAME = 'x' }
Assert-True (($envLines -join "`n").Contains('MCCLUSTER_NODE_ENROLL_TOKEN = unset')) 'token shown as unset when absent'
Assert-True ((Format-McEnvironmentLines -Variables @{ MCCLUSTER_ORG_ID = 'not-a-uuid' }) -join "`n").Contains('MCCLUSTER_ORG_ID = set (not a uuid)') 'a malformed organization id is masked too'

# ---- candidate partition -----------------------------------------------------------------------
Assert-True (Test-McCandidatePartition 53687091200) '50 GiB is a candidate'
Assert-True (Test-McCandidatePartition 45000000000) '45 GB lower bound'
Assert-Equal $false (Test-McCandidatePartition 44999999999) 'below the lower bound'
Assert-Equal $false (Test-McCandidatePartition 59055800321) 'above the upper bound'
Assert-Equal $false (Test-McCandidatePartition $null) 'null is not a candidate'

# ---- benchmark math and sidecar ----------------------------------------------------------------
$chat = [pscustomobject]@{ prompt_eval_count = 120; prompt_eval_duration = 400000000; eval_count = 256; eval_duration = 12800000000 }
$ps = [pscustomobject]@{ models = @([pscustomobject]@{ name = 'qwen3:8b'; model = 'qwen3:8b'; size = 6000; size_vram = 6000 }) }
$metrics = Get-McBenchmarkMetrics -ChatResponse $chat -PsResponse $ps -ModelName 'qwen3:8b' -FreeMemoryBeforeBytes 9000000000 -FreeMemoryAfterBytes 4500000000
Assert-Equal 20 $metrics.generation_tokens_per_second 'eval_count 256 over 1.28e10 ns is 20 tok/s'
Assert-Equal 300 $metrics.prompt_tokens_per_second 'prompt 120 over 4e8 ns is 300 tok/s'
Assert-Equal 100 $metrics.processor_gpu_percent 'size_vram equal to size is 100% GPU'
Assert-Equal 256 $metrics.generation_tokens 'generation tokens kept'
Assert-Equal 9000000000 $metrics.free_memory_before_bytes 'free memory before loading is recorded'
Assert-Equal 4500000000 $metrics.free_memory_after_bytes 'free memory with the model loaded is recorded'
$half = [pscustomobject]@{ models = @([pscustomobject]@{ name = 'qwen3:8b'; model = 'qwen3:8b'; size = 6000; size_vram = 3000 }) }
Assert-Equal 50 (Get-McProcessorGpuPercent -PsResponse $half -ModelName 'qwen3:8b') 'half in VRAM is 50%'
Assert-Null (Get-McProcessorGpuPercent -PsResponse $null -ModelName 'qwen3:8b') 'no /api/ps answer is unknown'
Assert-Null (Get-McProcessorGpuPercent -PsResponse ([pscustomobject]@{ models = @() }) -ModelName 'qwen3:8b') 'nothing loaded is unknown'
$empty = Get-McBenchmarkMetrics -ChatResponse ([pscustomobject]@{ eval_count = 0; eval_duration = 0 }) -PsResponse $null -ModelName 'qwen3:8b'
Assert-Null $empty.generation_tokens_per_second 'zero counts give no rate'
Assert-Null $empty.free_memory_after_bytes 'no free-memory reading stays null'

# ---- the owner's headroom rule (2026-11-17): the verdict on the free memory a loaded model leaves -----
$settingsC = Get-McTierSettings 'C'
$ok = Get-McHeadroomVerdict -Tier 'C' -ModelName 'qwen3-vl:8b' -FreeAfterBytes 5000000000 -Settings $settingsC
Assert-Equal 'resident' $ok.Role 'verdict: the vision model is the resident model'
Assert-Equal 'none' $ok.Action 'verdict: 5 GB free above the floor keeps the tier'
Assert-True $ok.Fits 'verdict: fits'
$refuse = Get-McHeadroomVerdict -Tier 'C' -ModelName 'qwen3-vl:8b' -FreeAfterBytes 3000000000 -Settings $settingsC
Assert-Equal 'refuse' $refuse.Action 'verdict: 3 GB free refuses the tier'
Assert-Equal 'D' $refuse.NextTier 'verdict: the lower tier is D'
Assert-True ($refuse.Reason -like '*-Install -Tier D*') 'verdict: the exact next command is named'
Assert-True ($refuse.Reason -like '*2.8 GiB*') 'verdict: the measured free memory is printed'
$prune = Get-McHeadroomVerdict -Tier 'C' -ModelName 'qwen3:8b' -FreeAfterBytes 3500000000 -Settings $settingsC
Assert-Equal 'twin' $prune.Role 'verdict: qwen3:8b is the on-demand twin on tier C'
Assert-Equal 'prune' $prune.Action 'verdict: the twin under the floor is not advertised'
$advertise = Get-McHeadroomVerdict -Tier 'C' -ModelName 'qwen3:8b' -FreeAfterBytes 4000000000 -Settings $settingsC
Assert-Equal 'advertise' $advertise.Action 'verdict: exactly 4 GB free is the floor, the twin is advertised'
$unknown = Get-McHeadroomVerdict -Tier 'C' -ModelName 'qwen3-vl:8b' -FreeAfterBytes $null -Settings $settingsC
Assert-Equal 'none' $unknown.Action 'verdict: unknown free memory changes nothing'
Assert-Null $unknown.Fits 'verdict: unknown free memory has no fit'
$lastTier = Get-McHeadroomVerdict -Tier 'D' -ModelName 'qwen3-vl:4b' -FreeAfterBytes 1000000000 -Settings (Get-McTierSettings 'D')
Assert-Equal 'refuse' $lastTier.Action 'verdict: tier D under the floor is refused too'
Assert-Null $lastTier.NextTier 'verdict: no lower tier after D'
$other = Get-McHeadroomVerdict -Tier 'D' -ModelName 'qwen3:8b' -FreeAfterBytes 3000000000 -Settings (Get-McTierSettings 'D')
Assert-Equal 'none' $other.Action 'verdict: a model that is not one of the tier''s changes nothing'
Assert-True (Test-McVersionAtLeast -Version '0.40.16' -Minimum '0.12.7') 'Ollama 0.40.16 is new enough for the vision models'
Assert-Equal $false (Test-McVersionAtLeast -Version '0.11.2' -Minimum '0.12.7') 'Ollama 0.11.2 is too old'
Assert-True (Test-McVersionAtLeast -Version 'v0.12.7' -Minimum '0.12.7') 'the boundary with a v prefix'
Assert-Equal $false (Test-McVersionAtLeast -Version 'unknown' -Minimum '0.12.7') 'an unparsable version is treated as too old'
$existingSidecar = '{"schema":"mccluster-measured-inference/1","measurements":{"qwen3:14b":{"generation_tokens_per_second":9.5,"prompt_tokens_per_second":null,"processor_gpu_percent":60,"measured_at":"2026-11-17T00:00:00Z","num_ctx":16384,"num_predict":256,"prompt_tokens":null,"generation_tokens":null,"ollama_version":null,"backend_note":null}}}'
$mergedJson = Merge-McMeasuredInference -ExistingJson $existingSidecar -Metrics $metrics -MeasuredAt '2026-11-17T20:00:00Z' -NumCtx 16384 -NumPredict 256 -OllamaVersion '0.40.16' -BackendNote 'library=Vulkan name=test'
$merged = $mergedJson | ConvertFrom-Json
Assert-Equal 'mccluster-measured-inference/1' $merged.schema 'sidecar schema'
Assert-Equal 20 $merged.measurements.'qwen3:8b'.generation_tokens_per_second 'new model written'
Assert-Equal 9.5 $merged.measurements.'qwen3:14b'.generation_tokens_per_second 'other model kept'
Assert-Equal '0.40.16' $merged.measurements.'qwen3:8b'.ollama_version 'ollama version recorded'
Assert-Equal 'library=Vulkan name=test' $merged.measurements.'qwen3:8b'.backend_note 'backend note recorded'
Assert-Equal 4500000000 $merged.measurements.'qwen3:8b'.free_memory_after_bytes 'the sidecar carries the free memory the loaded model left'
Assert-Equal 9000000000 $merged.measurements.'qwen3:8b'.free_memory_before_bytes 'and the free memory before it loaded'
$fresh = (Merge-McMeasuredInference -ExistingJson 'not json' -Metrics $metrics -MeasuredAt '2026-11-17T20:00:00Z' -NumCtx 16384 -NumPredict 256 -OllamaVersion '' -BackendNote '') | ConvertFrom-Json
Assert-Equal 1 (@($fresh.measurements.PSObject.Properties).Count) 'invalid existing sidecar is replaced'
Assert-Null $fresh.measurements.'qwen3:8b'.ollama_version 'empty version is null'
Assert-Equal 'library=Vulkan name=AMD description=Radeon 780M total=15.5 GiB available=12.0 GiB' (Get-McBackendNote -LogLines @('x', 'time=1 level=INFO msg="inference compute" id=0 library=Vulkan name=AMD description="Radeon 780M" total="15.5 GiB" available="12.0 GiB"')) 'backend note from the server log'
Assert-Null (Get-McBackendNote -LogLines @()) 'no log lines, no note'

# ---- manifest rendering from the real template -------------------------------------------------
$templateJson = [System.IO.File]::ReadAllText($templatePath)
$template = $templateJson | ConvertFrom-Json
Assert-Equal 5 (@($template.capabilities).Count) 'the template carries the four ai.chat entries the tiers choose from and the browser entry'
Assert-Equal 'qwen3-vl.8b.local' (@($template.capabilities)[0].implementation) 'the resident vision model is the first template entry'
Assert-Equal 'browser.act' (@($template.capabilities)[4].capability) 'the browser entry is the last template entry'
Assert-Equal 'chromium.local' (@($template.capabilities)[4].implementation) 'the browser implementation is chromium.local'
Assert-Equal $true (@($template.capabilities)[0].features.vision) 'the resident vision model advertises vision'
Assert-Equal $true (@($template.capabilities)[3].features.vision) 'the small vision model advertises vision'
Assert-Null (@($template.capabilities)[1].features.vision) 'the OVH twin claims no vision'
$withBrowserRender = (ConvertTo-McManifestJson -TemplateJson $templateJson -Settings (Get-McTierSettings 'C') -ExtraImplementations @('chromium.local')) | ConvertFrom-Json
Assert-Equal 'qwen3-vl.8b.local,qwen3.8b.local,chromium.local' (@($withBrowserRender.capabilities | ForEach-Object { $_.implementation }) -join ',') 'tier C with the browser installed keeps chromium.local in template order'
$renderedA = (ConvertTo-McManifestJson -TemplateJson $templateJson -Settings (Get-McTierSettings 'A')) | ConvertFrom-Json
Assert-Equal 'qwen3-vl.8b.local,qwen3.8b.local,qwen3.14b.local' (@($renderedA.capabilities | ForEach-Object { $_.implementation }) -join ',') 'tier A: three entries in template order'
foreach ($tierName in @('B', 'C')) {
  $rendered = (ConvertTo-McManifestJson -TemplateJson $templateJson -Settings (Get-McTierSettings $tierName)) | ConvertFrom-Json
  Assert-Equal 'qwen3-vl.8b.local,qwen3.8b.local' (@($rendered.capabilities | ForEach-Object { $_.implementation }) -join ',') ('tier ' + $tierName + ': the vision model and the twin, no 14b')
  Assert-Equal 1 $rendered.max_leases ('tier ' + $tierName + ': max_leases kept')
  Assert-Equal 'gpu-laptop' $rendered.labels.role ('tier ' + $tierName + ': labels kept')
  Assert-Equal (@($template.capabilities)[0].input_schema | ConvertTo-Json -Depth 20 -Compress) (@($rendered.capabilities)[0].input_schema | ConvertTo-Json -Depth 20 -Compress) ('tier ' + $tierName + ': input_schema untouched')
  Assert-Equal 'http://127.0.0.1:4790/ready?implementation=qwen3-vl.8b.local' (@($rendered.capabilities)[0].executor.health_url) ('tier ' + $tierName + ': per-implementation readiness URL kept')
  Assert-Equal 'qwen3-vl:8b' (@($rendered.capabilities)[0].model) ('tier ' + $tierName + ': the resident model is the first entry')
}
$renderedD = (ConvertTo-McManifestJson -TemplateJson $templateJson -Settings (Get-McTierSettings 'D')) | ConvertFrom-Json
Assert-Equal 1 (@($renderedD.capabilities).Count) 'tier D: one entry'
Assert-Equal 'qwen3-vl.4b.local' (@($renderedD.capabilities)[0].implementation) 'tier D: the smaller vision model'
Assert-Equal 'qwen3-vl:4b' (@($renderedD.capabilities)[0].model) 'tier D: its model'
Assert-Equal 'http://127.0.0.1:4790/ready?implementation=qwen3-vl.4b.local' (@($renderedD.capabilities)[0].executor.health_url) 'tier D: per-implementation readiness URL'
$pruned = Remove-McManifestImplementation -ManifestJson (ConvertTo-McManifestJson -TemplateJson $templateJson -Settings (Get-McTierSettings 'C')) -Implementation 'qwen3.8b.local'
Assert-Equal 'qwen3-vl.8b.local' (@(($pruned | ConvertFrom-Json).capabilities | ForEach-Object { $_.implementation }) -join ',') 'the twin can be taken out (under the headroom floor)'
Assert-Equal $pruned (Remove-McManifestImplementation -ManifestJson $pruned -Implementation 'qwen3.8b.local') 'removing it twice changes nothing'
$readded = Add-McManifestImplementation -ManifestJson $pruned -TemplateJson $templateJson -Implementation 'qwen3.8b.local'
Assert-Equal 2 (@(($readded | ConvertFrom-Json).capabilities).Count) 'the twin comes back from the template'
Assert-Equal 'qwen3:8b' (@(($readded | ConvertFrom-Json).capabilities)[1].model) 'the re-added entry is the twin'
Assert-Equal $readded (Add-McManifestImplementation -ManifestJson $readded -TemplateJson $templateJson -Implementation 'qwen3.8b.local') 'adding it twice changes nothing'

# ---- the node's own browser (slice N2): paths, policy, environment, launcher, report lines ------
Assert-Equal ([System.IO.Path]::Combine('STATE', 'browser')) (Get-McBrowserDir 'STATE') 'browser dir under the state root'
Assert-Equal ([System.IO.Path]::Combine('STATE', 'browser-profile')) (Get-McBrowserProfileDir 'STATE') 'profile dir under the state root'
Assert-Equal ([System.IO.Path]::Combine('STATE', 'browser-policy.json')) (Get-McBrowserPolicyPath 'STATE') 'policy beside the manifest'
Assert-Equal ([System.IO.Path]::Combine('STATE', 'browser', 'node_modules', 'playwright')) (Get-McPlaywrightDir 'STATE') 'playwright package dir'
Assert-Equal ([System.IO.Path]::Combine('STATE', 'browser', 'ms-playwright')) (Get-McPlaywrightBrowsersPath 'STATE') 'Chromium store under the state root'
$policyDefault = (Get-McBrowserPolicyText) | ConvertFrom-Json
Assert-Equal 'mccluster-browser-policy/1' $policyDefault.schema 'default policy schema'
Assert-Equal 0 (@($policyDefault.allowed_hosts).Count) 'default policy allows no host'
Assert-Equal $false $policyDefault.allow_subdomains 'default policy: subdomains off'
Assert-Equal 'absent (run -Browser, then edit allowed_hosts)' (ConvertFrom-McBrowserPolicy -Text $null).Summary 'policy summary: absent'
Assert-Equal 'unreadable (invalid JSON)' (ConvertFrom-McBrowserPolicy -Text 'not json').Summary 'policy summary: invalid JSON'
Assert-Equal 'schema_mismatch' (ConvertFrom-McBrowserPolicy -Text '{"schema":"other/1","allowed_hosts":["a.example"]}').Error 'policy summary: wrong schema'
$twoHosts = ConvertFrom-McBrowserPolicy -Text '{"schema":"mccluster-browser-policy/1","allowed_hosts":["a.example","b.example:8443"],"allow_subdomains":true}'
Assert-Equal 2 $twoHosts.HostCount 'policy summary: counts the hosts'
Assert-Equal 'allowed_hosts 2, allow_subdomains true' $twoHosts.Summary 'policy summary: shape only'
Assert-Equal $false ($twoHosts.Summary.Contains('a.example')) 'policy summary never names a host'
Assert-True ((ConvertFrom-McBrowserPolicy -Text (Get-McBrowserPolicyText)).Summary.Contains('BROWSER_POLICY_EMPTY')) 'policy summary: an empty allowlist says every open is refused'
$browserValues = Get-McBrowserEnvironment -StateRoot 'STATE'
Assert-Equal '4791' $browserValues['MCCLUSTER_BROWSER_EXECUTOR_PORT'] 'browser env: the executor port'
Assert-Equal ([System.IO.Path]::Combine('STATE', 'browser-policy.json')) $browserValues['MCCLUSTER_BROWSER_POLICY'] 'browser env: the policy path'
Assert-Equal ([System.IO.Path]::Combine('STATE', 'browser-profile')) $browserValues['MCCLUSTER_BROWSER_PROFILE_DIR'] 'browser env: the profile dir'
Assert-Equal ([System.IO.Path]::Combine('STATE', 'browser', 'node_modules', 'playwright')) $browserValues['MCCLUSTER_BROWSER_PLAYWRIGHT_DIR'] 'browser env: the pinned package dir'
Assert-Equal ([System.IO.Path]::Combine('STATE', 'browser', 'ms-playwright')) $browserValues['PLAYWRIGHT_BROWSERS_PATH'] 'browser env: the Chromium store'
Assert-Equal ([System.IO.Path]::Combine('STATE', 'capabilities.json')) $browserValues['MCCLUSTER_NODE_MANIFEST'] 'browser env: the manifest (the policy sits beside it)'
Assert-Equal $false $browserValues.Contains('MCCLUSTER_BROWSER_HEADED') 'browser env: headless by default (no HEADED key)'
foreach ($key in @($browserValues.Keys)) {
  if ($key -like 'MCCLUSTER_*') { Assert-True ((Get-McReportValueAllowlist) -contains $key) ('the report allowlist names the browser variable ' + $key) }
}
$browserLauncherText = Get-McLauncherText -Kind 'browser' -Environment $browserValues -RepoPath 'REPO' -StateRoot 'STATE'
Assert-True ($browserLauncherText.Contains('node src\compute\browser-executor.mjs >> ')) 'browser launcher runs the executor'
Assert-True ($browserLauncherText.Contains('set MCCLUSTER_BROWSER_EXECUTOR_PORT=4791')) 'browser launcher carries the port'
Assert-True ($browserLauncherText.Contains('browser.log')) 'browser launcher logs to browser.log'
Assert-Equal $false $browserLauncherText.Contains('ENROLL_TOKEN') 'browser launcher carries no token'
$playwrightEnv = Format-McEnvironmentLines -Variables @{ PLAYWRIGHT_BROWSERS_PATH = 'STATE-browsers'; MCCLUSTER_BROWSER_EXECUTOR_PORT = '4791'; MCCLUSTER_BROWSER_POLICY = 'STATE-policy' }
Assert-True (($playwrightEnv -join "`n").Contains('PLAYWRIGHT_BROWSERS_PATH = STATE-browsers')) 'report lists the Chromium store path'
Assert-True (($playwrightEnv -join "`n").Contains('MCCLUSTER_BROWSER_POLICY = STATE-policy')) 'report prints the browser policy path (non-secret)'

# ---- mocks for the benchmark: free memory as a sequence of readings, a daemon that answers in memory --------
$script:MockFreeSequence = New-Object System.Collections.Generic.List[int64]
function Get-McMemoryInfo {
  if ($script:MockFreeSequence.Count -gt 0) {
    $free = $script:MockFreeSequence[0]
    $script:MockFreeSequence.RemoveAt(0)
    return [pscustomobject]@{ TotalBytes = [int64]17179869184; FreeBytes = $free }
  }
  return $script:MockMemory
}
$script:MockChats = New-Object System.Collections.Generic.List[string]
function Invoke-McOllamaJson {
  param([string]$Path, $Body, [int]$TimeoutSec = 10)
  if ($Path -eq '/api/version') { return [pscustomobject]@{ version = '0.40.16' } }
  if ($Path -eq '/api/chat') {
    $script:MockChats.Add([string]$Body.model)
    return [pscustomobject]@{ prompt_eval_count = 120; prompt_eval_duration = 400000000; eval_count = 256; eval_duration = 12800000000 }
  }
  if ($Path -eq '/api/ps') {
    $loaded = ''
    if ($script:MockChats.Count -gt 0) { $loaded = [string]$script:MockChats[$script:MockChats.Count - 1] }
    return [pscustomobject]@{ models = @([pscustomobject]@{ name = $loaded; model = $loaded; size = 6000; size_vram = 6000 }) }
  }
  if ($Path -eq '/api/tags') { return [pscustomobject]@{ models = @() } }
  return $null
}

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

  $threw = $false
  try { Invoke-McInstall -RepoPath $repoRoot -StateRoot $tempRoot -NodeName 'laptop & calc.exe' -OrgId '00000000-0000-4000-8000-000000000001' -ComputeUrl 'https://compute.mccluster.org' -TierOverride '' | Out-Null } catch { $threw = $true }
  Assert-True $threw 'install: a node name with cmd metacharacters is refused'
  Assert-Equal $false (Test-Path -LiteralPath $tempRoot) 'install: the refusal happens before anything is written'

  $first = Invoke-McInstall -RepoPath $repoRoot -StateRoot $tempRoot -NodeName 'owner-windows-gpu' -OrgId '00000000-0000-4000-8000-000000000001' -ComputeUrl 'https://compute.mccluster.org' -TierOverride ''
  Assert-Equal 'C' $first.Tier 'install: 780M with 12 GB free is tier C'
  Assert-True (Test-Path -LiteralPath (Join-Path $tempRoot 'capabilities.json')) 'install: capabilities.json written'
  Assert-True (Test-Path -LiteralPath (Join-Path $tempRoot 'node.config.json')) 'install: node.config.json written'
  Assert-True (Test-Path -LiteralPath (Join-Path $tempRoot 'agent.cmd')) 'install: agent.cmd written'
  Assert-True (Test-Path -LiteralPath (Join-Path $tempRoot 'adapter.cmd')) 'install: adapter.cmd written'
  Assert-True (Test-Path -LiteralPath (Join-Path $tempRoot 'logs')) 'install: logs folder written'
  $writtenManifest = [System.IO.File]::ReadAllText((Join-Path $tempRoot 'capabilities.json')) | ConvertFrom-Json
  Assert-Equal 'qwen3-vl.8b.local,qwen3.8b.local' (@($writtenManifest.capabilities | ForEach-Object { $_.implementation }) -join ',') 'install: tier C manifest has the resident vision model and the on-demand twin'
  $writtenConfig = [System.IO.File]::ReadAllText((Join-Path $tempRoot 'node.config.json')) | ConvertFrom-Json
  Assert-Equal 'C' $writtenConfig.tier 'install: node.config.json records the tier'
  Assert-Equal 'qwen3-vl:8b' $writtenConfig.resident_model 'install: node.config.json records the resident model'
  Assert-Equal '00000000-0000-4000-8000-000000000001' $writtenConfig.org_id 'install: node.config.json records the org'
  Assert-Equal $false ((Get-Content -Raw (Join-Path $tempRoot 'node.config.json')).Contains('TOKEN')) 'install: node.config.json carries no token'
  Assert-Equal '1000' $script:MockUserEnvironment['MCCLUSTER_NODE_POLL_MS'] 'install: user variable for the poll'
  Assert-Equal 'qwen3-vl:8b' $script:MockUserEnvironment['MCCLUSTER_OLLAMA_MODEL'] 'install: the resident model is the adapter default'
  Assert-Equal '8192' $script:MockUserEnvironment['MCCLUSTER_OLLAMA_CONTEXT'] 'install: context 8192 on shared memory'
  Assert-Equal (Join-Path $tempRoot 'capabilities.json') $script:MockUserEnvironment['MCCLUSTER_NODE_MANIFEST'] 'install: user variable for the manifest path'
  Assert-Equal 1 $script:MockTaskRegistrations 'install: scheduled tasks registered once'
  Assert-True (($script:MockIcaclsCalls -join ';').Contains('(OI)(CI)F')) 'install: owner-only ACL on the state root'
  $agentLauncher = [System.IO.File]::ReadAllText((Join-Path $tempRoot 'agent.cmd'))
  $setLines = @(($agentLauncher -split "`r`n") | Where-Object { $_ -like 'set *' })
  Assert-True ($setLines.Count -ge 15) 'install: the launcher sets the configuration'
  Assert-Equal 0 (@($setLines | Where-Object { $_ -match '[&|<>^%!]' })).Count 'install: no set line carries a cmd metacharacter (only the final redirection line does)'
  Assert-True ($agentLauncher.Contains('set MCCLUSTER_OLLAMA_MODEL=qwen3-vl:8b')) 'install: the launcher carries the resident model'

  $second = Invoke-McInstall -RepoPath $repoRoot -StateRoot $tempRoot -NodeName 'owner-windows-gpu' -ComputeUrl 'https://compute.mccluster.org' -TierOverride ''
  Assert-Equal 0 (@($second.Written).Count) 'install again: nothing rewritten (org id taken from node.config.json)'
  Assert-Equal 0 (@($second.EnvironmentChanged).Count) 'install again: no user variable changed'

  # ---- benchmark against the mocked daemon: the headroom rule decides the tier and the twin ------
  $script:MockFreeSequence.Clear(); $script:MockFreeSequence.Add([int64]9000000000); $script:MockFreeSequence.Add([int64]5000000000)
  $script:MockChats.Clear()
  $residentRun = Invoke-McBenchmark -StateRoot $tempRoot -ModelOverride '' -RepoPath $repoRoot
  Assert-Equal 0 $residentRun.ExitCode 'benchmark: the resident vision model above the floor keeps tier C'
  Assert-Equal 'qwen3-vl:8b' $residentRun.Metrics.model 'benchmark: measures the resident model by default'
  Assert-Equal 'qwen3-vl:8b,qwen3-vl:8b' ($script:MockChats -join ',') 'benchmark: a warm-up call and a measured call'
  Assert-Equal 20 $residentRun.Metrics.generation_tokens_per_second 'benchmark: generation rate from the daemon'
  Assert-Equal 9000000000 $residentRun.FreeMemoryBeforeBytes 'benchmark: free memory before loading'
  Assert-Equal 5000000000 $residentRun.FreeMemoryAfterBytes 'benchmark: free memory with the model loaded'
  Assert-Equal 'none' $residentRun.Verdict.Action 'benchmark: no change to the manifest'
  $sidecar = [System.IO.File]::ReadAllText((Join-Path $tempRoot 'measured-inference.json')) | ConvertFrom-Json
  Assert-Equal 'mccluster-measured-inference/1' $sidecar.schema 'benchmark: the sidecar schema'
  Assert-Equal 5000000000 $sidecar.measurements.'qwen3-vl:8b'.free_memory_after_bytes 'benchmark: the sidecar carries the free memory'
  Assert-Equal 20 $sidecar.measurements.'qwen3-vl:8b'.generation_tokens_per_second 'benchmark: the sidecar carries the rate'

  $script:MockFreeSequence.Clear(); $script:MockFreeSequence.Add([int64]5000000000); $script:MockFreeSequence.Add([int64]3000000000)
  $twinRun = Invoke-McBenchmark -StateRoot $tempRoot -ModelOverride 'qwen3:8b' -RepoPath $repoRoot
  Assert-Equal 0 $twinRun.ExitCode 'benchmark: pruning the twin is not a refusal'
  Assert-Equal 'prune' $twinRun.Verdict.Action 'benchmark: the twin under the floor is pruned'
  $afterPrune = [System.IO.File]::ReadAllText((Join-Path $tempRoot 'capabilities.json')) | ConvertFrom-Json
  Assert-Equal 'qwen3-vl.8b.local' (@($afterPrune.capabilities | ForEach-Object { $_.implementation }) -join ',') 'benchmark: capabilities.json keeps the resident entry only'
  $twinSidecar = [System.IO.File]::ReadAllText((Join-Path $tempRoot 'measured-inference.json')) | ConvertFrom-Json
  Assert-Equal 2 (@($twinSidecar.measurements.PSObject.Properties).Count) 'benchmark: the sidecar keeps both models'

  $script:MockFreeSequence.Clear(); $script:MockFreeSequence.Add([int64]7000000000); $script:MockFreeSequence.Add([int64]4500000000)
  $twinBack = Invoke-McBenchmark -StateRoot $tempRoot -ModelOverride 'qwen3:8b' -RepoPath $repoRoot
  Assert-Equal 'advertise' $twinBack.Verdict.Action 'benchmark: the twin with headroom is advertised'
  $afterReadd = [System.IO.File]::ReadAllText((Join-Path $tempRoot 'capabilities.json')) | ConvertFrom-Json
  Assert-Equal 'qwen3-vl.8b.local,qwen3.8b.local' (@($afterReadd.capabilities | ForEach-Object { $_.implementation }) -join ',') 'benchmark: the twin entry is back from the template'

  $script:MockFreeSequence.Clear(); $script:MockFreeSequence.Add([int64]4000000000); $script:MockFreeSequence.Add([int64]2500000000)
  $refusal = Invoke-McBenchmark -StateRoot $tempRoot -ModelOverride '' -RepoPath $repoRoot
  Assert-Equal 1 $refusal.ExitCode 'benchmark: a resident model under the floor refuses the tier (exit 1)'
  Assert-Equal 'refuse' $refusal.Verdict.Action 'benchmark: the verdict is a refusal'
  Assert-Equal 'D' $refusal.Verdict.NextTier 'benchmark: the refusal names tier D'
  Assert-Equal 2 (@(([System.IO.File]::ReadAllText((Join-Path $tempRoot 'capabilities.json')) | ConvertFrom-Json).capabilities).Count) 'benchmark: a refusal changes no manifest'

  $script:MockFreeSequence.Clear()
  $noReading = Invoke-McBenchmark -StateRoot $tempRoot -ModelOverride '' -RepoPath $repoRoot
  Assert-Equal 0 $noReading.ExitCode 'benchmark: the fixture memory reading above the floor keeps the tier'

  $threw = $false
  try { Invoke-McBenchmark -StateRoot $tempRoot -ModelOverride 'qwen3:14b' -RepoPath $repoRoot | Out-Null } catch { $threw = $true }
  Assert-True $threw 'benchmark: qwen3:14b is refused on a shared-memory tier (owner decision)'
  Assert-Equal 'qwen3-vl:8b,qwen3-vl:8b,qwen3:8b,qwen3:8b,qwen3:8b,qwen3:8b,qwen3-vl:8b,qwen3-vl:8b,qwen3-vl:8b,qwen3-vl:8b' ($script:MockChats -join ',') 'benchmark: the refused model never reached the daemon'

  $bigger = Invoke-McInstall -RepoPath $repoRoot -StateRoot $tempRoot -NodeName 'owner-windows-gpu' -ComputeUrl 'https://compute.mccluster.org' -TierOverride 'A'
  Assert-Equal 'A' $bigger.Tier 'install with -Tier A: override applied'
  Assert-Equal 3 (@(([System.IO.File]::ReadAllText((Join-Path $tempRoot 'capabilities.json')) | ConvertFrom-Json).capabilities).Count) 'install with -Tier A: three entries written'

  # ---- the node's own browser: -WhatIf writes nothing, declining the download changes nothing, the real run lands everything once ----
  $script:MockNpmCalls.Clear(); $script:MockPlaywrightCalls.Clear(); $script:MockStartedTasks.Clear(); $script:MockBrowserTaskRegistrations = 0; $script:MockAnswer = 'y'
  Invoke-McBrowserInstall -StateRoot $tempRoot -RepoPath $repoRoot -WhatIf | Out-Null
  Assert-Equal $false (Test-Path -LiteralPath (Join-Path $tempRoot 'browser')) '-Browser -WhatIf creates no browser folder'
  Assert-Equal $false (Test-Path -LiteralPath (Join-Path $tempRoot 'browser-profile')) '-Browser -WhatIf creates no profile folder'
  Assert-Equal 0 $script:MockNpmCalls.Count '-Browser -WhatIf runs no npm'
  Assert-Equal 0 $script:MockPlaywrightCalls.Count '-Browser -WhatIf runs no Playwright installer'
  Assert-Equal 0 $script:MockBrowserTaskRegistrations '-Browser -WhatIf registers no task'
  Assert-Equal $false (Test-Path -LiteralPath (Join-Path $tempRoot 'browser-policy.json')) '-Browser -WhatIf writes no policy'
  Assert-Equal 3 (@(([System.IO.File]::ReadAllText((Join-Path $tempRoot 'capabilities.json')) | ConvertFrom-Json).capabilities).Count) '-Browser -WhatIf changes no manifest'

  $script:MockAnswer = 'n'
  $configBeforeDecline = [System.IO.File]::ReadAllBytes((Get-McNodeConfigPath $tempRoot))
  $declined = Invoke-McBrowserInstall -StateRoot $tempRoot -RepoPath $repoRoot
  Assert-Equal 2 $declined.ExitCode 'browser: declining the Chromium download exits 2'
  Assert-Equal $false $declined.Installed 'browser: declined is not installed'
  Assert-Equal 1 $script:MockNpmCalls.Count 'browser: the package was installed before the dry run (the dry run needs it)'
  Assert-Equal 'install --dry-run chromium' ($script:MockPlaywrightCalls -join '|') 'browser: only the dry run ran when the owner declined'
  Assert-Equal 0 $script:MockBrowserTaskRegistrations 'browser: no task when declined'
  Assert-Equal $false (Test-Path -LiteralPath (Join-Path $tempRoot 'browser-policy.json')) 'browser: no policy when declined'
  Assert-Equal $false (Test-Path -LiteralPath (Join-Path $tempRoot 'browser.cmd')) 'browser: no launcher when declined'
  Assert-Equal 3 (@(([System.IO.File]::ReadAllText((Join-Path $tempRoot 'capabilities.json')) | ConvertFrom-Json).capabilities).Count) 'browser: manifest unchanged when declined'
  Assert-Equal $false (Read-McNodeConfig $tempRoot).browser 'browser: node.config.json keeps browser disabled when declined'
  $configAfterDecline = [System.IO.File]::ReadAllBytes((Get-McNodeConfigPath $tempRoot))
  Assert-Equal ([Convert]::ToBase64String($configBeforeDecline)) ([Convert]::ToBase64String($configAfterDecline)) 'browser: declining changes no byte of node.config.json'

  $script:MockAnswer = 'y'; $script:MockNpmCalls.Clear(); $script:MockPlaywrightCalls.Clear(); $script:MockIcaclsCalls.Clear()
  $nodeTasksBefore = $script:MockTaskRegistrations
  $browserRun = Invoke-McBrowserInstall -StateRoot $tempRoot -RepoPath $repoRoot
  Assert-Equal 0 $browserRun.ExitCode 'browser: install exits 0'
  Assert-True $browserRun.Installed 'browser: installed'
  Assert-True (([string]$script:MockNpmCalls[0]) -like ('install --prefix * --no-audit --no-fund --no-save playwright@' + $script:McPlaywrightVersion)) 'browser: npm installs the pinned version with --no-save'
  Assert-Equal 'install --dry-run chromium|install chromium' ($script:MockPlaywrightCalls -join '|') 'browser: the dry run precedes the Chromium install'
  Assert-True (Test-Path -LiteralPath (Join-Path $tempRoot 'browser')) 'browser: browser folder created'
  Assert-True (Test-Path -LiteralPath (Join-Path $tempRoot 'browser-profile')) 'browser: profile folder created'
  Assert-True (($script:MockIcaclsCalls -join ';').Contains((Join-Path $tempRoot 'browser-profile') + ' (OI)(CI)F')) 'browser: owner-only ACL on the profile'
  $policyPath = Join-Path $tempRoot 'browser-policy.json'
  Assert-True (Test-Path -LiteralPath $policyPath) 'browser: policy written'
  $writtenPolicy = [System.IO.File]::ReadAllText($policyPath) | ConvertFrom-Json
  Assert-Equal 'mccluster-browser-policy/1' $writtenPolicy.schema 'browser: policy schema'
  Assert-Equal 0 (@($writtenPolicy.allowed_hosts).Count) 'browser: policy starts with no allowed host'
  Assert-Equal $false $writtenPolicy.allow_subdomains 'browser: subdomains off by default'
  $browserLauncher = [System.IO.File]::ReadAllText((Join-Path $tempRoot 'browser.cmd'))
  Assert-True ($browserLauncher.Contains('node src\compute\browser-executor.mjs >> ')) 'browser: launcher runs the executor'
  Assert-True ($browserLauncher.Contains('set MCCLUSTER_BROWSER_EXECUTOR_PORT=4791')) 'browser: launcher carries the port'
  Assert-Equal $false $browserLauncher.Contains('MCCLUSTER_BROWSER_HEADED') 'browser: the task runs headless (no HEADED in the launcher)'
  Assert-True ($browserLauncher.Contains('set PLAYWRIGHT_BROWSERS_PATH=')) 'browser: launcher pins the Chromium store'
  Assert-Equal 1 $script:MockBrowserTaskRegistrations 'browser: the browser task registered once'
  Assert-Equal $nodeTasksBefore $script:MockTaskRegistrations 'browser: the adapter and agent tasks are not re-registered by -Browser'
  Assert-True ($script:MockStartedTasks -contains 'McCluster Node Browser') 'browser: the task was started'
  $withBrowser = [System.IO.File]::ReadAllText((Join-Path $tempRoot 'capabilities.json')) | ConvertFrom-Json
  Assert-Equal 'qwen3-vl.8b.local,qwen3.8b.local,qwen3.14b.local,chromium.local' (@($withBrowser.capabilities | ForEach-Object { $_.implementation }) -join ',') 'browser: chromium.local appended to the tier A manifest'
  Assert-Equal 'browser.act' (@($withBrowser.capabilities)[3].capability) 'browser: the appended entry is browser.act'
  Assert-Equal 'http://127.0.0.1:4791/ready' (@($withBrowser.capabilities)[3].executor.health_url) 'browser: the entry comes from the template unchanged'
  Assert-Equal $true (Read-McNodeConfig $tempRoot).browser 'browser: node.config.json records browser=true'
  Assert-Equal 'A' (Read-McNodeConfig $tempRoot).tier 'browser: the other config keys are kept'

  # the policy is the owner's file: a second -Browser never overwrites it, the entry is not duplicated, -Install keeps it
  [System.IO.File]::WriteAllText($policyPath, '{"schema":"mccluster-browser-policy/1","allowed_hosts":["docs.example"],"allow_subdomains":true}')
  $again = Invoke-McBrowserInstall -StateRoot $tempRoot -RepoPath $repoRoot
  Assert-Equal 0 $again.ExitCode 'browser again: exits 0'
  Assert-True (([System.IO.File]::ReadAllText($policyPath)).Contains('docs.example')) 'browser again: the owner''s policy is kept'
  Assert-Equal 4 (@(([System.IO.File]::ReadAllText((Join-Path $tempRoot 'capabilities.json')) | ConvertFrom-Json).capabilities).Count) 'browser again: the entry is not duplicated'
  $kept = Invoke-McInstall -RepoPath $repoRoot -StateRoot $tempRoot -NodeName 'owner-windows-gpu' -ComputeUrl 'https://compute.mccluster.org' -TierOverride ''
  Assert-Equal 'C' $kept.Tier 'install after -Browser: the tier rule still decides'
  Assert-Equal 'qwen3-vl.8b.local,qwen3.8b.local,chromium.local' (@(([System.IO.File]::ReadAllText((Join-Path $tempRoot 'capabilities.json')) | ConvertFrom-Json).capabilities | ForEach-Object { $_.implementation }) -join ',') 'install after -Browser: the browser entry survives the tier prune'
  Assert-Equal $true (Read-McNodeConfig $tempRoot).browser 'install after -Browser: browser=true kept in node.config.json'
  $reportLines = Format-McBrowserReportLines -StateRoot $tempRoot -TaskState 'Running' -Health $null -Ready $null
  $reportText = ($reportLines -join "`n")
  Assert-True ($reportText.Contains('task McCluster Node Browser: Running')) 'report: the browser task state'
  Assert-True ($reportText.Contains('playwright: ' + $script:McPlaywrightVersion)) 'report: the installed playwright version'
  Assert-True ($reportText.Contains('allowed_hosts 1, allow_subdomains true')) 'report: the policy shape'
  Assert-Equal $false $reportText.Contains('docs.example') 'report: the allowed hosts themselves are never printed'
  Assert-True ($reportText.Contains('/health: not answering')) 'report: an executor that does not answer says so'
  Assert-True ($reportText.Contains('/ready: not ready')) 'report: readiness that does not answer says so'
  $healthyLines = Format-McBrowserReportLines -StateRoot $tempRoot -TaskState 'Running' -Health ([pscustomobject]@{ ok = $true; busy = $false; last_error = $null; playwright = [pscustomobject]@{ found = $true; version = $script:McPlaywrightVersion }; policy = [pscustomobject]@{ allowed_hosts_count = 1 } }) -Ready ([pscustomobject]@{ ok = $true; browser_ready = $true; chromium_version = '143.0.7499.4' })
  Assert-True (($healthyLines -join "`n").Contains('ok True, busy False, playwright found True, policy hosts 1, last_error none')) 'report: health fields'
  Assert-True (($healthyLines -join "`n").Contains('/ready: ready, chromium 143.0.7499.4')) 'report: readiness'
  $absentLines = Format-McBrowserReportLines -StateRoot (Join-Path $tempRoot 'nowhere') -TaskState '' -Health $null -Ready $null
  Assert-True (($absentLines -join "`n").Contains('task McCluster Node Browser: absent')) 'report: no task says absent'
  Assert-True (($absentLines -join "`n").Contains('playwright: not installed')) 'report: nothing installed says so'
  Assert-True (($absentLines -join "`n").Contains('browser-policy.json: absent')) 'report: no policy says absent'

  # -BrowserHeaded stops the task, runs the executor headed on this console, starts the task again
  $script:MockStoppedTasks.Clear(); $script:MockStartedTasks.Clear(); $script:MockNodeRuns.Clear()
  $headedExit = Invoke-McBrowserHeaded -StateRoot $tempRoot -RepoPath $repoRoot
  Assert-Equal 0 $headedExit 'headed: exits 0'
  Assert-Equal 'McCluster Node Browser' ($script:MockStoppedTasks -join ',') 'headed: the task is stopped first'
  Assert-Equal 'McCluster Node Browser' ($script:MockStartedTasks -join ',') 'headed: the task is started again'
  Assert-Equal 1 $script:MockNodeRuns.Count 'headed: one executor run'
  Assert-True (([string]$script:MockNodeRuns[0].Script).EndsWith('browser-executor.mjs')) 'headed: runs the browser executor'
  Assert-Equal '1' $script:MockNodeRuns[0].Environment['MCCLUSTER_BROWSER_HEADED'] 'headed: MCCLUSTER_BROWSER_HEADED=1'
  Assert-Equal '4791' $script:MockNodeRuns[0].Environment['MCCLUSTER_BROWSER_EXECUTOR_PORT'] 'headed: the same port'
  Assert-True $script:MockNodeRuns[0].Interactive 'headed: runs on this console (interactive)'
  Assert-Equal 0 $script:MockNodeRuns[0].TimeoutSeconds 'headed: no time limit'
  $script:MockNodeRuns.Clear(); $script:MockStoppedTasks.Clear()
  Invoke-McBrowserHeaded -StateRoot $tempRoot -RepoPath $repoRoot -WhatIf | Out-Null
  Assert-Equal 0 $script:MockNodeRuns.Count 'headed -WhatIf: runs nothing'
  Assert-Equal 0 $script:MockStoppedTasks.Count 'headed -WhatIf: stops nothing'
  $threw = $false
  try { Invoke-McBrowserHeaded -StateRoot (Join-Path $tempRoot 'other') -RepoPath $repoRoot | Out-Null } catch { $threw = $true }
  Assert-True $threw 'headed without -Install refuses'

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
