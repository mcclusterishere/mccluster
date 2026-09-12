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
  const missing = dependencyIds.filter((id) => !byId.has(id));
  if (missing.length) return { state: 'waiting', dependency_ids: dependencyIds, missing_ids: missing };

  const failed = dependencyIds.filter((id) => byId.get(id)?.status === 'failed');
  if (failed.length) return { state: 'failed', dependency_ids: dependencyIds, failed_ids: failed };

  const pending = dependencyIds.filter((id) => byId.get(id)?.status !== 'done');
  if (pending.length) return { state: 'waiting', dependency_ids: dependencyIds, pending_ids: pending };

  return { state: 'ready', dependency_ids: dependencyIds };
}
