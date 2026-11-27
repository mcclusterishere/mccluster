/* ============================================================
   DISPATCH ROUTING TABLE.

   The dispatch layer is McCluster's conversational front end: a small
   resident model reads one owner message, decides what it is, and
   hands it to an existing backend path. This file is the only list of
   places a message may go. The model may only pick an intent from here.

   Coverage is total and checked by test (core/test/dispatch-layer.test.mjs):
     * every capability in core/capabilities/catalog.json is either a
       route here (risk, approval and required arguments read from the
       catalog entry itself) or in EXCLUDED_CAPABILITIES with a reason;
     * every job type the Core runner executes (core/src/runner.mjs) is
       reachable through a capability route, a direct job route below
       (enqueued on ops_agent_jobs with the existing enqueueJob), the
       answer path, or is in EXCLUDED_JOB_TYPES with a reason.

   Direct job routes have no catalog entry, so they declare their own
   risk and approval here; anything that posts publicly, fans out more
   jobs or writes shared data is held for approval.

   Contract: docs/control-plane/DISPATCH-LAYER.md
   ============================================================ */

import { readFileSync } from 'node:fs';

export const DISPATCH_SCHEMA = 'mccluster-dispatch/1';
export const CATALOG = JSON.parse(readFileSync(new URL('../../capabilities/catalog.json', import.meta.url), 'utf8'));

/* Intents the front end itself answers (no capability is called). */
export const CONVERSATION_INTENTS = Object.freeze(['answer', 'clarify']);

/* Catalog capabilities a chat message can never reach. */
export const EXCLUDED_CAPABILITIES = Object.freeze({
  'browser.act': 'Owner-only and agent-interface only: it drives the owner\'s own browser and runs only inside a resident McCluster turn the owner opened with the browser switch on.',
  'site.edit': 'The public website. Owner-only edits happen in Control, never from a routed chat message.',
  'dispatch.turn': 'The dispatch layer itself; it never routes into itself.',
  'dispatch.get': 'The dispatch layer itself; the caller polls it directly.',
  'dispatch.execute': 'The dispatch layer itself; only the owner starts an approved turn.',
});

/* Runner job types a chat message never enqueues directly. */
export const EXCLUDED_JOB_TYPES = Object.freeze({
  equiquant_mosaic_replay: 'Private research projects queue this fixed replay after checking project membership.',
  lead_rescore: 'Outreach CRM scoring (out_*). The outreach routine owns it; chat does not touch outreach.',
  sms_assistant_turn: 'Replies to an inbound SMS over the phone gateway: an outside message, and it needs the inbound message it answers.',
  actor_live_comment: 'Started by the database for a live session (live_actor_participation) with a receipt the executor checks; a chat-started job would fail that check.',
  game_media_collect: 'Continuation enqueued by game_studio_cycle with its own state; reached through game.build / world.generate.',
  game_owner_decision: 'Continuation carrying the owner\'s game approval packet; enqueued by game_studio_cycle, reached through game.build.',
  game_implementation_collect: 'Continuation enqueued by game_studio_cycle; reached through game.build.',
  game_branch_smoke: 'Needs the approval packet of a game_studio_cycle iteration; reached through game.build.',
  game_release_decision: 'Records the owner\'s release decision on an approval packet; reached through game.build, never from a free-text message.',
});

/* Job types reached through a capability route (the capability's Core
   tool enqueues them) or through the answer path. */
export const JOB_TYPES_VIA_CAPABILITY = Object.freeze({
  code_patch: 'code.build',
  objective_plan: 'objective.plan',
  game_studio_cycle: 'game.build',
  preview_deploy: 'deploy.preview',
  lyrics_align: 'lyrics.align',
  stems_separate: 'stems.separate',
  meeting_delegate_dispatch: 'meeting.delegate.schedule',
  meeting_delegate_collect: 'meeting.delegate.schedule',
  resident_ai_turn: 'answer',
});

/* Per-capability hints: how the message fills an argument, which single
   UUID or URL in the message is which field, fixed safe defaults. The
   risk, approval and required list always come from the catalog. */
