import { reply } from '../lib/http.js';
import { LEVEL_ASSETS, LEVEL_ASSET_KIT } from './level-assets.js';
import { LEVEL_ID, readLevelJson, assertMutationBody, validateLevelDocument } from './level-validation.js';

export const PRIM3_LEVELS_PREFIX = '/v1/prim3/levels';
const META = 'id,title,revision,archived,published_version,created_by,updated_by,created_at,updated_at';
const noStore = (request, env, body, status = 200) => {
  const response = reply(request, env, body, status);
  response.headers.set('cache-control', 'private, no-store');
  return response;
};
const problem = (status, code, message, detail) => Object.assign(new Error(message), { status, code, detail });
const rowView = row => ({
  id: row.id, title: row.title, revision: row.revision,
  status: row.archived ? 'archived' : 'draft', publishedVersion: row.published_version ?? null,
  createdBy: row.created_by, updatedBy: row.updated_by,
  createdAt: row.created_at, updatedAt: row.updated_at,
  ...(row.draft === undefined ? {} : { document: row.draft })
});

function database(env, fetchImpl) {
  return async (path, body) => {
    let response;
    try {
      response = await fetchImpl(`${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
        // workerd rejects redirect: 'error'; take redirects manually and treat any as an unavailable store
        method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch { throw problem(503, 'storage_unavailable', 'Level storage is unavailable.'); }
    if (response.status >= 300 && response.status < 400) throw problem(503, 'storage_unavailable', 'Level storage is unavailable.');
    let result;
    try { result = await response.json(); } catch { throw problem(503, 'storage_unavailable', 'Level storage returned an invalid response.'); }
    if (!response.ok) {
      const code = result?.code;
      if (['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code)) throw problem(503, 'schema_not_installed', 'Level storage has not been installed.');
      if (code === '42501') throw problem(403, 'owner_required', 'McCluster house owner access required.');
      if (code === '40001') throw problem(409, 'revision_conflict', 'This level changed. Reload it before saving.');
      if (code === '23505') throw problem(409, 'level_exists', 'A level with this ID already exists.');
      if (code === 'P0002') throw problem(404, 'level_not_found', 'Level not found.');
      if (code === '55000') throw problem(409, 'level_archived', 'Restore this archived level before editing or publishing.');
      if (code === '23514' || code === '22023') throw problem(400, 'invalid_level', 'The database rejected the level document.');
      throw problem(503, 'storage_unavailable', 'Level storage is unavailable.');
    }
    return result;
  };
}

function validateOrThrow(level, playable = false) {
  const verdict = validateLevelDocument(level, { playable });
  if (!verdict.ok) throw problem(422, playable ? 'level_not_playable' : 'invalid_level', 'The level needs corrections.', { errors: verdict.errors });
  return verdict;
}

/** All reads and mutations share the canonical, freshly checked house-owner gate. */
export async function handlePrim3Levels(request, env, { requireHouseOwner, fetchImpl = fetch, validatePlayable = level => validateLevelDocument(level, { playable: true }) } = {}) {
  const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '');
  if (path !== PRIM3_LEVELS_PREFIX && !path.startsWith(`${PRIM3_LEVELS_PREFIX}/`)) return null;
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw problem(503, 'not_configured', 'McCluster is not configured.');
    if (typeof requireHouseOwner !== 'function') throw problem(503, 'authorization_unavailable', 'Level authorization is unavailable.');
    let user;
    try { user = await requireHouseOwner(request, env); }
    catch (error) {
      if (error.status === 401) throw problem(401, 'authentication_required', 'Authentication required.');
      if (error.status === 403) throw problem(403, 'owner_required', 'McCluster house owner access required.');
      throw problem(503, 'authorization_unavailable', 'Level authorization is unavailable.');
    }
    if (!user?.id) throw problem(401, 'authentication_required', 'Authentication required.');
    const db = database(env, fetchImpl);
    const suffix = path.slice(PRIM3_LEVELS_PREFIX.length), method = request.method;

    if (suffix === '/assets' && method === 'GET') {
      return noStore(request, env, { ok: true, kit: LEVEL_ASSET_KIT, assets: Object.entries(LEVEL_ASSETS).map(([id, entry]) => ({ id, ...entry })) });
    }
    if (suffix === '') {
      if (method === 'GET') {
        const status = url.searchParams.get('status') || 'active';
        const limitText = url.searchParams.get('limit') || '20', offsetText = url.searchParams.get('offset') || '0';
        if (!['active', 'archived', 'all'].includes(status) || !/^\d{1,3}$/.test(limitText) || !/^\d{1,5}$/.test(offsetText)) throw problem(400, 'invalid_query', 'Invalid level-list options.');
        const limit = Number(limitText), offset = Number(offsetText);
        if (limit < 1 || limit > 100 || offset > 10000) throw problem(400, 'invalid_query', 'Invalid level-list bounds.');
        const filter = status === 'all' ? '' : `&archived=eq.${status === 'archived'}`;
        const rows = await db(`prim3_levels?select=${META}${filter}&order=updated_at.desc,id.asc&limit=${limit + 1}&offset=${offset}`);
        if (!Array.isArray(rows)) throw problem(503, 'storage_unavailable', 'Level storage returned an invalid response.');
        return noStore(request, env, { ok: true, levels: rows.slice(0, limit).map(rowView), nextOffset: rows.length > limit ? offset + limit : null });
      }
      if (method === 'POST') {
        const body = await readLevelJson(request); assertMutationBody(body, ['level']);
        const verdict = validateOrThrow(body.level);
        const row = await db('rpc/prim3_level_mutate', { p_action: 'create', p_id: body.level.id, p_actor: user.id, p_document: body.level, p_expected_revision: null });
        return noStore(request, env, { ok: true, level: rowView(row), warnings: verdict.warnings }, 201);
      }
      throw problem(405, 'method_not_allowed', 'Method not allowed.');
    }

    const parts = suffix.slice(1).split('/'), id = parts[0];
    if (!LEVEL_ID.test(id) || parts.length > 3) throw problem(404, 'route_not_found', 'Level route not found.');
    const readLevel = async () => {
      const rows = await db(`prim3_levels?id=eq.${encodeURIComponent(id)}&select=${META},draft&limit=1`);
      if (!Array.isArray(rows)) throw problem(503, 'storage_unavailable', 'Level storage returned an invalid response.');
      if (!rows[0]) throw problem(404, 'level_not_found', 'Level not found.');
      return rows[0];
    };
    if (parts.length === 1 && method === 'GET') return noStore(request, env, { ok: true, level: rowView(await readLevel()) });
    if (parts.length === 1 && method === 'PATCH') {
      const body = await readLevelJson(request); assertMutationBody(body, ['level', 'expectedRevision'], true);
      const verdict = validateOrThrow(body.level);
      if (body.level.id !== id) throw problem(400, 'id_mismatch', 'The document ID must match the requested level.');
      const row = await db('rpc/prim3_level_mutate', { p_action: 'save', p_id: id, p_actor: user.id, p_document: body.level, p_expected_revision: body.expectedRevision });
      return noStore(request, env, { ok: true, level: rowView(row), warnings: verdict.warnings });
    }
    if ((parts.length === 1 && method === 'DELETE') || (parts.length === 2 && ['archive', 'restore'].includes(parts[1]) && method === 'POST')) {
      const body = await readLevelJson(request); assertMutationBody(body, ['expectedRevision'], true);
      const action = parts[1] === 'restore' ? 'restore' : 'archive';
      const row = await db('rpc/prim3_level_mutate', { p_action: action, p_id: id, p_actor: user.id, p_document: null, p_expected_revision: body.expectedRevision });
      return noStore(request, env, { ok: true, level: rowView(row) });
    }
    if (parts.length === 2 && parts[1] === 'publish' && method === 'POST') {
      const body = await readLevelJson(request); assertMutationBody(body, ['expectedRevision'], true);
      const current = await readLevel();
      if (current.archived) throw problem(409, 'level_archived', 'Restore this level before publishing.');
      if (current.revision !== body.expectedRevision) throw problem(409, 'revision_conflict', 'This level changed. Reload it before publishing.');
      validateOrThrow(current.draft);
      const verdict = await validatePlayable(current.draft);
      if (!verdict || verdict.ok !== true) throw problem(422, 'level_not_playable', 'The level is not playable yet.', { errors: verdict?.errors || ['Playability validation did not pass.'] });
      // The RPC compares the same revision under a row lock. A save during validation cannot publish the wrong document.
      const row = await db('rpc/prim3_level_mutate', { p_action: 'publish', p_id: id, p_actor: user.id, p_document: null, p_expected_revision: body.expectedRevision });
      return noStore(request, env, { ok: true, level: rowView(row), warnings: verdict.warnings || [] });
    }
    if (parts[1] === 'versions' && method === 'GET') {
      await readLevel();
      if (parts.length === 2) {
        const rows = await db(`prim3_level_versions?level_id=eq.${encodeURIComponent(id)}&select=level_id,version,source_revision,created_by,created_at&order=version.desc&limit=100`);
        return noStore(request, env, { ok: true, versions: rows });
      }
      if (!/^[1-9]\d{0,9}$/.test(parts[2]) || Number(parts[2]) > 2147483647) throw problem(400, 'invalid_version', 'Invalid snapshot version.');
      const rows = await db(`prim3_level_versions?level_id=eq.${encodeURIComponent(id)}&version=eq.${parts[2]}&select=*&limit=1`);
      if (!rows?.[0]) throw problem(404, 'version_not_found', 'Level version not found.');
      return noStore(request, env, { ok: true, version: rows[0] });
    }
    if (parts.length === 1) throw problem(405, 'method_not_allowed', 'Method not allowed.');
    throw problem(404, 'route_not_found', 'Level route not found.');
  } catch (error) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 503;
    return noStore(request, env, { ok: false, code: error.code || (status === 401 ? 'authentication_required' : status === 403 ? 'owner_required' : 'level_request_failed'), error: status === 503 && !error.code ? 'Level service is unavailable.' : error.message, ...(error.detail ? { detail: error.detail } : {}) }, status);
  }
}
