/* ============================================================
   GITHUB — the code, and what ships from it.

   Every call names an estate repository by node key and resolves it
   to `owner/repo` through ops_estate_nodes. There is no free-text
   repository parameter anywhere in this file: a caller cannot point
   the house's token at a repository the owner never registered, and
   `Here` (seeded disabled) cannot be written to at all.

   The default branch is treated as production, because on the control
   repo it is: a commit to `main` is a live deploy of
   matthew.mccluster.org. So writing there is a separate, higher-risk
   action rather than a parameter on the ordinary one.
   ============================================================ */

import { clampInt, notConfigured, opsError, providerFetch, text } from '../lib.js';

const API = 'https://api.github.com';
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function configured(env) {
  return Boolean(env.GITHUB_CONTROL_TOKEN);
}

function headers(env) {
  if (!configured(env)) throw notConfigured('GitHub', ['GITHUB_CONTROL_TOKEN']);
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${env.GITHUB_CONTROL_TOKEN}`,
    'x-github-api-version': '2022-11-28',
    'user-agent': 'mccluster-control-plane',
    'content-type': 'application/json'
  };
}

function repoOf(node) {
  const ref = text(node?.provider_ref, 200);
  if (!REPO.test(ref)) {
    throw opsError('Estate node does not name a GitHub repository', 400, {
      code: 'node_not_a_repository', node_key: node?.node_key || null
    });
  }
  return ref;
}

async function call(env, path, init = {}) {
  return providerFetch('GitHub', `${API}${path}`, { ...init, headers: { ...headers(env), ...(init.headers || {}) } });
}

/* GitHub answers "what is the default branch" on the repo object, and
   nothing downstream is allowed to assume `main`: a satellite in the
   registry can and does ship from `production` or a claude/* branch. */
async function repoObject(env, repo) {
  const { body } = await call(env, `/repos/${repo}`);
  return body;
}

export async function repoState(env, node) {
  const repo = repoOf(node);
  const info = await repoObject(env, repo);
  const branch = info?.default_branch || node?.default_branch || 'main';
  const [commit, pulls, runs] = await Promise.all([
    call(env, `/repos/${repo}/commits/${encodeURIComponent(branch)}`).then((r) => r.body).catch(() => null),
    call(env, `/repos/${repo}/pulls?state=open&per_page=20`).then((r) => r.body).catch(() => null),
    call(env, `/repos/${repo}/actions/runs?per_page=5`).then((r) => r.body).catch(() => null)
  ]);
  return {
    repository: repo,
    private: info?.private ?? null,
    default_branch: branch,
    registry_branch: node?.default_branch || null,
    /* A satellite whose registry branch is not the repo default is not
       broken — several ship from a feature branch — but the operator
       should see the difference rather than discover it at deploy time. */
    branch_matches_registry: !node?.default_branch || node.default_branch === branch,
    pushed_at: info?.pushed_at || null,
    head: commit ? {
      sha: commit.sha,
      message: text(commit.commit?.message, 300),
      author: commit.commit?.author?.name || null,
      committed_at: commit.commit?.author?.date || null
    } : null,
    open_pull_requests: Array.isArray(pulls)
      ? pulls.map((pr) => ({ number: pr.number, title: text(pr.title, 200), head: pr.head?.ref, draft: pr.draft }))
      : [],
    recent_runs: Array.isArray(runs?.workflow_runs)
      ? runs.workflow_runs.map((run) => ({
        id: run.id, name: run.name, branch: run.head_branch,
        status: run.status, conclusion: run.conclusion, started_at: run.run_started_at
      }))
      : []
  };
}

export async function listBranches(env, node, params) {
  const repo = repoOf(node);
  const limit = clampInt(params.limit, 30, 1, 100);
  const { body } = await call(env, `/repos/${repo}/branches?per_page=${limit}`);
  return {
    repository: repo,
    branches: (Array.isArray(body) ? body : []).map((b) => ({ name: b.name, sha: b.commit?.sha, protected: b.protected }))
  };
}

export async function listCommits(env, node, params) {
  const repo = repoOf(node);
  const limit = clampInt(params.limit, 20, 1, 100);
  const ref = text(params.ref, 250) || node?.default_branch || '';
  const query = new URLSearchParams({ per_page: String(limit) });
  if (ref) query.set('sha', ref);
  const { body } = await call(env, `/repos/${repo}/commits?${query}`);
  return {
    repository: repo,
    ref: ref || null,
    commits: (Array.isArray(body) ? body : []).map((c) => ({
      sha: c.sha, message: text(c.commit?.message, 300),
      author: c.commit?.author?.name || null, committed_at: c.commit?.author?.date || null
    }))
  };
}

export async function readFile(env, node, params) {
  const repo = repoOf(node);
  const path = filePath(params.path);
  const ref = text(params.ref, 250) || node?.default_branch || '';
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const { body } = await call(env, `/repos/${repo}/contents/${path}${query}`);
  if (Array.isArray(body)) {
    return { repository: repo, path, kind: 'directory', entries: body.map((e) => ({ name: e.name, type: e.type, size: e.size })) };
  }
  const content = body?.content && body?.encoding === 'base64' ? atob(String(body.content).replace(/\n/g, '')) : null;
  return {
    repository: repo, path, kind: 'file', sha: body?.sha || null, size: body?.size ?? null,
    /* 512 KiB of a file is a read; a whole binary is an exfiltration
       shaped like one. Anything larger comes back as a pointer. */
    content: content && content.length <= 512 * 1024 ? content : null,
    too_large: Boolean(content && content.length > 512 * 1024),
    download_url: body?.download_url || null
  };
}

export async function listPulls(env, node, params) {
  const repo = repoOf(node);
  const state = ['open', 'closed', 'all'].includes(text(params.state, 10)) ? params.state : 'open';
  const limit = clampInt(params.limit, 20, 1, 100);
  const { body } = await call(env, `/repos/${repo}/pulls?state=${state}&per_page=${limit}`);
  return {
    repository: repo,
    pull_requests: (Array.isArray(body) ? body : []).map((pr) => ({
      number: pr.number, title: text(pr.title, 200), state: pr.state, draft: pr.draft,
      head: pr.head?.ref, base: pr.base?.ref, mergeable_state: pr.mergeable_state || null,
      url: pr.html_url, updated_at: pr.updated_at
    }))
  };
}

export async function listWorkflows(env, node) {
  const repo = repoOf(node);
  const { body } = await call(env, `/repos/${repo}/actions/workflows?per_page=100`);
  return {
    repository: repo,
    workflows: (Array.isArray(body?.workflows) ? body.workflows : []).map((w) => ({
      id: w.id, name: w.name, path: w.path, state: w.state
    }))
  };
}

export async function listRuns(env, node, params) {
  const repo = repoOf(node);
  const limit = clampInt(params.limit, 20, 1, 100);
  const workflow = text(params.workflow, 200);
  const branch = text(params.branch, 250);
  const query = new URLSearchParams({ per_page: String(limit) });
  if (branch) query.set('branch', branch);
  const scope = workflow ? `/workflows/${encodeURIComponent(workflow)}/runs` : '/runs';
  const { body } = await call(env, `/repos/${repo}/actions${scope}?${query}`);
  return {
    repository: repo,
    runs: (Array.isArray(body?.workflow_runs) ? body.workflow_runs : []).map((run) => ({
      id: run.id, name: run.name, branch: run.head_branch, event: run.event,
      status: run.status, conclusion: run.conclusion, started_at: run.run_started_at, url: run.html_url
    }))
  };
}

function branchName(value) {
  const branch = text(value, 250);
  if (!branch || /[\s~^:?*\[\\]/.test(branch) || branch.startsWith('/') || branch.includes('..')) {
    throw opsError('branch is not a valid git ref', 400, { code: 'invalid_branch' });
  }
  return branch;
}

function filePath(value) {
  const path = text(value, 400).replace(/^\/+/, '');
  if (!path || path.includes('..') || path.startsWith('.git/')) {
    throw opsError('path is not a writable repository path', 400, { code: 'invalid_path' });
  }
  return path.split('/').map(encodeURIComponent).join('/');
}

export async function createBranch(env, node, params) {
  const repo = repoOf(node);
  const branch = branchName(params.branch);
  const info = await repoObject(env, repo);
  const from = text(params.from_ref, 250) || info?.default_branch || 'main';
  const { body: base } = await call(env, `/repos/${repo}/git/ref/heads/${encodeURIComponent(from)}`);
  const sha = base?.object?.sha;
  if (!sha) throw opsError('Could not resolve the source ref', 404, { code: 'ref_not_found', from });
  const { body } = await call(env, `/repos/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha })
  });
  return { repository: repo, branch, from, sha: body?.object?.sha || sha };
}