const HINTS = {
  'core.resume': { summary: 'What is running, queued, waiting on approval, plus health and the deploy commit.', defaults: { since_hours: 24, limit: 25 } },
  'workstream.list': { summary: 'Where each checkpointed line of work stands.', defaults: { limit: 10 } },
  'workstream.checkpoint': { summary: 'Write where a line of work stands (structured workstream object in args).' },
  'system.health': { summary: 'Edge and platform health.' },
  'media.models.search': { summary: 'Search the media model registry.' },
  'media.model.recommend': { summary: 'Recommend a media model for a capability.' },
  'media.generate': { summary: 'Generate media with a named model (paid).', fromMessage: ['prompt'] },
  'media.job.get': { summary: 'Read a media generation job.', uuid: 'job_id' },
  'image.generate': { summary: 'Generate an image (paid).', fromMessage: ['prompt'] },
  'video.generate': { summary: 'Generate a video (paid).', fromMessage: ['prompt'] },
  'audio.generate': { summary: 'Generate audio or music (paid).', fromMessage: ['prompt'] },
  'model3d.generate': { summary: 'Generate a 3D model (paid).', fromMessage: ['prompt'] },
  'world.generate': { summary: 'Generate a PRIM3 world (paid, budget gated).', fromMessage: ['prompt'] },
  'research.web': { summary: 'Bounded public web research with timestamped sources.', fromMessage: ['objective'], defaults: { limit: 6 } },
  'repo.inspect': { summary: 'Read-only state of a cloned repository.', defaults: { tests: false } },
  'code.build': { summary: 'Isolated code change that can open a draft pull request; never merges.', fromMessage: ['task'] },
  'game.build': { summary: 'PRIM3 game production loop (budget and owner-review gated).', fromMessage: ['brief'] },
  'game.lore.read': { summary: 'Read the PRIM3 city lore.' },
  'deploy.preview': { summary: 'Temporary non-production preview of a ref.' },
  'ai.chat': { summary: 'One local model completion.', fromMessage: ['prompt'] },
  'compute.task.get': { summary: 'Read a compute task.', uuid: 'task_id' },
  'objective.plan': { summary: 'Dependency-aware plan of safe analysis jobs on the OVH runners.', fromMessage: ['objective'], defaults: { max_steps: 8 } },
  'ontology.schema': { summary: 'Read the operational ontology schema.' },
  'ontology.query': { summary: 'Query ontology objects.' },
  'ontology.neighbors': { summary: 'Linked objects of one ontology object.', uuid: 'object_id' },
  'ontology.action.apply': { summary: 'Apply an ontology action (owner-policy gated).' },
  'ingest.connectors': { summary: 'List ingestion connectors.' },
  'ingest.records': { summary: 'Read ingested records.' },
  'ingest.run.begin': { summary: 'Begin an ingestion run (owner-policy gated).' },
  'ingest.record.write': { summary: 'Write an ingested record (owner-policy gated).' },
  'ingest.run.finish': { summary: 'Finish an ingestion run (owner-policy gated).' },
  'entity.aliases': { summary: 'Read entity aliases.' },
  'entity.resolve': { summary: 'Resolve duplicate entities (owner-policy gated).' },
  'facts.query': { summary: 'Query recorded facts.' },
  'facts.claim': { summary: 'Record a fact claim (owner-policy gated).' },
  'meeting.delegate.schedule': { summary: 'Schedule the meeting delegate (owner-policy gated).', url: 'meeting_url' },
  'meeting.delegate.join': { summary: 'Send the meeting delegate into a meeting now (owner-policy gated).', url: 'meeting_url' },
  'meeting.delegate.cancel': { summary: 'Cancel the meeting delegate.', url: 'meeting_url' },
  'meeting.delegate.status': { summary: 'Meeting delegate status.', url: 'meeting_url' },
  'meeting.delegate.transcript': { summary: 'Meeting transcript.', url: 'meeting_url' },
  'meeting.delegate.session.get': { summary: 'Read one meeting delegate session.', uuid: 'session_id' },
  'meeting.delegate.chat.read': { summary: 'Read the meeting chat.', url: 'meeting_url' },
  'meeting.delegate.chat.send': { summary: 'Post quoted text in the meeting chat (owner-policy gated).', url: 'meeting_url', quote: 'text' },
  'meeting.delegate.speak': { summary: 'Speak quoted text in the meeting (owner-policy gated).', url: 'meeting_url', quote: 'text' },
  'lyrics.align': { summary: 'Owned lyric timing for one uploaded track.', uuid: 'track_id' },
  'stems.separate': { summary: 'Owned stem separation for one track.', uuid: 'track_id', requiredAny: [['track_id', 'track_key']] },
};

/* Direct job routes: executors with no capability of their own,
   enqueued with the existing enqueueJob on ops_agent_jobs. */
