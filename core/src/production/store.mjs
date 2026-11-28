/* Production records: projects, members, assets, consents, shots, jobs
   and artifacts, in Supabase zmnhbrjyhxzhkxmhkexs (migration
   supabase/pending/production_pipeline_v1.sql),
   reached with the service role from Core only. The durable job queue
   is NOT here: a production job is a row that points at one
   ops_compute_tasks row, which is the single queue the signed compute
   protocol already leases from.

   memoryProductionStore() is the same interface in memory, for tests
   and for an offline Prime with no network (it is never a second
   source of truth: nothing reads it back into Supabase). */

import crypto from 'node:crypto';
import { rest } from '../supabase.mjs';

export const PRODUCTION_PENDING_SQL = 'supabase/pending/production_pipeline_v1.sql';

function eq(value) { return `eq.${value}`; }

function notApplied(error) {
  const text = `${error?.message || ''} ${JSON.stringify(error?.detail || error?.body || '')}`;
  return /production_(projects|jobs|assets|artifacts|members|consents|shots)/.test(text) && /(does not exist|not find|PGRST20[0-5]|42P01)/i.test(text);
}

function wrap(fn) {
  return async (...args) => {
    try { return await fn(...args); }
    catch (error) {
      if (notApplied(error)) {
        throw Object.assign(new Error(`Production tables are not applied yet (${PRODUCTION_PENDING_SQL})`), { status: 503, code: 'PRODUCTION_NOT_APPLIED', retryable: false });
      }
      throw error;
    }
  };
}

