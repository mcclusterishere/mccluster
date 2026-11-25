// The exact fields each connector may send. Mirrors ai_context.source_allowed_keys in
// supabase/pending/20261125012000_ai_context_source_pipelines_v1.sql; a test keeps the two equal.
export const ALLOWED_KEYS = Object.freeze({
  'google.gmail': Object.freeze(['external_id', 'thread_id', 'occurred_at', 'direction', 'labels', 'counterparty_hashes',
    'counterparty_domains', 'subject_redacted', 'attachment_count']),
  'google.calendar': Object.freeze(['external_id', 'calendar_hash', 'recurring_event_id', 'status', 'starts_at', 'ends_at', 'all_day',
    'title_redacted', 'organizer_self', 'attendee_count', 'attendee_hashes', 'has_conference', 'has_location', 'source_updated_at']),
  'stripe.api': Object.freeze(['external_id', 'object_type', 'occurred_at', 'status', 'amount_minor', 'amount_refunded_minor',
    'currency', 'livemode', 'customer_id', 'related_id', 'email_hash', 'metadata']),
});

export const CONNECTOR_FOR_SOURCE = Object.freeze({ gmail: 'google.gmail', calendar: 'google.calendar', stripe: 'stripe.api' });

export function assertAllowed(connector, record) {
  const allowed = ALLOWED_KEYS[connector];
  if (!allowed) throw new Error(`unknown connector ${connector}`);
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) throw new Error(`${connector} record carries forbidden field ${key}`);
  }
  return record;
}

// Drop undefined/null so the content hash only changes when a real value changes.
export function compact(record) {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined && v !== null));
}
