const DEFAULTS = Object.freeze({
  hardDailyCap: 100,
  defaultDailyCap: 100,
  perDomainDailyCap: 4,
  minimumSourceConfidence: 0.7,
});

export function normalizeAddress(value) {
  return String(value || '').trim().toLowerCase();
}

export function emailDomain(value) {
  const address = normalizeAddress(value);
  const at = address.lastIndexOf('@');
  return at > 0 ? address.slice(at + 1) : '';
}

export function isPlausibleEmail(value) {
  const address = normalizeAddress(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) && address.length <= 254;
}

export function safePublicUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.local')) return null;
    if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(host)) return null;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeEvidence(items = []) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 12).map((item, index) => ({
    id: String(item?.id || `e${index + 1}`).slice(0, 80),
    url: safePublicUrl(item?.url),
    title: String(item?.title || '').trim().slice(0, 500),
    snippet: String(item?.snippet || item?.fact || '').trim().slice(0, 2500),
    confidence: Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0,
    fetched_at: item?.fetched_at ? String(item.fetched_at) : null,
  })).filter((item) => item.url && item.snippet);
}

export function evidenceContainsAddress(evidence, address) {
  const normalized = normalizeAddress(address);
  if (!normalized) return false;
  return normalizeEvidence(evidence).some((item) => item.snippet.toLowerCase().includes(normalized));
}

export function effectiveDailyCap(campaign = {}, env = process.env) {
  const configured = Number(env.OUTREACH_DAILY_SEND_CAP || DEFAULTS.defaultDailyCap);
  const audienceCap = Number(campaign?.audience?.daily_limit || configured);
  const hard = Math.min(DEFAULTS.hardDailyCap, Math.max(1, configured || DEFAULTS.defaultDailyCap));
  return Math.min(hard, Math.max(1, audienceCap || hard));
}

export function firstTouchGate({
  campaign,
  sender,
  recipient,
  contact,
  evidence = [],
  suppressed = false,
  priorSent = false,
  priorReply = false,
  sentToday = 0,
  domainSentToday = 0,
  live = false,
  env = process.env,
} = {}) {
  if (!campaign) return { allowed: false, reason: 'missing_campaign' };
  if (!sender?.verified) return { allowed: false, reason: 'unverified_sender' };
  if (!recipient || !isPlausibleEmail(recipient.address || contact?.email)) return { allowed: false, reason: 'invalid_recipient' };
  if (suppressed) return { allowed: false, reason: 'suppressed' };
  if (priorReply) return { allowed: false, reason: 'reply_detected' };
  if (priorSent || recipient?.sent_at || recipient?.state === 'sent') return { allowed: false, reason: 'already_contacted' };

  const normalizedEvidence = normalizeEvidence(evidence);
  if (!normalizedEvidence.length) return { allowed: false, reason: 'missing_evidence' };
  const confidence = Math.max(...normalizedEvidence.map((item) => item.confidence || 0));
  if (confidence < Number(env.OUTREACH_MIN_SOURCE_CONFIDENCE || DEFAULTS.minimumSourceConfidence)) {
    return { allowed: false, reason: 'low_source_confidence' };
  }
  if (!evidenceContainsAddress(normalizedEvidence, recipient.address || contact?.email)) {
    return { allowed: false, reason: 'email_not_verified_in_public_source' };
  }

  const dailyCap = effectiveDailyCap(campaign, env);
  if (Number(sentToday || 0) >= dailyCap) return { allowed: false, reason: 'daily_cap' };
  const domainCap = Math.min(10, Math.max(1, Number(env.OUTREACH_PER_DOMAIN_DAILY_CAP || DEFAULTS.perDomainDailyCap)));
  if (Number(domainSentToday || 0) >= domainCap) return { allowed: false, reason: 'domain_cap' };

  const audience = campaign.audience && typeof campaign.audience === 'object' ? campaign.audience : {};
  if (live) {
    if (!['approved', 'sending'].includes(campaign.status) || !campaign.approved_at) return { allowed: false, reason: 'campaign_not_approved' };
    if (String(env.OUTREACH_LIVE_SEND_ENABLED || '').toLowerCase() !== 'true') return { allowed: false, reason: 'live_send_disabled' };
    if (audience.first_touch_only !== true) return { allowed: false, reason: 'first_touch_only_required' };
    if (!String(audience.purpose || '').trim()) return { allowed: false, reason: 'missing_purpose' };
    if (!String(audience.value_prop || '').trim()) return { allowed: false, reason: 'missing_value_prop' };
    if (!String(audience.cta || '').trim()) return { allowed: false, reason: 'missing_cta' };
  }

  return { allowed: true, reason: null, dailyCap, domainCap };
}

export function shouldStopAutomation({ replyDetected = false, bounced = false, complained = false, unsubscribed = false } = {}) {
  if (replyDetected) return { stop: true, reason: 'reply_detected', handoff: 'manual' };
  if (unsubscribed) return { stop: true, reason: 'unsubscribed', handoff: null };
  if (complained) return { stop: true, reason: 'complained', handoff: null };
  if (bounced) return { stop: true, reason: 'bounced', handoff: null };
  return { stop: false, reason: null, handoff: null };
}
