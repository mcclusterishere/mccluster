const ACTIONS = new Set(['ignore', 'create', 'update']);

function text(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function integer(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function confidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function normalizeObjectiveSynthesis(value, { existingObjectiveIds = [] } = {}) {
  const raw = object(value);
  const allowedIds = new Set(existingObjectiveIds.map((id) => String(id)));
  const action = ACTIONS.has(raw.action) ? raw.action : 'ignore';
  const score = confidence(raw.confidence);
  const reason = text(raw.reason || raw.rationale, 6000);

  if (action === 'ignore') return { action: 'ignore', confidence: score, reason };
  if (score < 0.72) return { action: 'ignore', confidence: score, reason: reason || 'confidence below unattended synthesis threshold' };

  const name = text(raw.name, 240);
  const description = text(raw.description, 12_000);
  const priority = integer(raw.priority, 0, 100, 50);
  const successMetric = object(raw.success_metric);
  if (!name) return { action: 'ignore', confidence: score, reason: reason || 'objective name missing' };

  if (action === 'update') {
    const objectiveId = text(raw.objective_id, 80);
    if (!allowedIds.has(objectiveId)) {
      return { action: 'ignore', confidence: score, reason: reason || 'requested objective update is not in supplied canonical objective set' };
    }
    return {
      action,
      objective_id: objectiveId,
      name,
      description,
      priority,
      success_metric: successMetric,
      confidence: score,
      reason,
    };
  }

  return {
    action: 'create',
    name,
    description,
    priority,
    success_metric: successMetric,
    confidence: score,
    reason,
  };
}

export function boundedConversationMessages(messages, { maxMessages = 40, maxChars = 96_000 } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const selected = [];
  let remaining = Math.max(1000, Number(maxChars) || 96_000);

  for (const message of list.slice(-Math.max(1, Number(maxMessages) || 40)).reverse()) {
    if (!message || typeof message !== 'object') continue;
    const content = text(message.content, Math.min(24_000, remaining));
    if (!content) continue;
    selected.push({
      id: text(message.id, 200) || null,
      role: text(message.role, 80) || 'unknown',
      model: text(message.model, 160) || null,
      occurred_at: text(message.occurred_at, 80) || null,
      content,
    });
    remaining -= content.length;
    if (remaining <= 0) break;
  }

  return selected.reverse();
}
