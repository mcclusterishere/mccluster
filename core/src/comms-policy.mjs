const SENSITIVE_PATTERNS = [
  { kind: 'legal', re: /\b(lawyer|attorney|lawsuit|sue|subpoena|court|legal advice|settlement|contract|sign this|agreement)\b/i },
  { kind: 'financial', re: /\b(pay|payment|invoice|wire|bank|routing|account number|credit card|debit card|venmo|cashapp|cash app|zelle|price commitment|refund)\b/i },
  { kind: 'credentials', re: /\b(password|passcode|pin\b|one[- ]?time code|2fa|mfa|verification code|security code|api key|secret key|private key)\b/i },
  { kind: 'identity', re: /\b(ssn|social security|driver'?s license|passport|date of birth|dob\b)\b/i },
  { kind: 'medical', re: /\b(diagnos|prescription|medication|medical record|health record|hipaa)\b/i },
];

export const DEFAULT_COMMS_LIMITS = Object.freeze({
  maxRecentMessages: 24,
  maxRecentChars: 24000,
  maxAssistantRepliesPerHour: 8,
  minReplyGapMs: 2500,
});

export function findSensitiveKinds(text) {
  const value = String(text || '');
  return SENSITIVE_PATTERNS.filter((entry) => entry.re.test(value)).map((entry) => entry.kind);
}

export function shouldEscalateInbound({ body, thread, contact } = {}) {
  if (!thread || thread.mode !== 'assistant' || thread.assistant_enabled !== true) {
    return { escalate: false, ignore: true, reason: 'assistant_disabled' };
  }
  if (contact?.blocked || contact?.assistant_allowed === false) {
    return { escalate: false, ignore: true, reason: 'contact_blocked' };
  }
  const sensitive = findSensitiveKinds(body);
  if (sensitive.length) {
    return { escalate: true, ignore: false, reason: 'sensitive_topic', sensitive };
  }
  return { escalate: false, ignore: false, reason: null, sensitive: [] };
}

export function boundedThreadContext(messages, limits = DEFAULT_COMMS_LIMITS) {
  const list = Array.isArray(messages) ? messages : [];
  const selected = [];
  let remaining = Math.max(1000, Number(limits.maxRecentChars || 24000));
  const maxMessages = Math.max(1, Number(limits.maxRecentMessages || 24));
  for (const row of list.slice(-maxMessages).reverse()) {
    const body = String(row?.body || '').trim();
    if (!body) continue;
    const clipped = body.slice(0, Math.min(4000, remaining));
    selected.push({
      id: row.id,
      direction: row.direction,
      sender_type: row.sender_type,
      body: clipped,
      occurred_at: row.occurred_at,
    });
    remaining -= clipped.length;
    if (remaining <= 0) break;
  }
  return selected.reverse();
}

export function enforceReplyRate({ recentAssistantReplies = 0, lastAgentReplyAt = null, now = Date.now(), limits = DEFAULT_COMMS_LIMITS } = {}) {
  if (Number(recentAssistantReplies || 0) >= Number(limits.maxAssistantRepliesPerHour || 8)) {
    return { allowed: false, reason: 'hourly_reply_limit' };
  }
  if (lastAgentReplyAt) {
    const last = new Date(lastAgentReplyAt).getTime();
    if (Number.isFinite(last) && now - last < Number(limits.minReplyGapMs || 2500)) {
      return { allowed: false, reason: 'reply_gap' };
    }
  }
  return { allowed: true, reason: null };
}

export function normalizeAssistantDecision(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const action = ['reply', 'escalate', 'ignore'].includes(raw.action) ? raw.action : 'escalate';
  const reason = String(raw.reason || '').trim().slice(0, 1000);
  if (action !== 'reply') return { action, reason, reply: '' };
  const reply = String(raw.reply || '').trim().slice(0, 1600);
  if (!reply) return { action: 'escalate', reason: reason || 'empty_reply', reply: '' };
  return { action: 'reply', reason, reply };
}

export function withAssistantDisclosure(reply, disclosureSentAt) {
  const body = String(reply || '').trim();
  if (!body) return '';
  if (disclosureSentAt) return body;
  return `McCluster's assistant here — ${body}`.slice(0, 1600);
}