const JOB_ROUTES = [
  { jobType: 'host_health', risk: 'read', approval: 'none', summary: 'Full host health collection on the OVH server.', targetType: 'host', target: () => 'ovh-mccluster-core', input: () => ({ requested_by: 'dispatch' }) },
  { jobType: 'ai_diagnostics', risk: 'read', approval: 'none', summary: 'Local model diagnostics (no model downloads, no benchmark).', targetType: 'compute', target: () => 'local-ai', input: () => ({ benchmark: false, pull_missing: false }) },
  { jobType: 'repo_health', risk: 'read', approval: 'none', summary: 'Queued repository health check (no tests).', required: ['repository'], targetType: 'repository', target: (s) => s.repository, input: () => ({ tests: false, dependency_review: false }) },
  { jobType: 'local_analysis', risk: 'write', approval: 'none', summary: 'Local model analysis of a task; writes only its job output.', targetType: 'dispatch_request', target: (s, m, ctx) => ctx.messageId, input: (s, m) => ({ task: m, kind: 'dispatch' }) },
  { jobType: 'game_build_plan', risk: 'write', approval: 'none', summary: 'Plan a PRIM3 game production loop; no code, deploys or spending.', targetType: 'campaign', target: () => 'PRIM3', input: (s, m) => ({ brief: m, campaign: 'PRIM3' }) },
  { jobType: 'portfolio_plan', risk: 'write', approval: 'review-required', summary: 'Initiative OS portfolio plan; it enqueues reflection jobs.', targetType: 'portfolio', target: () => 'McCluster', input: () => ({ portfolio: 'McCluster' }) },
  { jobType: 'objective_reflection', risk: 'write', approval: 'review-required', summary: 'Reflect on an objective; it can enqueue follow-up jobs including code patches.', targetType: 'portfolio', target: () => 'McCluster', input: (s, m) => ({ task: m }) },
  { jobType: 'objective_synthesis', risk: 'write', approval: 'review-required', summary: 'Synthesize objectives from private conversations; mutates objectives.', required: ['source'], targetType: 'conversation', target: (s) => String(s.source || 'dispatch'), input: (s) => ({ source: s.source }) },
  { jobType: 'game_playtest', risk: 'write', approval: 'review-required', summary: 'Run a Godot playtest scenario on a project path.', required: ['project_path'], targetType: 'campaign', target: () => 'PRIM3', input: (s) => ({ project_path: s.project_path, scenario: s.scenario, artifact_root: s.artifact_root }) },
  { jobType: 'weather_region_snapshot', risk: 'write', approval: 'review-required', summary: 'Refresh the public World weather snapshot.', targetType: 'weather_region', target: () => 'connecticut-pilot', input: () => ({ seeded_by: 'dispatch' }) },
  { jobType: 'world_news_pairing', risk: 'write', approval: 'review-required', summary: 'Re-pair public World news.', targetType: 'world', target: () => 'news-pairs', input: () => ({ seeded_by: 'dispatch' }) },
  { jobType: 'prim3_agent_news', risk: 'write', approval: 'owner-policy-gated', summary: 'A PRIM3 agent posts public news comments.', required: ['target_id'], targetType: 'prim3_agent', target: (s) => s.target_id, input: () => ({ limit: 3 }) },
  { jobType: 'character_post', risk: 'write', approval: 'owner-policy-gated', summary: 'Cast characters publish public posts.', required: ['characters'], targetType: 'mnet_cast', target: () => 'mnet-cast', input: (s) => ({ characters: s.characters }) },
  { jobType: 'actor_news_comment', risk: 'write', approval: 'owner-policy-gated', summary: 'A platform actor posts a public news comment.', required: ['target_id'], targetType: 'platform_actor', target: (s) => s.target_id, input: () => ({ seeded_by: 'dispatch' }) },
];

function catalogRoutes(catalog) {
  const bindings = new Map();
  for (const binding of catalog.bindings || []) if (binding.status === 'active' && !bindings.has(binding.capability)) bindings.set(binding.capability, binding);
  return (catalog.capabilities || [])
    .filter((entry) => !Object.hasOwn(EXCLUDED_CAPABILITIES, entry.id))
    .map((entry) => {
      const hint = HINTS[entry.id] || {};
      const properties = Object.keys(entry.inputSchema?.properties || {});
      const required = (entry.inputSchema?.required || []).filter((name) => name !== 'org_id');
      return {
        intent: entry.id, via: 'capability', capability: entry.id,
        tool: bindings.get(entry.id)?.tool || `capability:${entry.id}`, transport: bindings.get(entry.id)?.transport || 'compute',
        kind: entry.execution, risk: entry.risk, approval: entry.approval,
        summary: hint.summary || entry.title, required, requiredAny: hint.requiredAny || [],
        properties, takesOrg: properties.includes('org_id'), hint,
      };
    });
}

function jobRoutes() {
  return JOB_ROUTES.map((job) => ({
    intent: `job.${job.jobType}`, via: 'job', capability: `job.${job.jobType}`, tool: `job:${job.jobType}`, jobType: job.jobType,
    kind: 'async', risk: job.risk, approval: job.approval, summary: job.summary, required: job.required || [], requiredAny: [],
    properties: job.required || [], takesOrg: false, targetType: job.targetType, target: job.target, input: job.input, hint: {},
  }));
}

