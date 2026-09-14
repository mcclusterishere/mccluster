import { createHash } from 'node:crypto';

export const SIGNAL_SCHEMA = 'mccluster-signal/v1';

const SEVERITY = Object.freeze({
  debug: 10,
  info: 25,
  notice: 40,
  warning: 60,
  error: 80,
  critical: 100,
});

function text(value, max = 8000) {
  return String(value ?? '').trim().slice(0, max);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function stableJson(value) {
  return JSON.stringify(stable(value));
}

export function normalizeSeverity(value) {
  if (typeof value === 'string' && Object.hasOwn(SEVERITY, value.toLowerCase())) return SEVERITY[value.toLowerCase()];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(Math.round(numeric), 0, 100) : SEVERITY.info;
}

function normalizeObservedAt(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

export function normalizeSignal(input = {}) {
  const orgId = text(input.orgId ?? input.org_id, 80);
  if (!orgId) throw new Error('signal requires org_id');

  const signalType = text(input.signalType ?? input.signal_type ?? input.kind, 120).toLowerCase().replace(/[^a-z0-9_.:-]+/g, '_');
  if (!signalType) throw new Error('signal requires signal_type/kind');

  const source = text(input.source, 120).toLowerCase() || 'mccluster-core';
  const sourceRef = text(input.sourceRef ?? input.source_ref, 500) || null;
  const content = text(input.body ?? input.content ?? input.payload?.content, 24_000);
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? input.metadata : {};
  const providedPayload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload) ? input.payload : {};
  const confidence = clamp(Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 1, 0, 1);
  const severity = normalizeSeverity(input.severity);
  const observedAt = normalizeObservedAt(input.observedAt ?? input.observed_at);

  const payload = {
    ...providedPayload,
    schema_version: SIGNAL_SCHEMA,
    ...(content ? { content } : {}),
    metadata: { ...(providedPayload.metadata && typeof providedPayload.metadata === 'object' ? providedPayload.metadata : {}), ...metadata },
    provenance: {
      ...(providedPayload.provenance && typeof providedPayload.provenance === 'object' ? providedPayload.provenance : {}),
      source,
      source_ref: sourceRef,
    },
  };

  const identity = { org_id: orgId, signal_type: signalType, source, source_ref: sourceRef, content, metadata: payload.metadata };
  const fingerprint = text(input.fingerprint, 128) || createHash('sha256').update(stableJson(identity)).digest('hex');

  return {
    org_id: orgId,
    signal_type: signalType,
    source,
    source_ref: sourceRef,
    severity,
    confidence,
    payload,
    fingerprint,
    status: text(input.status, 40) || 'new',
    observed_at: observedAt,
  };
}

export function normalizeSignalRecord(record = {}) {
  const payload = record?.payload && typeof record.payload === 'object' && !Array.isArray(record.payload) ? record.payload : {};
  const metadata = payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata) ? payload.metadata : {};
  return {
    id: record.id == null ? '' : String(record.id),
    org_id: text(record.org_id, 80),
    signal_type: text(record.signal_type, 120),
    source: text(record.source, 120),
    source_ref: text(record.source_ref, 500) || null,
    severity: normalizeSeverity(record.severity),
    confidence: clamp(Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : 0.5, 0, 1),
    content: text(payload.content ?? record.body, 24_000),
    metadata,
    fingerprint: text(record.fingerprint, 128),
    status: text(record.status, 40) || 'new',
    observed_at: normalizeObservedAt(record.observed_at ?? record.created_at),
    processed_at: record.processed_at || null,
    objective_id: record.objective_id || null,
  };
}

export function signalNeedsSynthesis(record = {}) {
  const signal = normalizeSignalRecord(record);
  return ['new', 'queued'].includes(signal.status) && !signal.processed_at && Boolean(signal.content);
}
