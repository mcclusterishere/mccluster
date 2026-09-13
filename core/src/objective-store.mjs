import { rest } from './supabase.mjs';

function bounded(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function objectiveById({ orgId, objectiveId }) {
  const params = new URLSearchParams({
    id: `eq.${objectiveId}`,
    org_id: `eq.${orgId}`,
    select: '*',
    limit: '1',
  });
  const { body: rows = [] } = await rest(`ops_objectives?${params.toString()}`);
  return rows[0] || null;
}

export async function createObjective({
  objectiveId,
  orgId,
  name,
  description = '',
  priority = 50,
  successMetric = {},
  scope = {},
} = {}) {
  if (!orgId) throw new Error('createObjective requires orgId');
  const objectiveName = bounded(name, 240);
  if (!objectiveName) throw new Error('createObjective requires name');

  const row = {
    org_id: orgId,
    name: objectiveName,
    description: bounded(description, 12_000) || null,
    status: 'active',
    priority: Math.min(100, Math.max(0, Number(priority) || 0)),
    success_metric: object(successMetric),
    scope: object(scope),
  };
  if (objectiveId) row.id = String(objectiveId);

  const endpoint = objectiveId ? 'ops_objectives?on_conflict=id' : 'ops_objectives';
  const prefer = objectiveId ? 'resolution=ignore-duplicates,return=representation' : 'return=representation';
  const { body: rows = [] } = await rest(endpoint, {
    method: 'POST',
    headers: { Prefer: prefer },
    body: JSON.stringify(row),
  });
  if (rows.length) return rows[0];

  if (objectiveId) {
    const existing = await objectiveById({ orgId, objectiveId });
    if (existing) return existing;
  }
  throw new Error('Failed to create canonical objective');
}

export async function updateObjective({
  orgId,
  objectiveId,
  name,
  description = '',
  priority = 50,
  successMetric = {},
  scope = {},
} = {}) {
  if (!orgId || !objectiveId) throw new Error('updateObjective requires orgId and objectiveId');
  const objectiveName = bounded(name, 240);
  if (!objectiveName) throw new Error('updateObjective requires name');

  const params = new URLSearchParams({
    id: `eq.${objectiveId}`,
    org_id: `eq.${orgId}`,
    status: 'eq.active',
  });
  const { body: rows = [] } = await rest(`ops_objectives?${params.toString()}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      name: objectiveName,
      description: bounded(description, 12_000) || null,
      priority: Math.min(100, Math.max(0, Number(priority) || 0)),
      success_metric: object(successMetric),
      scope: object(scope),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!rows.length) throw new Error(`Canonical objective ${objectiveId} was not active or was not found`);
  return rows[0];
}
