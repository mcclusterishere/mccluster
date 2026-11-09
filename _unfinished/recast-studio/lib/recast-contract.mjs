/**
 * Local planning contract only. No storage, network, authentication, provider
 * submission or spending. McCluster media_jobs remains the future authority.
 * Client attestations are declarations, never verified consent or permissions.
 */
export const PROVIDERS = Object.freeze({
  'fal-h3-max-recast': Object.freeze({
    label: 'fal H3 Max Recast', status: 'planning-only',
    minSeconds: 5, maxSeconds: 30, maxShotSeconds: 15,
    ratesUsdPerSecond: Object.freeze({ '768P': 0.30, '1080P': 0.45 }),
  }),
  'openjutsu-h3-selfhost': Object.freeze({
    label: 'Openjutsu H3 self-host', status: 'license-review-required',
    minSeconds: 5, maxSeconds: 30, maxShotSeconds: 15,
    ratesUsdPerSecond: Object.freeze({ '768P': null, '1080P': null }),
  }),
  'wan22-animate-selfhost': Object.freeze({
    label: 'Wan2.2 Animate self-host', status: 'disabled-future-candidate',
    constraintsVerified: false,
    ratesUsdPerSecond: Object.freeze({ '480P': null, '720P': null }),
  }),
});

const RIGHTS = ['footageRights', 'likenessConsent', 'providerSharing'];
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const HASH = /^[a-fA-F0-9]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && ID.test(value) ? value : null;
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const providerFor = name => Object.hasOwn(PROVIDERS, name ?? '') ? PROVIDERS[name] : null;
const ceilMoney = value => Math.ceil(value * 100) / 100;
const resolutionFor = (provider, value) => {
  const profile = providerFor(provider);
  return typeof value === 'string' && profile && Object.hasOwn(profile.ratesUsdPerSecond, value) ? value : null;
};

function editorialText(value, maximum) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > maximum) return null;
  // Text only, never HTML. Reject controls, bidi overrides, markup and raw URLs.
  if (/[<>\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value) || containsRawUrl(value)) return null;
  const clean = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  return clean.length <= maximum ? clean : null;
}