export const DISPATCH_ROUTES = Object.freeze([...catalogRoutes(CATALOG), ...jobRoutes()].map((route) => Object.freeze(route)));
export const ROUTE_BY_INTENT = new Map(DISPATCH_ROUTES.map((route) => [route.intent, route]));
export const ROUTABLE_INTENTS = Object.freeze([...CONVERSATION_INTENTS, ...DISPATCH_ROUTES.map((route) => route.intent)]);
export const NEVER_DISPATCHED = Object.freeze(Object.keys(EXCLUDED_CAPABILITIES));

/* Arguments for one route from the extracted slots and the message.
   Only properties the capability declares are kept; a free-text field
   the route reads from the message is filled with it; a single UUID or
   meeting URL in the message fills the field the hint names. */
export function buildArgs(route, slots = {}, message = '', ctx = {}) {
  if (route.via === 'job') {
    return { target_id: String(route.target(slots, message, ctx) ?? '').slice(0, 500), input: route.input(slots, message, ctx) };
  }
  const hint = route.hint || {};
  const args = { ...(hint.defaults || {}) };
  const allowed = new Set(route.properties);
  for (const [key, value] of Object.entries(slots)) if (allowed.has(key) && key !== 'org_id' && value !== undefined && value !== '') args[key] = value;
  for (const field of hint.fromMessage || []) if (args[field] === undefined && allowed.has(field)) args[field] = message;
  if (hint.uuid && args[hint.uuid] === undefined && slots.uuid) args[hint.uuid] = slots.uuid;
  if (hint.url && args[hint.url] === undefined && slots.meeting_url) args[hint.url] = slots.meeting_url;
  if (hint.quote && args[hint.quote] === undefined && slots.quote) args[hint.quote] = slots.quote;
  for (const key of Object.keys(args)) if (!allowed.has(key)) delete args[key];
  return args;
}

export function missingArgs(route, args, slots = {}) {
  if (route.via === 'job') {
    const missing = route.required.filter((name) => slots[name] === undefined || slots[name] === null || slots[name] === '');
    if (!missing.length && !args?.target_id) missing.push('target_id');
    return missing;
  }
  const present = (name) => args?.[name] !== undefined && args?.[name] !== null && args?.[name] !== '';
  const missing = route.required.filter((name) => !present(name));
  for (const group of route.requiredAny || []) if (!group.some(present)) missing.push(group.join(' or '));
  return missing;
}

/* Refusals: things a chat message must not start. Matched before any
   route, so "deploy the preview to production" is a refusal, not a
   preview. Each one says where the owner does it instead. */
export const REFUSALS = Object.freeze([
  {
    intent: 'refuse.production',
    pattern: /\b(merge|deploy|ship|publish|push|release|roll ?out)\b[^.?!]{0,60}\b(prod|production|main|live site|the site live)\b|\bmerge\b[^.?!]{0,40}\b(pr|pull request)\b/i,
    reply: 'Merging and production deploys are never started from chat. Open the pull request on GitHub, or approve the release in Control, and I can track it from there.',
  },
  {
    intent: 'refuse.outreach',
    pattern: /\b(send|email|e-mail|text|sms|dm|message|tweet|blast)\b[^.?!]{0,60}\b(lead|leads|client|clients|customer|customers|prospect|prospects|list|campaign|everyone|them|him|her)\b|\boutreach\b/i,
    reply: 'Outside messages and outreach are not dispatched from chat. The outreach routine owns those, and every send still needs your approval there.',
  },
  {
    intent: 'refuse.destructive',
    pattern: /\b(delete|drop|wipe|truncate|purge|erase)\b[^.?!]{0,40}\b(table|database|db|data|rows|records|bucket|branch|repo|repository|account)\b/i,
    reply: 'Destructive changes are never dispatched from chat. If something needs removing, say what and I will draft it as a proposal for you to approve in Control.',
  },
  {
    intent: 'refuse.spend',
    pattern: /\b(pay|buy|purchase|charge|refund|transfer|invoice)\b[^.?!]{0,40}(\$|\b(dollars?|usd|card|stripe|money)\b)/i,
    reply: 'Payments and purchases are never dispatched from chat. They stay with you in Stripe or Control.',
  },
  {
    intent: 'refuse.owner_only',
    pattern: /\b(edit|change|update|rewrite)\b[^.?!]{0,40}\b(website|site page|hire page|homepage|home page|offers\.json|prices on the site)\b|\bbrowse\b[^.?!]{0,30}\bfor me\b/i,
    reply: 'Website edits and driving your browser are owner-only and are not dispatched from chat. Use Control for site edits, or start a McCluster turn with the browser switch on.',
  },
]);

export function routeFor(intent) {
  return ROUTE_BY_INTENT.get(String(intent || '')) || null;
}
