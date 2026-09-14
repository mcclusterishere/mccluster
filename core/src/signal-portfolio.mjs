function text(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function signalToPortfolioRecord(signal = {}) {
  const payload = signal?.payload && typeof signal.payload === 'object' && !Array.isArray(signal.payload) ? signal.payload : {};
  const summary = text(payload.summary || payload.title || `${signal.signal_type || 'Signal'} from ${signal.source || 'unknown'}`);
  const project = text(payload.project || payload.product || payload.repository || signal.source || 'McCluster', 240) || 'McCluster';
  const initiative = text(payload.initiative || payload.workstream || payload.campaign || signal.signal_type || summary, 240) || summary;
  const severity = clamp(number(signal.severity, 50), 0, 100);
  const confidence = clamp(number(signal.confidence, 0.7), 0, 1);

  return {
    id: `signal:${signal.id}`,
    name: summary,
    description: text(payload.description || payload.details || summary, 8000),
    status: signal.status === 'failed' ? 'blocked' : 'active',
    priority: severity,
    confidence,
    expected_impact: clamp(number(payload.expected_impact, severity / 100), 0, 1),
    urgency: clamp(number(payload.urgency, severity / 100), 0, 1),
    blocked: Boolean(payload.blocked || signal.status === 'failed'),
    deadline: payload.deadline || payload.due_at || null,
    project,
    initiative,
    department: text(payload.department, 120) || undefined,
    source: 'ops_signals',
    metadata: {
      ...payload,
      project,
      initiative,
      source: 'ops_signals',
      signal_id: signal.id,
      signal_type: signal.signal_type,
      signal_source: signal.source,
      source_ref: signal.source_ref || null,
      observed_at: signal.observed_at || null,
      confidence,
    },
  };
}