export function supabaseProductionStore({ restImpl = rest } = {}) {
  const get = async (path) => (await restImpl(path)).body || [];
  return {
    kind: 'supabase',
    getProject: wrap(async (orgId, projectId) => {
      const params = new URLSearchParams({ org_id: eq(orgId), id: eq(projectId), select: 'id,org_id,title,status,storage,settings,created_at,updated_at', limit: '1' });
      const [project] = await get(`production_projects?${params}`);
      if (!project) return null;
      const scoped = (table, select, extra = {}) => get(`${table}?${new URLSearchParams({ project_id: eq(projectId), org_id: eq(orgId), select, ...extra })}`);
      const [assets, consents, shots, members] = await Promise.all([
        scoped('production_assets', 'asset_id,version,kind,path,sha256,bytes,approved,editable,label,metadata,created_at', { order: 'asset_id.asc,version.desc', limit: '500' }),
        scoped('production_consents', 'actor_id,profile_id,scope,granted_at,revoked_at,evidence_ref', { limit: '200' }),
        scoped('production_shots', 'shot_id,episode,start_frame,end_frame,fps,camera,line_id,actors,status', { order: 'shot_id.asc', limit: '500' }),
        scoped('production_members', 'profile_id,role', { limit: '200' })
      ]);
      return { ...project, assets, consents, shots, members };
    }),
    memberRole: wrap(async (orgId, projectId, profileId) => {
      const params = new URLSearchParams({ org_id: eq(orgId), project_id: eq(projectId), profile_id: eq(profileId), select: 'role', limit: '1' });
      const [row] = await get(`production_members?${params}`);
      return row?.role || null;
    }),
    isOrgOwner: wrap(async (orgId, profileId) => {
      const params = new URLSearchParams({ org_id: eq(orgId), profile_id: eq(profileId), role: 'eq.owner', select: 'org_id', limit: '1' });
      return (await get(`org_members?${params}`)).length > 0;
    }),
    listAssets: wrap(async (orgId, projectId, { kind = null, query = null, limit = 50 } = {}) => {
      const params = new URLSearchParams({ org_id: eq(orgId), project_id: eq(projectId), select: 'asset_id,version,kind,path,sha256,bytes,approved,editable,label,metadata,created_at', order: 'asset_id.asc,version.desc', limit: String(limit) });
      if (kind) params.set('kind', eq(kind));
      if (query) params.set('or', `(asset_id.ilike.*${query}*,label.ilike.*${query}*)`);
      return get(`production_assets?${params}`);
    }),
    findJobByKey: wrap(async (orgId, jobKey) => {
      const params = new URLSearchParams({ org_id: eq(orgId), job_key: eq(jobKey), select: '*', limit: '1' });
      return (await get(`production_jobs?${params}`))[0] || null;
    }),
    insertJob: wrap(async (row) => {
      const { body } = await restImpl('production_jobs?on_conflict=org_id,job_key', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify(row)
      });
      return Array.isArray(body) && body[0] ? { job: body[0], created: true } : { job: null, created: false };
    }),
    getJob: wrap(async (orgId, jobId) => {
      const params = new URLSearchParams({ org_id: eq(orgId), id: eq(jobId), select: '*', limit: '1' });
      return (await get(`production_jobs?${params}`))[0] || null;
    }),
    updateJob: wrap(async (orgId, jobId, patch) => {
      const params = new URLSearchParams({ org_id: eq(orgId), id: eq(jobId) });
      const { body } = await restImpl(`production_jobs?${params}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
      return Array.isArray(body) ? body[0] || null : null;
    }),
    listJobs: wrap(async (orgId, projectId, { shotId = null, kind = 'render', limit = 50 } = {}) => {
      const params = new URLSearchParams({ org_id: eq(orgId), project_id: eq(projectId), kind: eq(kind), select: '*', order: 'created_at.desc', limit: String(limit) });
      if (shotId) params.set('shot_id', eq(shotId));
      return get(`production_jobs?${params}`);
    }),
    insertArtifacts: wrap(async (rows) => {
      if (!rows.length) return [];
      const { body } = await restImpl('production_artifacts?on_conflict=job_id,kind,path', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(rows)
      });
      return Array.isArray(body) ? body : [];
    }),
    listArtifacts: wrap(async (orgId, { jobId = null, artifactId = null, projectId = null, limit = 100 } = {}) => {
      const params = new URLSearchParams({ org_id: eq(orgId), select: '*', order: 'created_at.desc', limit: String(limit) });
      if (jobId) params.set('job_id', eq(jobId));
      if (artifactId) params.set('id', eq(artifactId));
      if (projectId) params.set('project_id', eq(projectId));
      return get(`production_artifacts?${params}`);
    }),
    leaseProgress: async (taskId) => {
      const params = new URLSearchParams({ task_id: eq(taskId), select: 'node_id,status,progress,started_at,completed_at,updated_at', order: 'created_at.desc', limit: '1' });
      return (await get(`ops_compute_leases?${params}`))[0] || null;
    },
    requestComputeCancel: wrap(async (orgId, taskId, reason) => {
      const { body } = await restImpl('rpc/production_request_compute_cancel', {
        method: 'POST', body: JSON.stringify({ p_org_id: orgId, p_task_id: taskId, p_reason: String(reason || 'canceled').slice(0, 500) })
      });
      return body;
    })
  };
}

// In-memory store with the same interface. `seed` is a project record
// shaped like getProject() returns.
export function memoryProductionStore({ projects = [], orgOwners = [] } = {}) {
  const projectRows = new Map(projects.map((p) => [`${p.org_id}:${p.id}`, structuredClone(p)]));
  const jobs = new Map();
  const artifacts = [];
  const owners = new Set(orgOwners.map((o) => `${o.org_id}:${o.profile_id}`));
  const leases = new Map();
  const cancels = [];
  return {
    kind: 'memory',
    _jobs: jobs,
    _artifacts: artifacts,
    _leases: leases,
    _cancels: cancels,
    async getProject(orgId, projectId) { return structuredClone(projectRows.get(`${orgId}:${projectId}`) || null); },
    async memberRole(orgId, projectId, profileId) {
      const p = projectRows.get(`${orgId}:${projectId}`);
      return p?.members?.find((m) => m.profile_id === profileId)?.role || null;
    },
    async isOrgOwner(orgId, profileId) { return owners.has(`${orgId}:${profileId}`); },
    async listAssets(orgId, projectId, { kind = null, query = null, limit = 50 } = {}) {
      const p = projectRows.get(`${orgId}:${projectId}`);
      return (p?.assets || []).filter((a) => (!kind || a.kind === kind) && (!query || `${a.asset_id} ${a.label || ''}`.toLowerCase().includes(String(query).toLowerCase()))).slice(0, limit);
    },
    async findJobByKey(orgId, jobKey) { return [...jobs.values()].find((j) => j.org_id === orgId && j.job_key === jobKey) || null; },
    async insertJob(row) {
      const existing = [...jobs.values()].find((j) => j.org_id === row.org_id && j.job_key === row.job_key);
      if (existing) return { job: null, created: false };
      const job = { id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), cancel_requested_at: null, ...row };
      jobs.set(job.id, job);
      return { job: structuredClone(job), created: true };
    },
    async getJob(orgId, jobId) { const j = jobs.get(jobId); return j && j.org_id === orgId ? structuredClone(j) : null; },
    async updateJob(orgId, jobId, patch) {
      const j = jobs.get(jobId);
      if (!j || j.org_id !== orgId) return null;
      Object.assign(j, patch, { updated_at: new Date().toISOString() });
      return structuredClone(j);
    },
    async listJobs(orgId, projectId, { shotId = null, kind = 'render', limit = 50 } = {}) {
      return [...jobs.values()].filter((j) => j.org_id === orgId && j.project_id === projectId && j.kind === kind && (!shotId || j.shot_id === shotId))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, limit).map((j) => structuredClone(j));
    },
    async insertArtifacts(rows) {
      const out = [];
      for (const row of rows) {
        const existing = artifacts.find((a) => a.job_id === row.job_id && a.kind === row.kind && a.path === row.path);
        if (existing) { Object.assign(existing, row); out.push(structuredClone(existing)); continue; }
        const artifact = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...row };
        artifacts.push(artifact);
        out.push(structuredClone(artifact));
      }
      return out;
    },
    async listArtifacts(orgId, { jobId = null, artifactId = null, projectId = null, limit = 100 } = {}) {
      return artifacts.filter((a) => a.org_id === orgId && (!jobId || a.job_id === jobId) && (!artifactId || a.id === artifactId) && (!projectId || a.project_id === projectId)).slice(0, limit).map((a) => structuredClone(a));
    },
    async leaseProgress(taskId) { return leases.get(taskId) || null; },
    async requestComputeCancel(orgId, taskId, reason) { cancels.push({ orgId, taskId, reason }); return { ok: true, task_id: taskId }; }
  };
}
