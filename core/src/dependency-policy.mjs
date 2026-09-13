export function dependencyIdsFromJob(job, { maxDependencies = 32 } = {}) {
  const raw = job?.input?.plan?.depends_on_job_ids ?? job?.input?.depends_on_job_ids ?? [];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((value) => String(value || '').trim()).filter(Boolean))]
    .slice(0, Math.max(0, Number(maxDependencies) || 32));
}

export function classifyDependencyRows(ids, rows) {
  const dependencyIds = Array.isArray(ids) ? ids.map(String) : [];
  if (!dependencyIds.length) return { state: 'ready', dependency_ids: [] };

  const byId = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id), row]));

  // A known failed prerequisite is terminal even when another prerequisite row
  // is temporarily missing. Do not defer forever when success is impossible.
  const failed = dependencyIds.filter((id) => byId.get(id)?.status === 'failed');
  if (failed.length) return { state: 'failed', dependency_ids: dependencyIds, failed_ids: failed };

  const missing = dependencyIds.filter((id) => !byId.has(id));
  if (missing.length) return { state: 'waiting', dependency_ids: dependencyIds, missing_ids: missing };

  const pending = dependencyIds.filter((id) => byId.get(id)?.status !== 'done');
  if (pending.length) return { state: 'waiting', dependency_ids: dependencyIds, pending_ids: pending };

  return { state: 'ready', dependency_ids: dependencyIds };
}

function boundedJson(value, maxChars = 8000) {
  try {
    const text = JSON.stringify(value ?? null);
    return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
  } catch {
    return String(value ?? '').slice(0, maxChars);
  }
}

export function dependencyEvidenceFromRows(ids, rows, { maxTotalChars = 48_000 } = {}) {
  const byId = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id), row]));
  const evidence = [];
  let used = 0;

  for (const id of Array.isArray(ids) ? ids : []) {
    const row = byId.get(String(id));
    if (!row) continue;
    const outputExcerpt = boundedJson(row.output, Math.max(1000, Math.min(8000, maxTotalChars - used)));
    used += outputExcerpt.length;
    evidence.push({
      id: String(row.id),
      job_type: row.job_type || null,
      target_type: row.target_type || null,
      target_id: row.target_id || null,
      status: row.status || null,
      updated_at: row.updated_at || null,
      output_excerpt: outputExcerpt,
    });
    if (used >= maxTotalChars) break;
  }

  return evidence;
}
