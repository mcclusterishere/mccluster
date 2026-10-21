import { createHash } from 'node:crypto';
import path from 'node:path';
import { rest, enqueueJob } from './supabase.mjs';
import { run } from './process.mjs';
import { coreResume } from './tools/resume.mjs';
import { searchPrivateContext } from './context-client.mjs';
import { localAiDiagnostics } from './compute/local-ai-client.mjs';
import { callCoreCapability, unwrapCapabilityResult } from './game-studio/capability-client.mjs';

const string = { type: 'string' };
const tool = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
export const RESIDENT_TOOLS = Object.freeze([
  tool('connections_read', 'Explore source-backed connections between entities, jobs, evidence, claims, briefings, decisions, missions and outcomes. Use root actor:royce.r01 for Royce, or kind evidence to browse evidence. Missing links are unknown, not proof of no relationship. Automated publication reviews are not human approvals.', {root:string,kind:string,depth:{type:'integer',minimum:1,maximum:3}}),
  tool('knowledge_read', 'Read stored news, intelligence evidence, first-party aggregate analytics and daily knowledge memory. Source headlines are unverified; returns bounded excerpts. Optional query filters news and memory, not analytics totals.', { query: string, days: { type: 'integer', minimum: 1, maximum: 30 } }),
  tool('operations_read', 'Read actual deployment, recent jobs, objectives and pending approvals. Use for questions about McCluster system status.'),
  tool('memory_search', 'Search saved conversations and canonical memories across McCluster. Supply a few precise keywords; use OR between alternatives.', { query: string }, ['query']),
  tool('repository_search', 'Search tracked source code and documentation in the canonical McCluster repository. Literal search, returns file names and lines.', { query: string }, ['query']),
  tool('repository_read', 'Read a tracked text file from the canonical repository, with line numbers. Use paths returned by repository_search.', { path: string, start_line: { type: 'integer', minimum: 1 } }, ['path']),
  tool('funding_search', 'Read stored funding routes, eligibility notes, criteria and source URLs. Stored criteria may be unverified; they do not prove eligibility.', { query: string }, ['query']),
  tool('web_search', 'Search the public web through the existing research.web capability. Search snippets are discovery evidence, not verified full pages.', { query: string }, ['query']),
  tool('analysis_queue', 'Queue a durable internal analysis or draft using supplied evidence. Returns a job ID, not a completed result. Does not send, publish, deploy or spend.', { task: string, evidence: string }, ['task', 'evidence']),
  tool('job_read', 'Read the status and result of a previously queued McCluster job.', { job_id: string }, ['job_id']),
  tool('ai_diagnostics', 'Read the installed local model, Ollama version, model settings and active inference state.'),
]);

function text(value, max) { return String(value || '').trim().slice(0, max); }
export function validateResidentTool(name, args) {
  const definition = RESIDENT_TOOLS.find(item => item.function.name === name)?.function;
  if (!definition) throw new Error(`Tool is outside resident authority: ${name}`);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Tool arguments must be an object');
  for (const key of Object.keys(args)) {
    const property = definition.parameters.properties[key];
    if (!property) throw new Error(`Unexpected argument: ${key}`);
    if (property.type === 'string' && (typeof args[key] !== 'string' || args[key].length > 12000)) throw new Error(`Invalid ${key}`);
    if (property.type === 'integer' && (!Number.isSafeInteger(args[key]) || args[key] < 1 || args[key] > 100000)) throw new Error(`Invalid ${key}`);
  }
  for (const key of definition.parameters.required) if (!text(args[key], 12000)) throw new Error(`${key} is required`);
  return args;
}

