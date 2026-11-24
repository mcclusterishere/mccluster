/* THE WINDOWS NODE DOCTOR, held to what can be checked without Windows.

   core/windows/mccluster-node.ps1 is the owner's doctor and installer for a Windows GPU laptop
   that joins the compute fabric (docs/control-plane/WINDOWS-NODE.md). Static checks, always:

   (a) the switches the runbook names exist (Report, Install, RepoPath, NodeName, Enroll, Models,
       Benchmark, Model, KeepAwake, ModelsPath, Vulkan, StateRoot, Tier, since slice N2 Browser
       and BrowserHeaded, and since the contribution contract Pause, Resume, Limits with IdleOnly,
       OnACOnly, MaxConcurrency, CpuBusyPercent, BatteryFloorPercent, ThermalLimitC, Revoke and
       Uninstall) with SupportsShouldProcess, and the library guard that lets the pwsh tests
       dot-source it without running anything;
   (b) nothing is downloaded or evaluated outside -Browser: no Invoke-Expression, iex,
       DownloadString, DownloadFile or Start-BitsTransfer, every URL literal is loopback or the Core
       compute host, and the two downloads -Browser makes (npm fetching the pinned playwright
       package, Playwright's own installer fetching Chromium) are called only inside
       Invoke-McBrowserInstall, the Chromium one after a dry run and the owner's answer;
   (c) Windows-only cmdlets live inside functions (the tests mock them by name), never in the
       dispatcher that runs after the guard;
   (d) no private strings (user path, UNC host, e-mail, non-loopback IPv4) and no AI vendor or
       model names, in the script, its tests, its fixtures or the runbook;
   (e) brackets, strings, here-strings and comments balance (a cheap stand-in for a parse);
   (f) the fixtures are the five recorded sets with CRLF where reg.exe and powershell.exe emit
       CRLF, and the JSON ones parse;
   (g) the runbook names every switch and the template, the browser document
       (docs/control-plane/AGENT-NODE-BROWSER.md) names the switches, the policy file and the
       executor port, and the protocol document carries the hardware_mode vocabulary,
       live_gpu_nodes and yield_seconds.

   The PowerShell parse ([System.Management.Automation.Language.Parser]::ParseFile) and
   core/windows/tests/mccluster-node.tests.ps1 run only where a pwsh is executable (PATH, or
   MCCLUSTER_PWSH naming the binary). Where none is, that subtest SKIPS and says so: it is not
   a pass. Dependency-free; runs through mcp-continuity-ci.yml (node --test scripts/test/*.test.mjs). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = "core/windows/mccluster-node.ps1";
const TESTS = "core/windows/tests/mccluster-node.tests.ps1";
const FIXTURES = "core/windows/tests/fixtures";
const RUNBOOK = "docs/control-plane/WINDOWS-NODE.md";
const PROTOCOL = "docs/control-plane/COMPUTE-NODE-PROTOCOL.md";
const DEVICES = "docs/control-plane/DEVICE-NODES-AND-OWNER-GPU.md";
const BROWSER_DOC = "docs/control-plane/AGENT-NODE-BROWSER.md";
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const SKIP_LINE = "windows-node-script: pwsh not available, PowerShell tests skipped (unverified here)";

const SWITCHES = ["Report", "Install", "Enroll", "Models", "Benchmark", "KeepAwake", "Browser", "BrowserHeaded", "Pause", "Resume", "Limits", "Revoke", "Uninstall", "IdleOnly", "OnACOnly"];
/* the one version -Browser installs; pinned in the doctor exactly once */
const PLAYWRIGHT_PIN = "1.63.0";
const VALUES = ["RepoPath", "NodeName", "Model", "ModelsPath", "Vulkan", "StateRoot", "Tier", "ComputeUrl", "OrgId", "MaxConcurrency", "CpuBusyPercent", "BatteryFloorPercent", "ThermalLimitC"];
/* a Windows user-profile path (raw or JSON-escaped), a UNC host (two backslashes at a path start,
   so a JSON-escaped PNP id or a regex like \\SYSTEM is not one), an e-mail, or a non-loopback IPv4 */