/* One writer for both write actions. `allowDefaultBranch` is not a
   parameter a caller can pass — it is set by which catalogue action
   the request came in through, and the protected one is `infra.mutate`,
   so a commit to a default branch always crossed an approval. */
async function writeFile(env, node, params, { allowDefaultBranch }) {
  const repo = repoOf(node);
  const info = await repoObject(env, repo);
  const defaultBranch = info?.default_branch || 'main';
  const branch = allowDefaultBranch ? defaultBranch : branchName(params.branch);

  if (!allowDefaultBranch && branch === defaultBranch) {
    throw opsError(
      'Committing to the default branch is github.file.write.protected, which needs an approval',
      403,
      { code: 'default_branch_write_refused', repository: repo, default_branch: defaultBranch }
    );
  }

  const path = filePath(params.path);
  const message = text(params.message, 500);
  if (!message) throw opsError('message is required', 400, { code: 'missing_parameter', parameter: 'message' });

  const raw = String(params.content ?? '');
  const base64 = text(params.encoding, 20) === 'base64' ? raw.replace(/\s+/g, '') : btoa(unescape(encodeURIComponent(raw)));

  /* An update needs the blob sha it is replacing. Fetching it here, in
     the same call, is what makes a concurrent edit a 409 from GitHub
     rather than a silent overwrite of somebody else's commit. */
  let sha = null;
  try {
    const { body } = await call(env, `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
    sha = Array.isArray(body) ? null : body?.sha || null;
  } catch (error) {
    if (error?.status !== 404) throw error;
  }

  const { body } = await call(env, `/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: base64, branch, ...(sha ? { sha } : {}) })
  });
  return {
    repository: repo, path, branch, created: !sha,
    commit: body?.commit?.sha || null, url: body?.content?.html_url || null
  };
}

