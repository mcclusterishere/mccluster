# McCluster Core runner

`core/` is the persistent execution layer for the McCluster control plane. It runs on the OVH VPS and consumes the existing canonical Supabase queue (`public.ops_agent_jobs`). It is deliberately **not** another database, another Cloudflare Worker, or another source of truth.

## What v0 does

The runner polls `ops_agent_jobs`, atomically claims only job types it actually knows how to execute, heartbeats while work is running, retries with backoff, and stores structured results back on the same job row.

Allowlisted executors:

- `repo_health` — fetches repository state and can run already-installed local tests; it never installs packages during a health check.
- `local_analysis` — sends a bounded analysis task to the local Ollama model. Its evidence scope is explicitly `job_input_only`.
- `code_patch` — creates a disposable Git worktree, asks a separate low-privilege OpenCode service to edit it with the local model, rejects sensitive-path diffs, commits the accepted diff, optionally pushes a branch, and attempts to open a **draft PR**. It never auto-merges or deploys.

Existing unsupported queue types remain queued. Core does not fake completion for jobs whose real data/tool adapter has not been built yet.

## Capability registry and tool bus

Core now separates **what McCluster can do** from **which provider currently does it**.

- `core/capabilities/catalog.json` defines stable McCluster capability ids such as `video.generate`, `model3d.generate`, `code.build`, and `deploy.preview`.
- `core/src/capabilities/registry.mjs` resolves active provider bindings against tools that are actually discoverable right now.
- `core/src/tools/registry.mjs` is the lower-level execution bus for MCP and ordinary HTTP tools.
- `core/src/tool-broker.mjs` exposes both layers on loopback over MCP and HTTP.

Products and agents should prefer stable capability ids. Provider-specific/raw tools remain available for diagnostics and expert operation. A planned capability stays visible in the catalog but fails closed until a real implementation is bound and discoverable.

See `docs/control-plane/CAPABILITY-REGISTRY.md` and `core/TOOL-BROKER.md` for the contracts.

## Process isolation

There are two Unix identities plus one shared worktree group:

- `mccluster-core`: owns the runner, Supabase service credential, optional Twilio credential, and GitHub credential used to push branches/open draft PRs.
- `mccluster-agent`: owns the OpenCode server. It receives **no Supabase, Twilio, or GitHub production credential**.
- `mccluster-work`: grants both identities access to disposable worktrees only.

`mccluster-opencode.service` is constrained to localhost networking with systemd. It can reach Ollama on `127.0.0.1:11434` and its own loopback server, but not the public internet or production APIs. The repository store is mounted read-only to that service; only `/srv/mccluster/worktrees` is writable.

OpenCode also has explicit tool-policy denies for web access, subagents, external directories, Git pushes/commits/remotes, GitHub CLI, SSH/SCP/SFTP, curl, wget, `.env`, private-key, and credential files. The parent runner performs Git commits/pushes after inspecting the diff.

## Local model

The default is `qwen3:8b` through Ollama. Keep Ollama loopback-only. `core/systemd/ollama-mccluster.conf` caps the host at one loaded model and one parallel request, with a 16k default context and a 10 GB service memory ceiling.

A larger model can be tested later, but do not make a ~19–20 GB model the always-loaded default on a 24 GB VPS: it leaves too little recovery and OS headroom.

## Host layout

```text
/opt/mccluster/core                 root-owned deployed runner code
/etc/mccluster/core.env             root:mccluster-core 0640 — production secrets
/etc/mccluster/agent.env            root:mccluster-agent 0640 — loopback OpenCode password only
/var/lib/mccluster-core             runner HOME / GitHub CLI credential store
/var/lib/mccluster-agent            OpenCode HOME/config/state
/srv/mccluster/repos                persistent source clones
/srv/mccluster/worktrees            disposable autonomous coding worktrees
```

## 1. Install official host runtimes

Ubuntu packages:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git gh jq nodejs npm openssl rsync
node --version   # must be >= 20
```

Install Ollama using its official Linux installer, then keep it as its systemd service:

```bash
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable --now ollama
ollama pull qwen3:8b
```

Install the current stable OpenCode CLI:

```bash
sudo npm install -g opencode-ai
command -v opencode
```

## 2. Create the isolated identities

```bash
sudo groupadd --system mccluster-work || true
sudo groupadd --system mccluster-core || true
sudo groupadd --system mccluster-agent || true

id mccluster-core >/dev/null 2>&1 || sudo useradd --system --create-home \
  --home-dir /var/lib/mccluster-core --shell /usr/sbin/nologin \
  --gid mccluster-core --groups mccluster-work mccluster-core

id mccluster-agent >/dev/null 2>&1 || sudo useradd --system --create-home \
  --home-dir /var/lib/mccluster-agent --shell /usr/sbin/nologin \
  --gid mccluster-agent --groups mccluster-work mccluster-agent
```

For existing users, ensure both are members of `mccluster-work` while retaining their private primary groups.

## 3. Create directories and deploy this package

From a checkout of this repository:

```bash
sudo install -d -o root -g mccluster-work -m 2770 \
  /srv/mccluster /srv/mccluster/repos /srv/mccluster/worktrees