const PRIVATE_STRINGS = /[A-Za-z]:\\{1,2}Users\\{1,2}|(?<![\\\w])\\\\[A-Za-z0-9]|@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b(?!127\.0\.0\.1\b)\d{1,3}(?:\.\d{1,3}){3}\b/;
/* AI vendor and model names (stored reversed so this file does not carry them either) */
const reversed = (s) => [...s].reverse().join("");
const VENDOR_NAMES = new RegExp(`\\b(?:${["edualC", "ciporhtnA", "IAnepO", "TPGtahC", "supO", "tennoS", "inimeG", "korG"].map(reversed).join("|")}|${reversed("TPG")}-?\\d)\\b`, "i");
const WINDOWS_ONLY = /\b(?:Get-CimInstance|Get-ItemProperty|Register-ScheduledTask|Unregister-ScheduledTask|Get-ScheduledTask|Start-ScheduledTask|Stop-ScheduledTask|icacls|schtasks|powercfg|Read-Host|SetEnvironmentVariable)\b/g;

const script = read(SCRIPT);

/* the param( ... ) block: from "param(" to its matching parenthesis */
function paramBlock(src) {
  const start = src.indexOf("param(");
  assert.ok(start >= 0, "the script declares param(...)");
  let depth = 0;
  for (let i = start + 5; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error("param( never closes");
}

/* strips comments, strings and here-strings, then checks (), [] and {} nesting */
function assertBalanced(src, label) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const stack = [];
  const n = src.length;
  let line = 1;
  const nl = (s) => (s.match(/\n/g) || []).length;
  const fail = (msg) => { throw new Error(`${label}: ${msg} at line ${line}`); };
  for (let i = 0; i < n;) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "\n") { line++; i++; continue; }
    if (c === "<" && next === "#") { const end = src.indexOf("#>", i + 2); if (end < 0) fail("unterminated block comment"); line += nl(src.slice(i, end)); i = end + 2; continue; }
    if (c === "#") { const end = src.indexOf("\n", i); i = end < 0 ? n : end; continue; }
    if (c === "@" && (next === '"' || next === "'")) {
      const terminator = `\n${next}@`;
      const end = src.indexOf(terminator, i + 2);
      if (end < 0) fail("unterminated here-string");
      line += nl(src.slice(i, end + terminator.length)); i = end + terminator.length; continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n) { if (src[j] === "'") { if (src[j + 1] === "'") { j += 2; continue; } break; } j++; }
      if (j >= n) fail("unterminated single-quoted string");
      line += nl(src.slice(i, j)); i = j + 1; continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n) { if (src[j] === "`") { j += 2; continue; } if (src[j] === '"') { if (src[j + 1] === '"') { j += 2; continue; } break; } j++; }
      if (j >= n) fail("unterminated double-quoted string");
      line += nl(src.slice(i, j)); i = j + 1; continue;
    }
    if (c === "`") { i += 2; continue; }
    if (c === "(" || c === "[" || c === "{") { stack.push({ c, line }); i++; continue; }
    if (c === ")" || c === "]" || c === "}") {
      const top = stack.pop();
      if (!top || top.c !== pairs[c]) fail(`unbalanced ${c}`);
      i++; continue;
    }
    i++;
  }
  if (stack.length) throw new Error(`${label}: unclosed ${stack.at(-1).c} from line ${stack.at(-1).line}`);
}

