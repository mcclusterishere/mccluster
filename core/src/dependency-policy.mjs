export function dependencyIdsFromJob(job, { maxDependencies = 32 } = {}) {
  const raw = job?.input?.plan?.depends_on_job_ids ?? job?.input?.depends_on_job_ids ?? [];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((value) => String(value || '').trim()).filter(Boolean))]
    .slice(0, Math.max(0, Number(maxDependencies) || 32));
}

export function classifyDependencyRows(ids, rows) {
  const dependencyIds = Array.isArray(ids) ? ids.map(String) : [];
  if (!dependencyIds.length) return { state: 'ready', dependency_ids: [], rows: [] };

  const normalizedRows = Array.isArray(rows) ? rows : [];
  const byId = new Map(normalizedRows.map((row) => [String(row.id), row]));

  // A known failed prerequisite can never become ready. Propagate that failure
  // even when another referenced row is missing, rather than deferring forever.
  const failed = dependencyIds.filter((id) => byId.get(id)?.status === 'failed');
  if (failed.length) {
    return {
      state: 'failed',
      dependency_ids: dependencyIds,
      failed_ids: failed,
      rows: normalizedRows,
    };
  }

  const missing = dependencyIds.filter((id) => !byId.has(id));
  if (missing.length) {
    return {
      state: 'waiting',
      dependency_ids: dependencyIds,
      missing_ids: missing,
      rows: normalizedRows,
    };
  }

  const pending = dependencyIds.filter((id) => byId.get(id)?.status !== 'done');
  if (pending.length) {
    return {
      state: 'waiting',
      dependency_ids: dependencyIds,
      pending_ids: pending,
      rows: normalizedRows,
    };
  }

  return { state: 'ready', dependency_ids: dependencyIds, rows: normalizedRows };
}

export function dependencyEvidence(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    job_id: row.id,
    job_type: row.job_type,
    target_type: row.target_type,
    target_id: row.target_id,
    status: row.status,
    output: row.output ?? null,
    error: row.error ?? null,
    completed_at: row.completed_at ?? null,
  }));
}