function containsRawUrl(value, depth = 0, seen = new Set()) {
  if (typeof value === 'string') return /(?:https?:\/\/|file:\/\/|data:|blob:|^\/\/)/i.test(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  if (depth > 12) return true; // Fail closed for malformed/deep input.
  seen.add(value);
  return Object.entries(value).some(([key, item]) =>
    /url|uri/i.test(key) && item != null && item !== '' || containsRawUrl(item, depth + 1, seen));
}

function normalize(input) {
  const request = object(input) ? input : {};
  const source = object(request.sourceVideo) ? request.sourceVideo : {};
  const rights = object(request.attestations) ? request.attestations : {};
  const editorial = object(request.editorial) ? request.editorial : {};
  return {
    schemaVersion: 'recast-plan-v2',
    orgId: id(request.orgId), operationId: id(request.operationId),
    sourceVideo: {
      id: id(source.id), seconds: number(source.seconds), fps: number(source.fps),
      hash: typeof source.hash === 'string' && HASH.test(source.hash) ? source.hash.toLowerCase() : null,
    },
    characterReferences: Array.isArray(request.characterReferences)
      ? request.characterReferences.slice(0, 32).map(ref => ({ id: id(object(ref) ? ref.id : null) })) : [],
    provider: providerFor(request.provider) ? request.provider : null,
    resolution: resolutionFor(request.provider, request.resolution),
    editorial: {
      startSeconds: editorial.startSeconds === undefined ? 0 : number(editorial.startSeconds),
      durationSeconds: editorial.durationSeconds === undefined ? number(source.seconds) : number(editorial.durationSeconds),
      direction: editorialText(editorial.direction, 2000),
      characterLabel: editorialText(editorial.characterLabel, 120),
    },
    budgetUsd: number(request.budgetUsd),
    territory: ['US', 'EU', 'UK', 'KR', 'OTHER'].includes(request.territory) ? request.territory : 'UNKNOWN',
    attestations: Object.fromEntries(RIGHTS.map(key => [key, rights[key] === true])),
  };
}

export function validateRecastRequest(input) {
  const normalized = normalize(input);
  const errors = [];
  const add = (code, path, message) => errors.push({ code, path, message });
  if (!object(input)) add('INVALID_REQUEST', '', 'Provide a planning request object.');
  for (const key of ['orgId', 'operationId']) {
    if (!normalized[key]) add('INVALID_ID', key, 'Use an opaque asset or operation ID, not a URL.');
  }
  if (containsRawUrl(input)) add('RAW_URL_NOT_ALLOWED', '', 'Use canonical asset IDs. Raw URLs are not accepted.');
  if (!normalized.sourceVideo.id) add('SOURCE_REQUIRED', 'sourceVideo.id', 'Choose a source video separately from character references.');
  const sourceSeconds = normalized.sourceVideo.seconds;
  if (sourceSeconds === null || sourceSeconds <= 0 || sourceSeconds > 86400) add('INVALID_SOURCE_DURATION', 'sourceVideo.seconds', 'Full source duration must be positive and no greater than 24 hours. Metadata remains unverified.');
  const seconds = normalized.editorial.durationSeconds;
  if (seconds === null || seconds < 5 || seconds > 30) add('INVALID_DURATION', 'editorial.durationSeconds', 'Selected clip duration must be 5–30 seconds for this prototype. Future-provider capabilities remain unverified.');
  if (input?.editorial !== undefined && !object(input.editorial)) add('INVALID_EDITORIAL', 'editorial', 'Editorial controls must be an object.');
  const start = normalized.editorial.startSeconds;
  if (start === null || start < 0 || sourceSeconds === null || start >= sourceSeconds) add('INVALID_START', 'editorial.startSeconds', 'Start offset must be nonnegative and within the source duration.');
  if (start !== null && seconds !== null && sourceSeconds !== null && start + seconds > sourceSeconds) add('SELECTION_OUT_OF_BOUNDS', 'editorial.durationSeconds', 'The selected clip must fit within the full source duration.');
  for (const key of ['direction', 'characterLabel']) {
    if (normalized.editorial[key] === null) add('INVALID_EDITORIAL_TEXT', `editorial.${key}`, 'Use plain text without markup, raw URLs or control characters. Direction allows 2,000 characters; character labels allow 120.');
  }
  const fps = normalized.sourceVideo.fps;
  if (fps === null || fps <= 0 || fps > 240) add('INVALID_FPS', 'sourceVideo.fps', 'Provide a positive source frame rate no greater than 240 fps.');
  if (input?.sourceVideo?.hash != null && !normalized.sourceVideo.hash) add('INVALID_HASH', 'sourceVideo.hash', 'An optional source hash must be 64 hexadecimal SHA-256 characters.');
  const refs = normalized.characterReferences;
  if (!refs.length || !Array.isArray(input?.characterReferences) || input.characterReferences.length > 32) {
    add('REFERENCES_REQUIRED', 'characterReferences', 'Provide 1–32 separate character reference asset IDs.');
  }
  if (refs.some(ref => !ref.id)) add('INVALID_REFERENCE', 'characterReferences', 'Every character reference needs an opaque asset ID.');
  if (refs.some(ref => ref.id && ref.id === normalized.sourceVideo.id)) add('SOURCE_REFERENCE_OVERLAP', 'characterReferences', 'The source video cannot also be a character reference.');
  if (new Set(refs.map(ref => ref.id)).size !== refs.length) add('DUPLICATE_REFERENCE', 'characterReferences', 'Each character reference must be distinct.');
  for (const key of RIGHTS) {
    if (!normalized.attestations[key]) add('ATTESTATION_REQUIRED', `attestations.${key}`, 'Declare footage rights, likeness consent and provider sharing before planning. Declarations require later verification.');
  }
  const provider = providerFor(normalized.provider);
  if (!provider) add('UNSUPPORTED_PROVIDER', 'provider', 'Choose a listed provider profile.');
  if (!normalized.resolution) add('UNSUPPORTED_RESOLUTION', 'resolution', 'Choose a resolution listed for the selected provider profile. Future-candidate options are not verified capability claims.');
  if (normalized.budgetUsd === null || normalized.budgetUsd <= 0 || normalized.budgetUsd > 100000) {
    add('INVALID_BUDGET', 'budgetUsd', 'Set a positive USD ceiling no greater than 100,000.');
  }
  const rate = provider?.ratesUsdPerSecond[normalized.resolution];
  if (typeof rate === 'number' && seconds !== null && seconds >= 5 && seconds <= 30 && normalized.budgetUsd !== null && ceilMoney(seconds * rate) > normalized.budgetUsd) {
    add('BUDGET_EXCEEDED', 'budgetUsd', 'The hypothetical base estimate exceeds the budget ceiling.');
  }
  if (normalized.provider === 'openjutsu-h3-selfhost') {
    add('LICENSE_VERIFICATION_REQUIRED', 'provider', 'Self-hosted H3 is blocked pending externally verified licensing. US, EU, UK and KR restrictions fail closed; request booleans cannot grant an exception. This prototype accepts no licensing override in any territory.');
  }
  if (normalized.provider === 'wan22-animate-selfhost') {
    add('FUTURE_PROVIDER_DISABLED', 'provider', 'Wan2.2 Animate is an uncosted future candidate. Integration, capability and licensing evaluation are incomplete.');
  }
  return { valid: errors.length === 0, errors };
}

/** Async only for standards-based SHA-256; no Node-only imports. */
export async function buildRecastPlan(input) {
  const request = normalize(input);
  const validation = validateRecastRequest(input);
  const bytes = new TextEncoder().encode(JSON.stringify(request));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const planHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const provider = providerFor(request.provider);
  const seconds = request.editorial.durationSeconds;
  const validDuration = seconds !== null && seconds >= 5 && seconds <= 30;
  const rate = provider?.ratesUsdPerSecond[request.resolution];
  const estimate = typeof rate === 'number' && validDuration ? ceilMoney(seconds * rate) : null;
  const count = validDuration ? Math.ceil(seconds / 15) : 0;
  const proposedSegments = Array.from({ length: count }, (_, index) => ({
    index, startSeconds: request.editorial.startSeconds + index * seconds / count,
    endSeconds: request.editorial.startSeconds + (index + 1) * seconds / count, seconds: seconds / count,
    sourceVideoId: request.sourceVideo.id,
    characterReferenceIds: request.characterReferences.map(ref => ref.id),
  }));
  return {
    ...request, ...validation, planHash,
    idempotencyKey: request.orgId && request.operationId ? `${request.orgId}:${request.operationId}` : null,
    state: validation.valid ? 'ready' : 'draft',
    mode: 'local-prototype', readyForLive: false, liveSubmissionEnabled: false,
    authority: { api: 'https://api.mccluster.org', store: 'media_jobs', integration: 'not-connected' },
    proposedSegments,
    segmentation: {
      method: 'equal-length-proposal', verifiedShotDetection: false, perShotLimitVerified: false,
      warning: 'These are suggested time divisions, not detected shots or executed cuts. A long uncut source is not proven to meet the 15-second per-shot rule. Source and editorial bounds need server-side verification.',
    },
    cost: {
      kind: 'hypothetical-estimate', currency: 'USD', estimatedUsd: estimate,
      rateUsdPerSecond: typeof rate === 'number' ? rate : null,
      budgetCeilingUsd: request.budgetUsd, quote: false, charge: false,
      withinBaseEstimateBudget: estimate !== null && request.budgetUsd !== null ? estimate <= request.budgetUsd : null,
      uncertainty: 'Provider rates, billed duration, minimums, taxes, storage, retries, stitching and compute can change the total. No live quote or charge has occurred.',
    },
    attestationsVerified: false, sourceMetadataVerified: false,
    launchGates: [
      'Authenticated McCluster tenant scope and canonical asset ownership checks.',
      'Server-side footage rights, likeness consent and provider-sharing review; checkboxes alone are not verified legal consent.',
      'Provider and model licensing, territory, acceptable-use and output-rights review.',
      'Canonical media_jobs adapter, durable operation reservation and payload hash conflict checks.',
      'Server-verified source metadata, content hashes, editorial bounds and supported character-reference limits.',
      'Verified shot boundaries or explicitly reviewed cuts; proposed segments do not prove the 15-second per-shot limit.',
      'Provider preflight quote and atomic total-budget reservation, including all shots and overhead.',
      'Provider capability evaluation, shot continuity, audio policy and output quality checks.',
      'Signed output storage, cancellation semantics and reconciliation of uncertain submissions.',
      'Explicit production release approval; this module never submits a live job.',
    ],
  };
}

const TRANSITIONS = Object.freeze({
  draft: ['ready', 'canceled'], ready: ['queued', 'canceled'],
  queued: ['running', 'succeeded', 'failed', 'canceled', 'reconciling'],
  running: ['succeeded', 'failed', 'canceled', 'reconciling'],
  reconciling: ['running', 'succeeded', 'failed', 'canceled'],
  succeeded: [], failed: [], canceled: [],
});

/**
 * Models lifecycle locally. outcomeVerified is simulated reconciliation evidence,
 * NOT authority to execute. Production must verify evidence server-side. Never
 * retry a submission after an uncertain result: reconcile the SAME operation.
 */
export function transitionJob(job, nextState, { outcomeVerified = false } = {}) {
  if (!object(job) || !id(job.orgId) || !id(job.operationId) || typeof job.planHash !== 'string' || !HASH.test(job.planHash)) {
    throw new Error('A job requires orgId, operationId and a valid planHash.');
  }
  if (!Object.hasOwn(TRANSITIONS, job.state) || !Object.hasOwn(TRANSITIONS, nextState)) throw new Error('Unknown job state.');
  if (job.state !== nextState && !TRANSITIONS[job.state].includes(nextState)) throw new Error(`Invalid transition: ${job.state} -> ${nextState}. Reconcile uncertain operations; do not resubmit them.`);
  const terminal = ['succeeded', 'failed', 'canceled'].includes(nextState);
  if (job.state !== nextState && ((['queued', 'running'].includes(job.state) && terminal) || job.state === 'reconciling') && outcomeVerified !== true) {
    throw new Error('Verified outcome evidence is required; keep the same operation in reconciling while uncertain.');
  }
  return {
    orgId: job.orgId, operationId: job.operationId, planHash: job.planHash,
    idempotencyKey: `${job.orgId}:${job.operationId}`, state: nextState,
    mode: 'local-prototype', readyForLive: false, liveSubmissionEnabled: false,
    uncertain: nextState === 'reconciling',
  };
}
