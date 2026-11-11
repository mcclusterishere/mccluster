/* THE CORE RUNNER / AGENT SPLIT, PINNED.
   McCluster Core runs two identities on the OVH plane: the runner
   (mccluster-core) holds the Supabase and GitHub credentials and talks to
   the control plane; the autonomous code agent (mccluster-agent) holds a
   loopback password and nothing else, sees the repositories read-only,
   cannot leave localhost, and can only ever hand work back as a DRAFT
   pull request that a person merges. These invariants were grep lines in
   a workflow; this test reads the committed files and names each one. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');
const directives = (unit) => read(unit).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

test('the agent unit runs as mccluster-agent with only the agent env file', () => {
  const d = directives('core/systemd/mccluster-opencode.service');
  assert.ok(d.includes('User=mccluster-agent'), 'User=mccluster-agent');
  assert.ok(d.includes('Group=mccluster-agent'), 'Group=mccluster-agent');
  const envFiles = d.filter((l) => l.startsWith('EnvironmentFile='));
  assert.deepEqual(envFiles, ['EnvironmentFile=/etc/mccluster/agent.env'], 'only /etc/mccluster/agent.env');
  assert.ok(!read('core/systemd/mccluster-opencode.service').includes('core.env'), 'core.env never reaches the agent');
});

test('the agent unit is confined to localhost and sees the repositories read-only', () => {
  const d = directives('core/systemd/mccluster-opencode.service');
  assert.ok(d.includes('IPAddressDeny=any'), 'IPAddressDeny=any');
  assert.ok(d.includes('IPAddressAllow=localhost'), 'IPAddressAllow=localhost');
  assert.ok(d.some((l) => /^ReadOnlyPaths=.*\/srv\/mccluster\/repos(\s|$)/.test(l)), 'ReadOnlyPaths=/srv/mccluster/repos');
  assert.ok(d.includes('NoNewPrivileges=true'), 'NoNewPrivileges=true');
  assert.ok(d.includes('ProtectSystem=strict'), 'ProtectSystem=strict');
});

test('the runner unit runs as mccluster-core, a different user from the agent', () => {
  const d = directives('core/systemd/mccluster-core-runner.service');
  assert.ok(d.includes('User=mccluster-core'), 'User=mccluster-core');
  assert.ok(d.includes('EnvironmentFile=/etc/mccluster/core.env'), 'the runner reads core.env');
  assert.ok(!d.includes('User=mccluster-agent'), 'the runner is not the agent');
});

test('the agent env example carries no Supabase, Twilio or GitHub credential', () => {
  const env = read('core/agent.env.example');
  const keys = env.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')[0]);
  assert.ok(keys.length > 0, 'the example declares keys');
  assert.ok(!keys.some((k) => /SUPABASE|TWILIO|GITHUB|GH_TOKEN|SERVICE_ROLE/.test(k)), `no control-plane credential name among ${keys.join(', ')}`);
  assert.match(env, /^OPENCODE_SERVER_USERNAME=/m, 'the loopback username is the only identity');
  assert.match(env, /^OPENCODE_SERVER_PASSWORD=$/m, 'the loopback password is left blank for the host to fill');
});

test('the OpenCode deny list keeps secrets and credential stores out of the agent', () => {
  const config = JSON.parse(read('core/opencode/opencode.json'));
  const denied = new Set(config.permissions.filter((p) => p.action === 'read' && p.effect === 'deny').map((p) => p.resource));
  for (const resource of ['*.env', '*.env.*', '*.pem', '*.key', '.git/config', '*/.git/config', '.git-credentials', '*/.git-credentials', 'hosts.yml', '*/hosts.yml']) {
    assert.ok(denied.has(resource), `read of ${resource} is denied`);
  }
  const shellDenied = new Set(config.permissions.filter((p) => p.action === 'shell' && p.effect === 'deny').map((p) => p.resource));
  for (const cmd of ['git push *', 'git commit *', 'git remote *', 'gh *', 'ssh *', 'curl *', 'wget *']) {
    assert.ok(shellDenied.has(cmd), `shell ${cmd} is denied`);
  }
  for (const [name, agent] of Object.entries(config.agents || {})) {
    const agentDenied = new Set(agent.permissions.filter((p) => p.action === 'shell' && p.effect === 'deny').map((p) => p.resource));
    for (const cmd of ['git push *', 'gh *']) assert.ok(agentDenied.has(cmd), `agent ${name}: shell ${cmd} is denied`);
  }
  assert.equal(config.websearch, false, 'no web search');
});

test('the code-patch executor opens draft pull requests and never merges', () => {
  const src = read('core/src/executors/code-patch.mjs');
  assert.match(src, /'pr',\s*'create',\s*'--draft'/, 'gh pr create --draft');
  assert.match(src, /draft-only/, 'the PR body says it is draft-only');
  /* prose may say "does not auto-merge", and --auto below is OpenCode's
     own run flag; what may not exist is a merge COMMAND: a gh "merge"
     argument, a --merge/--squash/--rebase flag, the GraphQL mutation, or
     a git merge */
  assert.doesNotMatch(src, /['"]merge['"]|--(merge|squash|rebase)\b|enablePullRequestAutoMerge|git merge/, 'no merge path of any kind');
  const ghCalls = [...src.matchAll(/run\(\s*'gh'\s*,\s*\[([^\]]*)\]/g)].map((m) => m[1]);
  assert.ok(ghCalls.length >= 1, 'gh is invoked');
  assert.ok(ghCalls.every((args) => !/'merge'|'--auto'/.test(args)), 'no gh call merges or arms auto-merge');
});

test('child processes get an env allowlist, never the runner environment', () => {
  const src = read('core/src/process.mjs');
  const allow = /const allowed = \[([^\]]*)\]/.exec(src);
  assert.ok(allow, 'childEnv builds from an explicit allowlist');
  const names = [...allow[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
  assert.ok(names.includes('PATH') && names.includes('HOME'), 'PATH and HOME pass through');
  assert.ok(!names.some((n) => /SUPABASE|GITHUB|TOKEN|KEY|SECRET|PASSWORD/.test(n)), 'no credential name in the allowlist');
  assert.match(src, /env:\s*childEnv\(options\.env\)/, 'spawn uses childEnv');
  assert.match(src, /shell:\s*false/, 'spawn never goes through a shell');
  assert.doesNotMatch(src, /\.\.\.process\.env/, 'the whole environment is never spread into a child');
});