export function stableAnalysisId(turnId, task, evidence) {
  const hash = createHash('sha256').update(JSON.stringify([turnId, task, evidence])).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

const REPO = path.join(process.env.MCCLUSTER_REPO_ROOT || '/srv/mccluster/repos', 'mccluster');
const PRIVATE_PATH = /(?:^|\/)(?:\.env(?:\.|$)|\.git(?:\/|$)|[^/]*(?:credential|secret|private[-_]?key)[^/]*$)|\.(?:pem|key|p12|pfx)$/i;
export function safeRepositoryPath(value) {
  const file = text(value, 400);
  if (!file || path.isAbsolute(file) || file.split(/[\\/]/).includes('..') || /[\x00-\x1f\\:]/.test(file) || PRIVATE_PATH.test(file)) throw new Error('Repository path is outside the readable source scope');
  return file;
}

export async function executeResidentTool(name, args, context, dependencies = {}) {
  validateResidentTool(name, args);
  const { orgId, turnId, before } = context;
  if (!orgId || !turnId) throw new Error('Trusted organization and turn are required');
  const query = dependencies.rest || rest;
  if (name === 'connections_read') {
    const root = text(args.root, 550) || null, kind = text(args.kind, 80) || 'actor';
    if ((root && !/^[a-z_]+:[a-zA-Z0-9._:-]+$/.test(root)) || !/^[a-z_]{1,80}$/.test(kind)) throw new Error('Invalid graph reference');
    const {body} = await query('rpc/ops_connected_graph_service', {method:'POST',body:JSON.stringify({p_org:orgId,p_root:root,p_kind:kind,p_depth:Math.min(3,args.depth||2),p_limit:30})});
    return body;
  }
  if (name === 'knowledge_read') {
    const { body } = await query('rpc/ops_ai_knowledge_read', { method: 'POST', body: JSON.stringify({ p_org_id: orgId, p_query: text(args.query, 200), p_days: Math.min(30, args.days || 1) }) });
    return body;
  }
  if (name === 'operations_read') {
    const snapshot = await (dependencies.coreResume || coreResume)({ orgId, sinceHours: 24, limit: 6 });
    const work = snapshot.work || {};
    return {
      generated_at: snapshot.generated_at, deployed_commit: snapshot.runtime?.core_commit || null,
      sources: snapshot.sources, degraded_sources: snapshot.degraded_sources, source_errors: snapshot.source_errors,
      work: Object.fromEntries(['active_jobs', 'stale_running_jobs', 'queued_jobs', 'stale_queued_jobs', 'recent_failures', 'objectives'].map(key => [key, Array.isArray(work[key]) ? work[key].slice(0, 3) : null])),
      pending_approvals: snapshot.pending_approvals?.slice(0, 3) ?? null,
      scope: 'At most three records per category; not organization-wide totals. Use job_read for a job result.',
    };
  }
  if (name === 'memory_search') return (dependencies.searchPrivateContext || searchPrivateContext)({ orgId, query: text(args.query, 500), limit: 6, before });
  if (name === 'ai_diagnostics') return (dependencies.localAiDiagnostics || localAiDiagnostics)();
  if (name === 'web_search') return unwrapCapabilityResult(await (dependencies.callCoreCapability || callCoreCapability)('research.web', { objective: text(args.query, 380), limit: 5 }, { timeoutMs: 35000 }));
  if (name === 'repository_search') {
    const result = await (dependencies.run || run)('git', ['grep', '-n', '-I', '-F', '-m', '3', '-e', text(args.query, 160), 'HEAD', '--', '*.mjs', '*.js', '*.ts', '*.md', '*.json', '*.sql', '*.yml'], { cwd: REPO, timeoutMs: 10000 }).catch(error => {
      if (error.result?.code === 1) return { stdout: '' };
      throw error;
    });
    return { repository: 'mcclusterishere/mccluster', revision: 'local HEAD', matches: result.stdout.split('\n').filter(line => line && !PRIVATE_PATH.test(line.split(':')[1] || '')).slice(0, 30).map(line => line.slice(0, 400)) };
  }
  if (name === 'repository_read') {
    const file = safeRepositoryPath(args.path);
    const result = await (dependencies.run || run)('git', ['show', `HEAD:${file}`], { cwd: REPO, timeoutMs: 10000 });
    const lines = result.stdout.split('\n');
    const start = args.start_line || 1;
    return { repository: 'mcclusterishere/mccluster', path: file, start_line: start, total_lines: lines.length, lines: lines.slice(start - 1, start + 79).map((line, i) => `${start + i}: ${line.slice(0, 400)}`) };
  }
  if (name === 'funding_search') {
    const term = text(args.query, 120).replace(/[^\p{L}\p{N}\s_-]/gu, '').trim();
    if (!term) throw new Error('Funding search requires text');
    const params = new URLSearchParams({ select: 'opportunity_id,funder_name,program_title,availability,source_url,eligibility_note,reviewed_at,criteria_register', or: `(program_title.ilike.*${term}*,funder_name.ilike.*${term}*,eligibility_note.ilike.*${term}*)`, limit: '4' });
    const { body } = await query(`action_funding_opportunities?${params}`);
    return { observed_at: new Date().toISOString(), eligibility_verified: false, routes: (body || []).map(row => ({ ...row, criteria_register: row.criteria_register ? { route_id: row.criteria_register.route_id, requirements_complete: row.criteria_register.requirements_complete, applicant_eligibility: row.criteria_register.applicant_eligibility, criteria: row.criteria_register.criteria?.slice(0, 8) } : null })) };
  }
  if (name === 'analysis_queue') {
    const task = text(args.task, 6000), evidence = text(args.evidence, 6000);
    const id = stableAnalysisId(turnId, task, evidence);
    const job = await (dependencies.enqueueJob || enqueueJob)({ jobId: id, orgId, jobType: 'local_analysis', targetType: 'resident_request', targetId: turnId, priority: 50, maxAttempts: 2, input: { task, evidence: [{ source: `resident-turn:${turnId}`, content: evidence }], parent_turn_id: turnId } });
    return { queued: true, job_id: job.id, status: job.status, completed: job.status === 'done', note: 'Use job_read to retrieve the durable result; no external action was taken.' };
  }
  if (name === 'job_read') {
    if (!/^[0-9a-f-]{36}$/i.test(args.job_id)) throw new Error('A valid job UUID is required');
    const params = new URLSearchParams({ org_id: `eq.${orgId}`, id: `eq.${args.job_id}`, select: 'id,job_type,status,output,last_error,created_at,updated_at', limit: '1' });
    const { body } = await query(`ops_agent_jobs?${params}`);
    if (!body?.length) throw new Error('Job not found in this organization');
    return body[0];
  }
  throw new Error('Unimplemented resident tool');
}
