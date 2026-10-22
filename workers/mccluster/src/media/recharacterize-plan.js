// Private Stage-0 preflight primitive for a future video.recharacterize executor.
// Nothing in this module authorizes spend, verifies likeness rights, or submits
// provider jobs. The server MUST do those things separately and fail closed.
//
// Input shots are immutable server-derived, contiguous time ranges with the
// approved target track present in EACH shot. A shot must never be rendered if
// the target track is missing or tracking becomes ambiguous mid-shot.

function invalid(message, details = {}) {
  return Object.assign(new Error(message), { status: 422, detail: details });
}

function positiveSafeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalid(field + ' must be a positive safe integer', { field, received: value });
  }
  return value;
}

function nonNegativeSafeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalid(field + ' must be a non-negative safe integer', { field, received: value });
  }
  return value;
}

function approvedTrack(shot, trackId) {
  return Array.isArray(shot.track_ids)
    && shot.track_ids.includes(trackId)
    && !shot.ambiguous_tracks?.includes(trackId);
}

/**
 * @param {object} input Verified source metadata and pre-authorized spend envelope.
 * @returns {object} An inert, serializable, ordered shot/segment plan.
 *
 * Every generated interval is in milliseconds. Source shot boundaries are
 * immutable; cuts never get spanned by a single generative work unit.
 * Prices include expensive overlap frames, not only source-video seconds.
 */
export function buildRecharacterizePlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalid('A verified shot plan input is required');
  }
  const durationMs = positiveSafeInteger(input.duration_ms, 'duration_ms');
  const maxWindowMs = positiveSafeInteger(input.model_window_ms, 'model_window_ms');
  const overlapMs = nonNegativeSafeInteger(input.overlap_ms, 'overlap_ms');
  const approvedCostCents = positiveSafeInteger(input.approved_cost_cents, 'approved_cost_cents');
  const trackId = input.target_track_id;

  if (typeof trackId !== 'string' || !trackId.trim()) {
    throw invalid('A server-derived target_track_id is required');
  }
  if (!Array.isArray(input.shots) || input.shots.length === 0) {
    throw invalid('A nonempty server-derived shot list is required');
  }
  if (!Number.isFinite(input.estimated_cents_per_second) || input.estimated_cents_per_second <= 0) {
    throw invalid('Provider price must be verified before creating a paid shot plan');
  }
  if (maxWindowMs > 60000) {
    throw invalid('Model window exceeds the permitted candidate evaluation envelope');
  }
  if (overlapMs >= maxWindowMs / 2) {
    throw invalid('Overlap must be less than half of one model window');
  }
  if (input.shots.length > 1000) {
    throw invalid('Source exceeds the maximum shot count for a single plan');
  }

  const segments = [];
  let cursorMs = 0;
  let totalRenderMs = 0;
  const seenShotIds = new Set();

  for (const shot of input.shots) {
    if (!shot || typeof shot !== 'object' || Array.isArray(shot)
      || typeof shot.id !== 'string' || !shot.id.trim() || seenShotIds.has(shot.id)) {
      throw invalid('Every shot needs a unique nonblank stable ID');
    }
    seenShotIds.add(shot.id);
    const startMs = nonNegativeSafeInteger(shot.start_ms, 'shot.start_ms');
    const endMs = positiveSafeInteger(shot.end_ms, 'shot.end_ms');

    if (startMs !== cursorMs || endMs <= startMs || endMs > durationMs) {
      throw invalid('Shots must form one complete, ordered, non-overlapping source timeline', {
        shot_id: shot.id, expected_start_ms: cursorMs,
        start_ms: startMs, end_ms: endMs, duration_ms: durationMs
      });
    }
    if (!approvedTrack(shot, trackId)) {
      throw invalid('Selected person is missing or tracking is ambiguous in shot; no rendering authorized', {
        shot_id: shot.id, target_track_id: trackId
      });
    }

    const shotLengthMs = endMs - startMs;
    const count = shotLengthMs <= maxWindowMs
      ? 1
      : Math.ceil((shotLengthMs - overlapMs) / (maxWindowMs - overlapMs));

    if (!Number.isSafeInteger(count) || count < 1 || segments.length + count > 2000) {
      throw invalid('Shot plan exceeds bounded segment capacity');
    }

    const nominalWindowMs = Math.ceil((shotLengthMs + ((count - 1) * overlapMs)) / count);
    const strideMs = count === 1 ? shotLengthMs : (shotLengthMs - overlapMs) / count;

    let previousEndMs = null;
    for (let index = 0; index < count; index += 1) {
      const segmentStartMs = startMs + Math.round(index * strideMs);
      const segmentEndMs = index === count - 1
        ? endMs
        : Math.min(endMs, segmentStartMs + nominalWindowMs);

      if (segmentEndMs - segmentStartMs > maxWindowMs || segmentEndMs <= segmentStartMs) {
        throw invalid('Computed segment violates model window contract', { shot_id: shot.id, index });
      }
      const seamOverlapMs = previousEndMs === null ? 0 : Math.max(0, previousEndMs - segmentStartMs);
      if (previousEndMs !== null && seamOverlapMs < overlapMs - 2) {
        throw invalid('Computed segment lacks required temporal overlap', { shot_id: shot.id, index });
      }

      totalRenderMs += segmentEndMs - segmentStartMs;
      segments.push({
        id: shot.id + ':' + String(index + 1),
        shot_id: shot.id,
        sequence: index + 1,
        start_ms: segmentStartMs,
        end_ms: segmentEndMs,
        seam_overlap_ms: seamOverlapMs,
        target_track_id: trackId,
        needs_review: true
      });
      previousEndMs = segmentEndMs;
    }
    if (previousEndMs !== endMs) {
      throw invalid('Segment plan did not fully cover a shot', { shot_id: shot.id });
    }
    cursorMs = endMs;
  }
  if (cursorMs !== durationMs) {
    throw invalid('Source timeline is not fully covered; no partial invisible edits', {
      expected_end_ms: durationMs, actual_end_ms: cursorMs
    });
  }

  const estimatedCostCents = Math.ceil((totalRenderMs / 1000) * input.estimated_cents_per_second);
  if (!Number.isSafeInteger(estimatedCostCents) || estimatedCostCents > approvedCostCents) {
    throw invalid('Estimated segment render cost exceeds approved budget', {
      estimated_cost_cents: estimatedCostCents,
      approved_cost_cents: approvedCostCents,
      total_render_ms: totalRenderMs
    });
  }

  return Object.freeze({
    version: 'recharacterize-shot-plan.v1',
    source_duration_ms: durationMs,
    total_render_ms: totalRenderMs,
    estimated_cost_cents: estimatedCostCents,
    max_approved_cost_cents: approvedCostCents,
    model_window_ms: maxWindowMs,
    overlap_ms: overlapMs,
    subject_track_id: trackId,
    segments,
    renderer_ready: false,
    requires_rights_check: true,
    requires_manual_review: true,
    external_publish_allowed: false
  });
}
