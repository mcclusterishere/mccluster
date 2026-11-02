import { LEVEL_ASSETS } from './level-assets.js';
import { createLevelModel } from './level-model.js';

export const LEVEL_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
export const MAX_LEVEL_BYTES = 262144;
export const levelModel = createLevelModel({ assets: Object.entries(LEVEL_ASSETS).map(([id, value]) => ({ id, ...value })) });

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasOnly = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));
const text = (value, max) => typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);

/** The same geometry compiler as the editor, preceded by a closed JSON contract. */
export function validateLevelDocument(value, { playable = false } = {}) {
  const errors = [];
  if (!hasOnly(value, ['schemaVersion', 'id', 'title', 'bounds', 'objects', 'spawns', 'objective', 'extraction', 'connections', 'metadata'])) {
    return { ok: false, errors: ['A level must use the documented JSON fields only.'], warnings: [] };
  }
  if (!hasOnly(value.bounds, ['minX', 'maxX', 'minY', 'maxY'])) errors.push('Unknown map-bound field.');
  if (!hasOnly(value.objective, ['type', 'x', 'y'])) errors.push('Unknown objective field.');
  if (!hasOnly(value.extraction, ['x', 'y', 'radius'])) errors.push('Unknown extraction field.');
  if (!text(value.title, 80)) errors.push('The level title must be plain text of at most 80 characters.');
  if (value.id === 'assets') errors.push('This level ID is reserved.');
  if (!Array.isArray(value.objects) || value.objects.length > 500) errors.push('Use at most 500 objects.');
  else for (const item of value.objects) {
    if (!hasOnly(item, ['id', 'assetId', 'x', 'y', 'rotation', 'elevation', 'scale'])) errors.push('Placed objects cannot carry scripts, URLs, or extra fields.');
    else if (['rotation', 'elevation', 'scale'].some(field => field in item && typeof item[field] !== 'number')) errors.push('Optional object transforms must be numeric when present.');
  }
  if (!Array.isArray(value.spawns) || value.spawns.length > 32) errors.push('Use at most 32 spawns.');
  else for (const spawn of value.spawns) {
    if (!hasOnly(spawn, ['id', 'role', 'team', 'x', 'y', 'layer'])) errors.push('Unknown spawn field.');
    else if ('layer' in spawn && ![0, 1].includes(spawn.layer)) errors.push('Spawn layers must be 0 or 1.');
  }
  if (!Array.isArray(value.connections) || value.connections.length > 64) errors.push('Use at most 64 traversal connections.');
  else {
    const seen = new Set();
    for (const connection of value.connections) {
      if (!hasOnly(connection, ['id', 'type', 'from', 'to', 'cost']) ||
          !hasOnly(connection.from, ['x', 'y', 'layer']) || !hasOnly(connection.to, ['x', 'y', 'layer'])) errors.push('Unknown traversal field.');
      else if (('type' in connection && !['stairs', 'ladder'].includes(connection.type)) ||
          ('cost' in connection && !Number.isInteger(connection.cost)) ||
          [connection.from, connection.to].some(node => 'layer' in node && ![0, 1].includes(node.layer))) errors.push('Invalid traversal type, cost, or layer.');
      if (seen.has(connection?.id)) errors.push('Traversal IDs must be unique.');
      seen.add(connection?.id);
    }
  }
  if (value.metadata !== undefined) {
    const meta = value.metadata;
    if (!hasOnly(meta, ['description', 'theme', 'tags']) ||
        (meta.description !== undefined && !text(meta.description, 1000)) ||
        (meta.theme !== undefined && meta.theme !== 'white-industrial') ||
        (meta.tags !== undefined && (!Array.isArray(meta.tags) || meta.tags.length > 12 || meta.tags.some(tag => !text(tag, 40))))) errors.push('Invalid level metadata.');
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)], warnings: [] };
  return levelModel.validate(value, { playable });
}

/** Read a bounded body even when Content-Length is absent or dishonest. */
export async function readLevelJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    throw Object.assign(new Error('Use application/json.'), { status: 415, code: 'json_required' });
  }
  const claimed = request.headers.get('content-length');
  if (claimed && (!/^\d+$/.test(claimed) || Number(claimed) > MAX_LEVEL_BYTES)) {
    throw Object.assign(new Error('The level request is too large.'), { status: 413, code: 'body_too_large' });
  }
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error('A JSON body is required.'), { status: 400, code: 'invalid_json' });
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_LEVEL_BYTES) {
        await reader.cancel();
        throw Object.assign(new Error('The level request is too large.'), { status: 413, code: 'body_too_large' });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw Object.assign(new Error('The request contains invalid JSON.'), { status: 400, code: 'invalid_json' });
  }
}

export function assertMutationBody(value, keys, needsRevision = false) {
  if (!hasOnly(value, keys)) throw Object.assign(new Error('Unknown request field.'), { status: 400, code: 'invalid_body' });
  if (needsRevision && (!Number.isInteger(value.expectedRevision) || value.expectedRevision < 1 || value.expectedRevision > 2147483646)) {
    throw Object.assign(new Error('A valid expectedRevision is required.'), { status: 428, code: 'revision_required' });
  }
}
