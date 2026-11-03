// Authored game canon is release data, separate from private resident memory.
// The installed Core tree and the Pages export use this exact source file.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const SOURCE = new URL('../data/fictional-city/district.v1.json', import.meta.url);
const SOURCE_NAME = 'core/data/fictional-city/district.v1.json';
const UNIVERSE = 'mccluster-fictional-city';
const SCHEMA = 'mccluster.fictional-city/v1';
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const SECTIONS = ['manifest', 'brands', 'businesses', 'npcs', 'items', 'portals', 'neighborhoods', 'families', 'parcels'];
const PARCEL = /^[a-z0-9][a-z0-9-]{0,39}\/[a-z0-9][a-z0-9-]{0,39}$/;
const ROUTE_ANCHORS = ['garage', 'hq-bridge', 'hq-doorway'];
const ARGUMENTS = new Set(['universe_id', 'section', 'id', 'business_id', 'offset', 'limit']);

export const GAME_LORE_INPUT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    universe_id: { type: 'string', enum: [UNIVERSE] },
    section: { type: 'string', enum: SECTIONS, default: 'manifest' },
    id: { type: 'string', pattern: ID.source, maxLength: 80 },
    business_id: { type: 'string', pattern: ID.source, maxLength: 80 },
    offset: { type: 'integer', minimum: 0, maximum: 1000 },
    limit: { type: 'integer', minimum: 1, maximum: 24, default: 8 }
  },
  additionalProperties: false
});