sudo install -d -o mccluster-core -g mccluster-core -m 0750 /var/lib/mccluster-core
sudo install -d -o mccluster-agent -g mccluster-agent -m 0750 \
  /var/lib/mccluster-agent /var/lib/mccluster-agent/.config /var/lib/mccluster-agent/.config/opencode
sudo install -d -o root -g root -m 0755 /opt/mccluster /etc/mccluster

sudo rsync -a --delete --exclude node_modules core/ /opt/mccluster/core/
sudo chown -R root:root /opt/mccluster/core
sudo chmod -R u=rwX,go=rX /opt/mccluster/core

sudo install -o mccluster-agent -g mccluster-agent -m 0640 \
  core/opencode/opencode.json /var/lib/mccluster-agent/.config/opencode/opencode.json
```

Clone the canonical repo as the runner identity if it is not already present:

```bash
sudo -u mccluster-core git clone https://github.com/mcclusterishere/mccluster.git \
  /srv/mccluster/repos/mccluster
sudo chgrp -R mccluster-work /srv/mccluster/repos/mccluster
sudo chmod -R g+rX /srv/mccluster/repos/mccluster
```

## 4. Configure secrets without exposing them to the agent

Generate a password used only between the runner CLI client and the loopback OpenCode server:

```bash
openssl rand -hex 32
```

Copy `core/agent.env.example` to `/etc/mccluster/agent.env`, put that random value in `OPENCODE_SERVER_PASSWORD`, then:

```bash
sudo chown root:mccluster-agent /etc/mccluster/agent.env
sudo chmod 0640 /etc/mccluster/agent.env
```

Copy `core/core.env.example` to `/etc/mccluster/core.env`. Put the same OpenCode password there, plus the canonical Supabase service-role credential and house organization ID. Add Twilio values only if SMS delivery is desired.

```bash
sudo chown root:mccluster-core /etc/mccluster/core.env
sudo chmod 0640 /etc/mccluster/core.env
```

Never place either populated file in Git.

## 5. Install systemd policies

```bash
sudo install -m 0644 core/systemd/mccluster-opencode.service /etc/systemd/system/
sudo install -m 0644 core/systemd/mccluster-core-runner.service /etc/systemd/system/
sudo install -m 0644 core/systemd/mccluster-core-digest.service /etc/systemd/system/
sudo install -m 0644 core/systemd/mccluster-core-digest.timer /etc/systemd/system/
sudo install -m 0644 core/systemd/mccluster-tool-broker.service /etc/systemd/system/

sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo install -m 0644 core/systemd/ollama-mccluster.conf \
  /etc/systemd/system/ollama.service.d/mccluster.conf

sudo systemctl daemon-reload
sudo systemctl restart ollama
sudo systemctl enable --now mccluster-opencode.service
sudo systemctl enable --now mccluster-tool-broker.service
sudo systemctl enable --now mccluster-core-runner.service
sudo systemctl enable --now mccluster-core-digest.timer
```

The digest timer defaults to 7:30 AM `America/New_York` and can be edited without changing runner code.

## 6. GitHub identity for autonomous draft PRs

Authenticate GitHub **only for `mccluster-core`** using a credential mechanism you control. Do not place the credential in `agent.env`; the OpenCode user should never possess it. If GitHub auth is not configured, `code_patch` can still prepare a local commit but branch push/PR creation will fail and the job will report that failure/retry instead of silently claiming success.

## Verify

```bash
sudo systemctl status ollama mccluster-opencode mccluster-tool-broker mccluster-core-runner --no-pager
sudo systemctl list-timers mccluster-core-digest.timer
curl -s http://127.0.0.1:11434/api/tags | jq '.models[].name'
curl -s http://127.0.0.1:4777/health | jq
curl -s http://127.0.0.1:4777/v1/capabilities | jq '.capabilities[] | {id,available,providers}'
sudo journalctl -u mccluster-core-runner -u mccluster-opencode -u mccluster-tool-broker -n 100 --no-pager
```

The runner logs one JSON object per lifecycle event, so journald can be shipped later without changing the application protocol.

## Queue examples

Do not hand-edit the queue from the VPS. New jobs should come through a reviewed control-plane API/automation. Conceptually, v0 expects payloads shaped like:

```json
{
  "job_type": "local_analysis",
  "target_type": "portfolio",
  "target_id": "McCluster",
  "input": {
    "task": "Rank these supplied objectives and identify blockers",
    "evidence": {"objectives": []}
  }
}
```

```json
{
  "job_type": "code_patch",
  "target_type": "repo",
  "target_id": "mcclusterishere/mccluster",
  "input": {
    "task": "Add tests for the specified existing module",
    "allowed_paths": ["workers/mccluster"]
  }
}
```

`allowed_paths` narrows the autonomous edit surface. Sensitive control-plane paths are denied even if omitted from the list.

## Morning digest

`mccluster-core-digest.timer` runs every morning. It summarizes jobs updated in the configured lookback period, writes the digest into `ops_signals`, and sends an SMS when Twilio is configured. Without Twilio it still records the digest and journals the output.

This is intentionally a status report, not a second scheduler. The durable source of work remains `ops_agent_jobs`.