export function writeWorkingFile(env, node, params) {
  return writeFile(env, node, params, { allowDefaultBranch: false });
}

export function writeProtectedFile(env, node, params) {
  return writeFile(env, node, params, { allowDefaultBranch: true });
}

export async function openPullRequest(env, node, params) {
  const repo = repoOf(node);
  const info = await repoObject(env, repo);
  const head = branchName(params.head);
  const base = text(params.base, 250) || info?.default_branch || 'main';
  const title = text(params.title, 250);
  if (!title) throw opsError('title is required', 400, { code: 'missing_parameter', parameter: 'title' });
  const { body } = await call(env, `/repos/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title, head, base, draft: params.draft === true,
      body: text(params.body, 20_000) || 'Opened by the McCluster control plane.'
    })
  });
  return { repository: repo, number: body?.number, url: body?.html_url, head, base, draft: Boolean(body?.draft) };
}

export async function dispatchWorkflow(env, node, params) {
  const repo = repoOf(node);
  const workflow = text(params.workflow, 200);
  if (!workflow) throw opsError('workflow is required', 400, { code: 'missing_parameter', parameter: 'workflow' });
  const info = await repoObject(env, repo);
  const ref = text(params.ref, 250) || node?.default_branch || info?.default_branch || 'main';
  const inputs = params.inputs && typeof params.inputs === 'object' && !Array.isArray(params.inputs) ? params.inputs : {};
  await call(env, `/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref, inputs })
  });
  /* The dispatch endpoint answers 204 with no run id, so the operator
     gets the list they would otherwise have to go and find. */
  const recent = await listRuns(env, node, { workflow, branch: ref, limit: 3 }).catch(() => null);
  return { repository: repo, workflow, ref, dispatched: true, recent_runs: recent?.runs || [] };
}

export async function rerunRun(env, node, params) {
  const repo = repoOf(node);
  const runId = clampInt(params.run_id, 0, 1, Number.MAX_SAFE_INTEGER);
  if (!runId) throw opsError('run_id is required', 400, { code: 'missing_parameter', parameter: 'run_id' });
  const suffix = params.failed_only === true ? 'rerun-failed-jobs' : 'rerun';
  await call(env, `/repos/${repo}/actions/runs/${runId}/${suffix}`, { method: 'POST' });
  return { repository: repo, run_id: runId, mode: suffix };
}

export async function mergePullRequest(env, node, params) {
  const repo = repoOf(node);
  const number = clampInt(params.number, 0, 1, Number.MAX_SAFE_INTEGER);
  if (!number) throw opsError('number is required', 400, { code: 'missing_parameter', parameter: 'number' });
  const method = ['merge', 'squash', 'rebase'].includes(text(params.method, 10)) ? params.method : 'squash';
  const { body } = await call(env, `/repos/${repo}/pulls/${number}/merge`, {
    method: 'PUT',
    body: JSON.stringify({ merge_method: method, ...(params.title ? { commit_title: text(params.title, 250) } : {}) })
  });
  return { repository: repo, number, merged: body?.merged === true, sha: body?.sha || null, method };
}