function error(message, status = 400, code = 'GAME_LORE_QUERY_INVALID') {
  return Object.assign(new Error(message), { status, code });
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeQuery(args) {
  if (!object(args)) throw error('Game lore arguments must be an object');
  if (Object.keys(args).some((key) => !ARGUMENTS.has(key))) {
    throw error('Unsupported game lore argument');
  }
  if (args.universe_id !== undefined && args.universe_id !== UNIVERSE) {
    throw error('Game lore universe not found', 404, 'GAME_LORE_NOT_FOUND');
  }
  const section = args.section === undefined ? 'manifest' : args.section;
  if (!SECTIONS.includes(section)) throw error('Unsupported game lore section');
  for (const key of ['id', 'business_id']) {
    if (args[key] !== undefined && (typeof args[key] !== 'string' || !ID.test(args[key]))) {
      throw error(`${key} must be a game lore identifier`);
    }
  }
  const offset = args.offset === undefined ? 0 : args.offset;
  const limit = args.limit === undefined ? 8 : args.limit;
  if (!Number.isInteger(offset) || offset < 0 || offset > 1000) {
    throw error('offset must be an integer between 0 and 1000');
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 24) {
    throw error('limit must be an integer between 1 and 24');
  }
  if (section === 'manifest' && ['id', 'business_id', 'offset', 'limit'].some((key) => args[key] !== undefined)) {
    throw error('Manifest queries do not accept entity filters or pagination');
  }
  if (args.business_id !== undefined && !['npcs', 'items'].includes(section)) {
    throw error('business_id filters only NPCs or items');
  }
  if (args.id !== undefined && (args.offset !== undefined || args.limit !== undefined)) {
    throw error('Single-entity queries do not accept pagination');
  }
  return { section, id: args.id, business_id: args.business_id, offset, limit };
}

function invalidManifest() {
  return error('The installed game lore manifest is invalid', 503, 'GAME_LORE_UNAVAILABLE');
}

function collection(rows, max) {
  if (!Array.isArray(rows) || rows.length > max) throw invalidManifest();
  const ids = new Set();
  for (const row of rows) {
    if (!object(row) || typeof row.id !== 'string' || !ID.test(row.id) || ids.has(row.id) ||
        typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200) {
      throw invalidManifest();
    }
    ids.add(row.id);
  }
  return rows;
}

// Exported so build/contract checks can validate the same release bytes. A
// caller of the remote capability cannot replace this source or supply paths.
export function parseGameLore(bytes) {
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes));
  if (raw.length > MAX_SOURCE_BYTES) throw invalidManifest();
  let data;
  try { data = JSON.parse(raw.toString('utf8')); }
  catch { throw invalidManifest(); }
  if (!object(data) || data.schema !== SCHEMA || data.id !== UNIVERSE ||
      typeof data.revision !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.revision) ||
      typeof data.title !== 'string' || !data.title.trim() || data.title.length > 200 ||
      !object(data.district) || !object(data.constraints) || !object(data.garage)) {
    throw invalidManifest();
  }

  if (data.schemaRevision !== undefined && data.schemaRevision !== 1 && data.schemaRevision !== 2) throw invalidManifest();
  const optional = (key) => (data[key] === undefined ? [] : data[key]);
  const brands = collection(data.brands, 64);
  const original = collection(data.businesses, 64);
  const expansionBusinesses = collection(optional('expansionBusinesses'), 64);
  const businesses = collection([...original, data.garage, ...expansionBusinesses], 129);
  const expansionNpcs = collection(optional('expansionNpcs'), 256);
  const npcs = collection([...collection(data.npcs, 256), ...collection(data.garageCrew, 16), ...expansionNpcs], 528);
  const items = collection([...collection(data.items, 256), ...collection(optional('expansionItems'), 256)], 512);
  const portals = collection(data.portals, 32);
  const neighborhoods = collection(optional('neighborhoods'), 32);
  const families = collection(optional('families'), 64);
  const parcels = optional('parcels');
  if (!Array.isArray(parcels) || parcels.length > 256) throw invalidManifest();
  const brandIds = new Set(brands.map((row) => row.id));
  const businessIds = new Set(businesses.map((row) => row.id));
  const familyIds = new Set(families.map((row) => row.id));
  const neighborhoodIds = new Set(neighborhoods.map((row) => row.id));
  const npcById = new Map(npcs.map((row) => [row.id, row]));
  const itemById = new Map(items.map((row) => [row.id, row]));
  const parcelIds = new Set();
  for (const parcel of parcels) {
    if (!object(parcel) || typeof parcel.parcelId !== 'string' || !PARCEL.test(parcel.parcelId) || parcelIds.has(parcel.parcelId) ||
        !neighborhoodIds.has(parcel.neighborhoodId) || parcel.parcelId.split('/')[0] !== parcel.neighborhoodId ||
        (parcel.businessId === undefined) === (parcel.familyId === undefined) ||
        (parcel.businessId !== undefined && !businessIds.has(parcel.businessId)) ||
        (parcel.familyId !== undefined && !familyIds.has(parcel.familyId))) {
      throw invalidManifest();
    }
    parcelIds.add(parcel.parcelId);
  }
  const anchors = new Set([...parcelIds, ...original.map((row) => row.id), ...ROUTE_ANCHORS]);
  const ids = (value) => value === undefined || (Array.isArray(value) && value.every((id) => npcById.has(id)));
  for (const business of businesses) {
    if (business.brandId !== undefined && !brandIds.has(business.brandId)) throw invalidManifest();
    if (!Array.isArray(business.staffIds) || !Array.isArray(business.itemIds)) throw invalidManifest();
    if (business.staffIds.some((id) => npcById.get(id)?.businessId !== business.id) ||
        business.itemIds.some((id) => itemById.get(id)?.businessId !== business.id)) {
      throw invalidManifest();
    }
    if (!ids(business.memberIds) || !ids(business.affiliatedStaffIds) || !ids(business.studentIds) ||
        !ids(business.attendees?.map((row) => row?.npcId))) throw invalidManifest();
    for (const interaction of business.interactions || []) {
      if (!object(interaction) || interaction.type !== 'bribe' || typeof interaction.id !== 'string' || !ID.test(interaction.id) ||
          !Number.isSafeInteger(interaction.price) || interaction.price <= 0 || !ids(interaction.npcIds) ||
          interaction.npcIds.some((id) => npcById.get(id).minor)) throw invalidManifest();
    }
  }
  for (const business of expansionBusinesses) if (!parcelIds.has(business.parcelId)) throw invalidManifest();
  for (const family of families) {
    if (!parcelIds.has(family.parcelId) || !npcById.has(family.representativeNpcId) || !Array.isArray(family.members) ||
        family.members.some((member) => !object(member) || (member.npcId !== undefined && !npcById.has(member.npcId)))) {
      throw invalidManifest();
    }
  }
  if (npcs.some((npc) => !businessIds.has(npc.businessId) && !(npc.businessId === undefined && familyIds.has(npc.familyId))) ||
      items.some((item) => !businessIds.has(item.businessId) || !Number.isSafeInteger(item.price) || item.price < 0)) {
    throw invalidManifest();
  }
  for (const npc of expansionNpcs) {
    // Expansion residents bind to geography by parcel ID only; adults and minors are explicit.
    if (!parcelIds.has(npc.homeParcelId) || !['interior', 'route'].includes(npc.placement) ||
        (npc.placement === 'route' && (!Array.isArray(npc.routeAnchors) || npc.routeAnchors.length < 2 || npc.routeAnchors.some((id) => !anchors.has(id)))) ||
        !Number.isSafeInteger(npc.age) || (npc.age < 18) !== (npc.minor === true) ||
        (npc.familyId !== undefined && !familyIds.has(npc.familyId))) {
      throw invalidManifest();
    }
  }

  return {
    manifest: {
      schema: data.schema,
      id: data.id,
      revision: data.revision,
      title: data.title,
      sha256: createHash('sha256').update(raw).digest('hex'),
      source: SOURCE_NAME
    },
    district: data.district,
    constraints: data.constraints,
    collections: { brands, businesses, npcs, items, portals, neighborhoods, families, parcels },
    counts: {
      brands: brands.length,
      businesses: businesses.length,
      npcs: npcs.length,
      items: items.length,
      portals: portals.length,
      commercial_businesses: data.businesses.length,
      new_npcs: data.npcs.length,
      garage_crew: data.garageCrew.length,
      neighborhoods: neighborhoods.length,
      families: families.length,
      parcels: parcels.length,
      expansion_businesses: expansionBusinesses.length,
      expansion_npcs: expansionNpcs.length,
      expansion_items: items.length - data.items.length
    }
  };
}

function bytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function select(snapshot, query) {
  const { section, id, business_id: businessId, offset, limit } = query;
  const base = { manifest: snapshot.manifest, read_only: true, section };
  if (section === 'manifest') {
    const result = { ...base, counts: snapshot.counts, district: snapshot.district, constraints: snapshot.constraints };
    if (bytes(result) > MAX_RESPONSE_BYTES) throw invalidManifest();
    return result;
  }
  if (businessId !== undefined && !snapshot.collections.businesses.some((row) => row.id === businessId)) {
    throw error('Game lore business not found', 404, 'GAME_LORE_NOT_FOUND');
  }
  let rows = snapshot.collections[section];
  if (businessId !== undefined) rows = rows.filter((row) => row.businessId === businessId);
  if (id !== undefined) {
    rows = rows.filter((row) => row.id === id);
    if (!rows.length) throw error('Game lore entity not found', 404, 'GAME_LORE_NOT_FOUND');
  }
  const result = { ...base, records: [], pagination: { offset, count: 0, total: rows.length, next_offset: null } };
  const candidates = rows.slice(offset, offset + limit);
  for (const row of candidates) {
    result.records.push(row);
    // Reserve enough space for the final count/continuation metadata.
    if (bytes(result) > MAX_RESPONSE_BYTES - 128) {
      result.records.pop();
      if (!result.records.length) throw invalidManifest();
      break;
    }
  }
  result.pagination.count = result.records.length;
  if (offset + result.records.length < rows.length) {
    result.pagination.next_offset = offset + result.records.length;
  }
  return result;
}

export function queryGameLore(snapshot, args = {}) {
  // Return detached data so an in-process reader cannot edit another reader's
  // canon. Responses are bounded before cloning, including complete dialogue.
  return structuredClone(select(snapshot, normalizeQuery(args)));
}

export async function readGameLore(args = {}) {
  const query = normalizeQuery(args);
  let raw;
  try { raw = await readFile(SOURCE); }
  catch { throw error('The game lore manifest is not installed', 503, 'GAME_LORE_UNAVAILABLE'); }
  return select(parseGameLore(raw), query);
}