test("the doctor declares every switch the runbook names, SupportsShouldProcess and the library guard", () => {
  assert.ok(script.startsWith("#Requires -Version 5.1"), "first line pins Windows PowerShell 5.1 as the floor");
  const params = paramBlock(script);
  for (const name of SWITCHES) assert.match(params, new RegExp(`\\[switch\\]\\s*\\$${name}\\b`), `-${name} is a switch`);
  for (const name of VALUES) assert.match(params, new RegExp(`\\$${name}\\b`), `-${name} is declared`);
  assert.match(script, /\[CmdletBinding\(SupportsShouldProcess\s*=\s*\$true\)\]/);
  assert.match(script, /\$PSCmdlet\.ShouldProcess\(/, "install steps are guarded by ShouldProcess (-WhatIf)");
  assert.match(script, /if\s*\(\s*\$env:MCCLUSTER_NODE_PS_LIBRARY\s+-eq\s+'1'\s*\)\s*\{\s*return\s*\}/, "library guard for the tests");
  assert.match(script, /ValidateSet\('A',\s*'B',\s*'C',\s*'D'\)/, "-Tier takes A, B, C or D");
  assert.match(script, /compute\.mccluster\.org/, "the default compute URL is the Core's public ingress");
});

/* the body of a top-level `function Name {` up to the next top-level function */
function functionBody(src, name) {
  const start = src.indexOf(`\nfunction ${name} {`);
  assert.ok(start >= 0, `${name} is defined`);
  const next = src.indexOf("\nfunction ", start + 1);
  return { start, end: next < 0 ? src.length : next, text: src.slice(start, next < 0 ? src.length : next) };
}

test("nothing is downloaded or evaluated outside -Browser, and every URL is loopback or the compute host", () => {
  assert.doesNotMatch(script, /Invoke-Expression|\biex\b|DownloadString|DownloadFile|Start-BitsTransfer|Invoke-RestMethod\s+[^\n]*https?:\/\/(?!127\.0\.0\.1)/i);
  const urls = script.match(/https?:\/\/[^\s'")\]]+/g) || [];
  assert.ok(urls.length > 0, "the script talks to the local Ollama daemon");
  for (const url of urls) {
    const host = new URL(url.replace(/[`$].*$/, "")).hostname;
    assert.ok(["127.0.0.1", "compute.mccluster.org"].includes(host), `${url} is not loopback or the compute host`);
  }
  assert.doesNotMatch(script, /ollama\s+run\b/, "the doctor never starts an interactive model session");
  /* -Browser is the one switch that downloads, and it says so in the header */
  assert.match(script, /-Browser[\s\S]{0,400}downloads/, "the header says what -Browser downloads");
  assert.match(script, new RegExp(`\\$script:McPlaywrightVersion = '${PLAYWRIGHT_PIN.replace(/\./g, "\\.")}'`), "the playwright version is pinned");
  assert.equal(script.split(PLAYWRIGHT_PIN).length - 1, 1, "the pin appears exactly once (nowhere else to drift)");
  assert.doesNotMatch(script, /\bnpx\b/, "no npx: the installed package's own cli.js is run through node");
  /* the two network wrappers are called only inside Invoke-McBrowserInstall */
  const install = functionBody(script, "Invoke-McBrowserInstall");
  for (const wrapper of ["Invoke-McNpm", "Invoke-McPlaywrightCli"]) {
    const calls = [...script.matchAll(new RegExp(`(?<!function )\\b${wrapper}\\b`, "g"))].map((m) => m.index);
    assert.ok(calls.length >= 1, `${wrapper} is called`);
    for (const at of calls) assert.ok(at > install.start && at < install.end, `${wrapper} is called outside Invoke-McBrowserInstall (offset ${at})`);
  }
  /* the dry run names the Chromium download, the owner answers, then the install runs; npm first (the dry run needs the package) */
  const body = install.text;
  const npmAt = body.indexOf("Invoke-McNpm");
  const dryAt = body.indexOf("'--dry-run'");
  const askAt = body.indexOf("Read-McAnswer");
  const chromiumAt = body.indexOf("@('install', 'chromium')");
  assert.ok(npmAt >= 0 && dryAt > npmAt && askAt > dryAt && chromiumAt > askAt, `order in Invoke-McBrowserInstall: npm ${npmAt}, dry run ${dryAt}, answer ${askAt}, chromium ${chromiumAt}`);
  assert.match(body, /--no-save/, "npm never edits a package.json of the checkout");
  assert.match(body, /ShouldProcess/, "-Browser steps honour -WhatIf");
});

test("Windows-only cmdlets live inside functions; the dispatcher after the guard calls none directly", () => {
  const guard = /if\s*\(\s*\$env:MCCLUSTER_NODE_PS_LIBRARY\s+-eq\s+'1'\s*\)\s*\{\s*return\s*\}/.exec(script);
  assert.ok(guard, "the guard statement exists");
  const dispatcher = script.slice(guard.index + guard[0].length);
  const direct = dispatcher.match(WINDOWS_ONLY) || [];
  assert.deepEqual(direct, [], `dispatcher calls Windows-only cmdlets directly: ${direct.join(", ")}`);
  for (const name of ["Get-CimInstance", "Get-ItemProperty", "Register-ScheduledTask", "Stop-ScheduledTask", "icacls", "powercfg", "Read-Host"]) {
    assert.ok(script.includes(name), `${name} is used somewhere in the script`);
  }
  assert.match(script, /Read-Host\s+-AsSecureString/, "the enrolment token is read as a secure string");
  assert.doesNotMatch(script, /Write-(?:Host|Output|Verbose)[^\n]*\$(?:plain|token|secret)\b/i, "the token is never printed");
});

test("the doctor, its tests, the runbook and the browser document carry no private strings and no AI vendor or model names", () => {
  for (const file of [SCRIPT, TESTS, RUNBOOK, DEVICES, BROWSER_DOC]) {
    const text = read(file);
    assert.equal(PRIVATE_STRINGS.exec(text), null, `private string in ${file}: ${PRIVATE_STRINGS.exec(text)?.[0]}`);
    assert.equal(VENDOR_NAMES.exec(text), null, `vendor or model name in ${file}: ${VENDOR_NAMES.exec(text)?.[0]}`);
  }
  for (const name of readdirSync(join(ROOT, FIXTURES))) {
    const text = read(`${FIXTURES}/${name}`);
    assert.equal(PRIVATE_STRINGS.exec(text), null, `private string in fixture ${name}`);
  }
});

test("brackets, strings, here-strings and comments balance in the script and its tests", () => {
  assertBalanced(script, SCRIPT);
  assertBalanced(read(TESTS), TESTS);
});

test("the fixtures are the recorded sets, CRLF where Windows tools emit CRLF, JSON where JSON, and equal to the Node copies byte for byte", () => {
  /* both directories carry a .gitattributes that keeps the recordings byte-exact (no CRLF normalization) */
  const recordings = (dir) => readdirSync(join(ROOT, dir)).filter((name) => !name.startsWith(".")).sort();
  const names = recordings(FIXTURES);
  assert.deepEqual(names, [
    "cim-780m-only.json", "cim-780m-rx7600s.json", "cim-no-gpu.json", "cim-nvidia-desktop.json",
    "nvidia-smi-desktop.csv", "powershell-error.txt",
    "reg-780m-only.txt", "reg-780m-rx7600s.txt", "reg-780m-stale-subkey.txt", "reg-no-gpu.txt", "reg-nvidia-desktop.txt",
  ]);
  for (const name of [...names, ".gitattributes"]) {
    assert.equal(read(`${FIXTURES}/${name}`), read(`core/test/fixtures/windows-hardware/${name}`), `${name} equals the Node test fixture byte for byte`);
  }
  assert.deepEqual(recordings("core/test/fixtures/windows-hardware"), names, "the two fixture sets hold the same files");
  assert.match(read(`${FIXTURES}/.gitattributes`), /\*\.txt -text/, "CRLF recordings are never normalized on checkout");
  for (const name of names) {
    const text = read(`${FIXTURES}/${name}`);
    if (name.endsWith(".json")) JSON.parse(text);
    if (name.endsWith(".txt")) {
      assert.ok(text.endsWith("\r\n"), `${name} ends with CRLF`);
      assert.equal(text.replace(/\r\n/g, "").includes("\n"), false, `${name} has only CRLF line endings`);
    }
  }
  const one = JSON.parse(read(`${FIXTURES}/cim-780m-only.json`));
  assert.equal(one.PNPDeviceID, "PCI\\VEN_1002&DEV_15BF&SUBSYS_8B4A103C&REV_C1\\3&11583659&0&08");
  assert.match(read(`${FIXTURES}/reg-780m-rx7600s.txt`), /HardwareInformation\.qwMemorySize\s{4}REG_QWORD\s{4}0x200000000\r\n/, "the 8 GiB discrete adapter is a REG_QWORD, not the wrapped AdapterRAM");
  assert.equal(JSON.parse(read(`${FIXTURES}/cim-780m-rx7600s.json`))[1].AdapterRAM, 4293918720, "AdapterRAM wraps above 4 GiB");
});

test("the pwsh tests are Pester-free and dot-source the doctor as a library", () => {
  const tests = read(TESTS);
  assert.doesNotMatch(tests, /Invoke-Pester|\bDescribe\s+['"]|\bShould\s+-/);
  assert.match(tests, /MCCLUSTER_NODE_PS_LIBRARY\s*=\s*'1'/);
  assert.match(tests, /\.\s+\$\w*[Ss]cript\w*/, "dot-sources the script path");
  assertBalanced(tests, TESTS);
});

test("the runbook names every switch, the template and the browser document; the protocol document carries the new vocabulary", () => {
  const runbook = read(RUNBOOK);
  for (const name of [...SWITCHES, ...VALUES, "WhatIf"]) assert.ok(runbook.includes(`-${name}`), `WINDOWS-NODE.md mentions -${name}`);
  assert.ok(runbook.includes("core/node-manifests/owner-windows-gpu.json"));
  assert.ok(runbook.includes(SCRIPT));
  assert.ok(runbook.includes("core/windows/tests/mccluster-node.tests.ps1"));
  assert.ok(runbook.includes("AGENT-NODE-BROWSER.md"), "the runbook points at the browser document");
  assert.ok(runbook.includes("browser-policy.json") && runbook.includes("127.0.0.1:4791"), "the runbook names the policy file and the executor port");
  const browserDoc = read(BROWSER_DOC);
  for (const word of ["-Browser", "-BrowserHeaded", "browser-policy.json", "mccluster-browser-policy/1", "127.0.0.1:4791", "browser.act", "chromium.local", "browser_act", "BROWSER_PRIVATE_ADDRESS", "BROWSER_HOST_NOT_ALLOWED", "BROWSER_POLICY_EMPTY", "allow_browser", "evidence"]) {
    assert.ok(browserDoc.includes(word), `AGENT-NODE-BROWSER.md mentions ${word}`);
  }
  assert.match(browserDoc, /unverified|not verified|never ran|has not run/i, "the browser document says what is not verified");
  const protocol = read(PROTOCOL);
  for (const word of ["hardware_mode", "gpu-verified", "gpu-present-unverified", "cpu-only", "live_gpu_nodes", "yield_seconds", "measured-inference.json", "vram_source"]) {
    assert.ok(protocol.includes(word), `COMPUTE-NODE-PROTOCOL.md mentions ${word}`);
  }
  assert.doesNotMatch(protocol, /when NVIDIA `nvidia-smi` is available;\n- runtime version/, "the stale nvidia-smi-only inventory sentence is gone");
  const devices = read(DEVICES);
  assert.ok(devices.includes("WINDOWS-NODE.md"));
  assert.ok(devices.includes("gpu-present-unverified"));
});

/* ---- the part that needs a PowerShell -------------------------------------------------- */
function findPwsh() {
  const candidates = [process.env.MCCLUSTER_PWSH, "pwsh"].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-NoProfile", "-NonInteractive", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8", timeout: 60_000 });
    if (!probe.error && probe.status === 0 && /^\d+\./.test(String(probe.stdout).trim())) return { command: candidate, version: String(probe.stdout).trim() };
  }
  return null;
}

test("PowerShell parse and core/windows/tests/mccluster-node.tests.ps1 (pwsh on PATH or MCCLUSTER_PWSH)", (t) => {
  const pwsh = findPwsh();
  if (!pwsh) {
    console.log(SKIP_LINE);
    t.skip(SKIP_LINE);
    return;
  }
  const env = { ...process.env, DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: "1", DOTNET_CLI_TELEMETRY_OPTOUT: "1", POWERSHELL_TELEMETRY_OPTOUT: "1" };
  const parse = execFileSync(pwsh.command, [
    "-NoProfile", "-NonInteractive", "-Command",
    `$e = $null; [System.Management.Automation.Language.Parser]::ParseFile('${join(ROOT, SCRIPT)}', [ref]$null, [ref]$e) | Out-Null; $e | ForEach-Object { $_.ToString() }; exit $e.Count`,
  ], { encoding: "utf8", env, timeout: 120_000 });
  assert.equal(parse.trim(), "", `parse errors: ${parse}`);
  const run = spawnSync(pwsh.command, ["-NoProfile", "-NonInteractive", "-File", join(ROOT, TESTS)], { encoding: "utf8", env, timeout: 300_000 });
  console.log(run.stdout);
  assert.equal(run.status, 0, `pwsh tests failed (${pwsh.version}):\n${run.stdout}\n${run.stderr}`);
});
