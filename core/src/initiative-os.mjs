import { normalizeSignalRecord, signalNeedsSynthesis } from './signals.mjs';

const DEFAULT_MAX_INITIATIVES = 12;

const DEPARTMENT_RULES = [
  ['engineering', /\b(code|repo|github|deploy|backend|frontend|api|infra|server|vps|halo|bug|test|build|security|database|supabase|cloudflare)\b/i],
  ['creative', /\b(prim3|episode|music|video|design|brand|creative|story|game|asset|3d|art|media)\b/i],
  ['business_development', /\b(partner|partnership|vendor|oem|client|sales|revenue|deal|outreach|manufacturer|manufacturing)\b/i],
  ['funding', /\b(grant|fund|funding|scholarship|donation|sponsor|nonprofit|capital)\b/i],
  ['operations', /\b(schedule|calendar|deadline|meeting|operations|ops|follow.?up|application|compliance)\b/i],
  ['research', /\b(research|investigate|compare|audit|evidence|source|market|policy)\b/i],
];

function text(value, max = 8000) { return String(value ?? '').trim().slice(0, max); }
function number(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function first(...values) { for (const value of values) { const normalized = text(value); if (normalized) return normalized; } return ''; }

function normalizeStatus(value) {
  const status = text(value, 80).toLowerCase().replace(/[\s-]+/g, '_');
  if (['done', 'complete', 'completed', 'closed', 'cancelled', 'canceled', 'archived'].includes(status)) return 'inactive';
  if (['blocked', 'waiting', 'stalled'].includes(status)) return 'blocked';
  if (['paused', 'hold', 'on_hold'].includes(status)) return 'paused';
  return 'active';
}

function normalizeDeadline(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function inferDepartment(value) {
  const haystack = text(value, 20_000);
  for (const [department, rule] of DEPARTMENT_RULES) if (rule.test(haystack)) return department;
  return 'chief_of_staff';
}

export function normalizeObjectiveRecord(record = {}) {
  const metadata = record?.metadata && typeof record.metadata === 'object' ? record.metadata : {};
  const title = first(record.title, record.name, record.objective, record.summary, metadata.title, record.id, 'Untitled objective');
  const description = first(record.description, record.body, record.details, metadata.description, metadata.context);
  const project = first(record.project, record.project_name, record.target_id, metadata.project, metadata.project_name, 'McCluster');
  const initiative = first(record.initiative, record.initiative_name, metadata.initiative, metadata.initiative_name, title);
  const status = normalizeStatus(first(record.status, metadata.status, 'active'));
  const priority = clamp(number(record.priority ?? metadata.priority, 50), 0, 100);
  const confidence = clamp(number(record.confidence ?? metadata.confidence, 0.6), 0, 1);
  const expectedImpact = clamp(number(record.expected_impact ?? metadata.expected_impact, 0.5), 0, 1);
  const urgency = clamp(number(record.urgency ?? metadata.urgency, 0.5), 0, 1);
  const blocked = status === 'blocked' || Boolean(record.blocked ?? metadata.blocked);
  const deadline = normalizeDeadline(record.deadline ?? record.due_at ?? metadata.deadline ?? metadata.due_at);
  const department = first(record.department, metadata.department) || inferDepartment(`${project} ${initiative} ${title} ${description}`);
  return { id: first(record.id, metadata.id, `${project}:${initiative}`), project, initiative, title, description, status, priority, confidence, expected_impact: expectedImpact, urgency, blocked, deadline, department, source: 'ops_objectives' };
}

export function scoreInitiative(initiative, { now = Date.now() } = {}) {
  if (!initiative || initiative.status === 'inactive' || initiative.status === 'paused') return -Infinity;
  let deadlineBoost = 0;
  if (initiative.deadline) {
    const hours = (new Date(initiative.deadline).getTime() - now) / 3_600_000;
    if (Number.isFinite(hours)) deadlineBoost = hours <= 0 ? 24 : hours <= 24 ? 20 : hours <= 72 ? 12 : hours <= 168 ? 6 : 0;
  }
  const base = initiative.priority * 0.5 + initiative.expected_impact * 25 + initiative.urgency * 15 + initiative.confidence * 10 + deadlineBoost + (initiative.blocked ? 10 : 0);
  return Math.round(base * 100) / 100;
}

export function groupInitiatives(objectives = [], options = {}) {
  const grouped = new Map();
  for (const item of objectives.map(normalizeObjectiveRecord)) {
    if (item.status === 'inactive') continue;
    const key = `${item.project}\u241F${item.initiative}`;
    const current = grouped.get(key) || { id: key, project: item.project, initiative: item.initiative, department: item.department, objectives: [], priority: 0, confidence: 0, expected_impact: 0, urgency: 0, blocked: false, deadlines: [] };
    current.objectives.push(item);
    current.priority = Math.max(current.priority, item.priority);
    current.confidence = Math.max(current.confidence, item.confidence);
    current.expected_impact = Math.max(current.expected_impact, item.expected_impact);
    current.urgency = Math.max(current.urgency, item.urgency);
    current.blocked ||= item.blocked;
    if (item.deadline) current.deadlines.push(item.deadline);
    if (current.department === 'chief_of_staff' && item.department !== 'chief_of_staff') current.department = item.department;
    grouped.set(key, current);
  }
  return [...grouped.values()].map((item) => {
    const deadline = item.deadlines.sort()[0] || null;
    const scored = { ...item, deadline, status: item.blocked ? 'blocked' : 'active' };
    return { ...scored, score: scoreInitiative(scored, options) };
  });
}

function recentJobSummary(jobs = []) {
  const counts = { done: 0, failed: 0, queued: 0, running: 0, other: 0 };
  for (const job of jobs) { const status = text(job?.status, 40).toLowerCase(); if (Object.hasOwn(counts, status)) counts[status] += 1; else counts.other += 1; }
  return counts;
}

export function buildWorldState(signals = []) {
  const normalized = signals.map(normalizeSignalRecord);
  const bySource = {};
  const byType = {};
  for (const signal of normalized) {
    bySource[signal.source || 'unknown'] = (bySource[signal.source || 'unknown'] || 0) + 1;
    byType[signal.signal_type || 'unknown'] = (byType[signal.signal_type || 'unknown'] || 0) + 1;
  }
  const attention = [...normalized]
    .filter((signal) => signal.status === 'new' || signal.status === 'queued')
    .sort((a, b) => b.severity - a.severity || new Date(b.observed_at) - new Date(a.observed_at))
    .slice(0, 10)
    .map((signal) => ({ id: signal.id, source: signal.source, signal_type: signal.signal_type, severity: signal.severity, confidence: signal.confidence, observed_at: signal.observed_at, content: signal.content.slice(0, 500) }));
  return {
    signal_count: normalized.length,
    unprocessed_count: normalized.filter(signalNeedsSynthesis).length,
    high_severity_count: normalized.filter((signal) => signal.severity >= 60 && ['new', 'queued'].includes(signal.status)).length,
    by_source: bySource,
    by_type: byType,
    attention_signals: attention,
    synthesis_candidates: normalized.filter(signalNeedsSynthesis).slice(0, 20).map((signal) => ({ id: signal.id, source: signal.source, source_ref: signal.source_ref, signal_type: signal.signal_type, severity: signal.severity, fingerprint: signal.fingerprint })),
  };
}

export function buildPortfolioPlan({ objectives = [], recentJobs = [], signals = [], maxInitiatives = DEFAULT_MAX_INITIATIVES, now = Date.now() } = {}) {
  const limit = clamp(Math.trunc(number(maxInitiatives, DEFAULT_MAX_INITIATIVES)), 1, 50);
  const initiatives = groupInitiatives(objectives, { now }).filter((item) => Number.isFinite(item.score)).sort((a, b) => b.score - a.score || b.priority - a.priority || a.project.localeCompare(b.project)).slice(0, limit);
  const departments = {};
  for (const item of initiatives) {
    departments[item.department] ||= [];
    departments[item.department].push({ project: item.project, initiative: item.initiative, score: item.score, blocked: item.blocked, objective_count: item.objectives.length });
  }
  return {
    version: 'initiative-os:v2',
    generated_at: new Date(now).toISOString(),
    initiative_count: initiatives.length,
    active_objective_count: objectives.map(normalizeObjectiveRecord).filter((item) => item.status === 'active' || item.status === 'blocked').length,
    recent_job_summary: recentJobSummary(recentJobs),
    world_state: buildWorldState(signals),
    departments,
    initiatives,
    top_initiatives: initiatives.slice(0, 5).map((item) => ({ project: item.project, initiative: item.initiative, department: item.department, score: item.score, blocked: item.blocked, deadline: item.deadline, objective_ids: item.objectives.map((objective) => objective.id) })),
  };
}
