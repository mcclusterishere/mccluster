/* ============================================================
   DISPATCH ROUTING TABLE.

   The dispatch layer is McCluster's conversational front end: a small
   resident model reads one owner message, decides what it is, and
   hands it to an existing backend path. This file is the only list of
   places a message may go. It is deterministic data, not prompt text:
   the model may only pick an intent from here, and the catalog (not
   this file and not the model) decides whether a route needs approval.

   What is deliberately NOT routable from a chat message:
     browser.act   owner-only, agent interface only; it stays inside a
                   resident AI turn the owner opened with allow_browser.
     site.edit     the public website; edited by an owner in Control.
     outreach      out_* / lead_rescore / any outside message. Sending
                   is never a dispatch outcome.
     production    merge, deploy to production, delete, payments.
   A message that asks for one of those gets a plain refusal that says
   where the thing is done instead.

   Contract: docs/control-plane/DISPATCH-LAYER.md
   ============================================================ */

export const DISPATCH_SCHEMA = 'mccluster-dispatch/1';

/* Intents the front end itself answers (no capability is called). */
export const CONVERSATION_INTENTS = Object.freeze(['answer', 'clarify']);

/* Every capability route. `tool` is the existing Core control tool that
   already validates and enqueues the work; `capability` is the catalog
   id whose risk and approval decide the gate; `required` are the
   arguments the tool cannot run without (a missing one means clarify).
   `build` maps the message and the extracted slots onto the tool's own
   arguments; org_id is added by the dispatcher, never by a message. */
const ROUTES = [
  {
    intent: 'status.resume', capability: 'core.resume', tool: 'core.resume', kind: 'sync',
    summary: 'What is running, queued, waiting on approval, and the current deploy and health.',
    required: [],
    build: () => ({ since_hours: 24, limit: 25 }),
  },
  {
    intent: 'workstream.list', capability: 'workstream.list', tool: 'core.workstream.list', kind: 'sync',
    summary: 'Where each checkpointed line of work stands.',
    required: [],
    build: () => ({ limit: 10 }),
  },
  {
    intent: 'research.web', capability: 'research.web', tool: 'core.research.web', kind: 'sync',
    summary: 'Bounded public web research with timestamped sources.',
    required: ['objective'],
    build: (slots, message) => ({ objective: slots.objective || message, limit: 6 }),
  },
  {
    intent: 'repo.inspect', capability: 'repo.inspect', tool: 'core.repo.inspect', kind: 'sync',
    summary: 'Read-only state of a cloned repository.',
    required: ['repository'],
    build: (slots) => ({ repository: slots.repository, tests: false }),
  },
  {
    intent: 'objective.plan', capability: 'objective.plan', tool: 'core.objective.plan', kind: 'job',
    summary: 'Queue a dependency-aware plan of safe analysis and inspection jobs on the OVH runners.',
    required: ['objective'],
    build: (slots, message) => ({ objective: slots.objective || message, max_steps: 8 }),
  },
  {
    intent: 'lyrics.align', capability: 'lyrics.align', tool: 'core.lyrics.align', kind: 'job',
    summary: 'Queue the owned lyric-timing machine for one uploaded track.',
    required: ['track_id'],
    build: (slots) => ({ track_id: slots.track_id }),
  },
  {
    intent: 'stems.separate', capability: 'stems.separate', tool: 'core.stems.separate', kind: 'job',
    summary: 'Queue owned stem separation for one track.',
    required: ['track'],
    build: (slots) => (slots.track_id ? { track_id: slots.track_id } : { track_key: slots.track_key }),
  },
  {
    intent: 'code.build', capability: 'code.build', tool: 'core.code.build', kind: 'job',
    summary: 'Queue an isolated code change that can open a draft pull request and never merges.',
    required: ['repository', 'task'],
    build: (slots, message) => ({ repository: slots.repository, task: slots.task || message }),
  },
  {
    intent: 'game.build', capability: 'game.build', tool: 'core.game.build', kind: 'job',
    summary: 'Queue the PRIM3 game production loop (budget and owner-review gated).',
    required: ['brief'],
    build: (slots, message) => ({ brief: slots.brief || message }),
  },
  {
    intent: 'world.generate', capability: 'world.generate', tool: 'core.world.generate', kind: 'job',
    summary: 'Queue a PRIM3 world generation (paid media, budget gated).',
    required: ['prompt'],
    build: (slots, message) => ({ prompt: slots.prompt || message }),
  },
  {
    intent: 'deploy.preview', capability: 'deploy.preview', tool: 'core.deploy.preview', kind: 'job',
    summary: 'Queue a temporary non-production preview of a ref.',
    required: ['repository', 'ref'],
    build: (slots) => ({ repository: slots.repository, ref: slots.ref }),
  },
];

export const DISPATCH_ROUTES = Object.freeze(ROUTES.map((route) => Object.freeze({ ...route, required: Object.freeze([...route.required]) })));
export const ROUTE_BY_INTENT = new Map(DISPATCH_ROUTES.map((route) => [route.intent, route]));
export const ROUTABLE_INTENTS = Object.freeze([...CONVERSATION_INTENTS, ...DISPATCH_ROUTES.map((route) => route.intent)]);

/* Capabilities a dispatch may never reach, whatever the model says. */
export const NEVER_DISPATCHED = Object.freeze(['browser.act', 'site.edit']);

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
    pattern: /\b(send|email|e-mail|text|sms|dm|message|post|tweet|blast)\b[^.?!]{0,60}\b(lead|leads|client|clients|customer|customers|prospect|prospects|list|campaign|everyone|them|him|her)\b|\boutreach\b/i,
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
