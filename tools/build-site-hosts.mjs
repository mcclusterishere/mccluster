#!/usr/bin/env node
/* ONE PLATFORM, SET IN ONE PLACE (owner, 2026-11-23: "We must prepare without breaking anything to do that").

     node tools/build-site-hosts.mjs --write   # write the three generated outputs from the record
     node tools/build-site-hosts.mjs --check   # fail if any output drifted from the record (CI)
     node tools/build-site-hosts.mjs --scan    # every site-host literal left in code, against the pending lists

   data/seo/domain-architecture.json (v2) names each host once: platform.origin, the tenants, the doors. This
   tool writes what the code reads, and nothing else may name a host:

     workers/mccluster/src/platform/hosts.generated.js   Worker mccluster: the host router's table, the CORS
                                                          list, frame-ancestors, the origins a return may name
     js/shell-boot.js, the block at its very top          the pages: window.MCC_SITE, before any other script
     supabase/functions/_shared/site-hosts.ts             the Supabase functions: return addresses

   All three carry the same table and the same helpers (makeSite), so they cannot disagree. The record's stage
   (edge.now.stage) picks its switches from edge.stages: with P0's, the table describes what is live today
   exactly. A later stage's table is siteTable(record, { stage }) and exists only in tests until that stage
   ships. Making https://equityuprise.com the platform is platform.origin plus the owner's DNS and provider
   steps; scripts/test/site-hosts.test.mjs rehearses that rewrite against the generated table.

   The metadata rewrite of P2 (canonicals, og:url, og:site_name, JSON-LD, sitemaps) is not in this tool. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RECORD = 'data/seo/domain-architecture.json';
export const OUTPUTS = Object.freeze({
  worker: 'workers/mccluster/src/platform/hosts.generated.js',
  client: 'js/shell-boot.js',
  functions: 'supabase/functions/_shared/site-hosts.ts'
});
export const BLOCK_BEGIN = '/* BEGIN GENERATED SITE HOSTS: tools/build-site-hosts.mjs writes this block from data/seo/domain-architecture.json. Do not edit it by hand. */';
export const BLOCK_END = '/* END GENERATED SITE HOSTS */';
const SCHEMA = 'mccluster-site-hosts/v1';
const SETS = ['platform', 'profile', 'profile_only'];

/* ---------- the record, read and checked ---------- */

export function readRecord(root = ROOT) {
  return JSON.parse(readFileSync(join(root, RECORD), 'utf8'));
}

function fail(message) {
  throw new Error(`build-site-hosts: ${message}`);
}
function originOf(value, where) {
  let u;
  try { u = new URL(String(value)); } catch { fail(`${where} is not a URL: ${value}`); }
  if (u.protocol !== 'https:' || u.origin !== String(value)) fail(`${where} must be a bare https origin, got ${value}`);
  return u.origin;
}
function hostOf(origin) {
  return new URL(origin).hostname;
}
function paths(list, where) {
  if (!Array.isArray(list)) fail(`${where} must be a list`);
  for (const p of list) if (typeof p !== 'string' || p.charAt(0) !== '/') fail(`${where}: "${p}" is not a path`);
  if (new Set(list).size !== list.length) fail(`${where} repeats a path`);
  return [...list];
}
function ownPaths(own, where) {
  return { generated: paths((own && own.generated) || [], `${where}.generated`), subtrees: paths((own && own.subtrees) || [], `${where}.subtrees`) };
}

/* The record, reduced to the one table the code reads. Pure: the same record gives the same table. */
export function siteTable(record, { stage } = {}) {
  if (!record || record.schema_version !== 'mccluster-domain-architecture/v2') fail('the record is not mccluster-domain-architecture/v2');
  const stageName = stage || (record.edge && record.edge.now && record.edge.now.stage);
  const stageRow = ((record.edge && record.edge.stages) || []).find((s) => s.stage === stageName);
  if (!stageRow || !stageRow.switches) fail(`edge.stages has no switches for stage "${stageName}"`);
  const sw = stageRow.switches;
  if (!['world', 'everything'].includes(sw.platform_serves)) fail(`stage ${stageName}: platform_serves must be world or everything`);

  const P = record.platform || fail('no platform');
  const platformOrigin = originOf(P.origin, 'platform.origin');
  const world = record.world || fail('no world');
  const platform = {
    origin: platformOrigin,
    host: hostOf(platformOrigin),
    website_id: String(P.website_id),
    site_name: String(P.site_name),
    operator_id: String(P.operator),
    front_door_path: String(P.front_door_path),
    app_start_path: paths([P.app_start_path], 'platform.app_start_path')[0],
    world_url: platformOrigin + String(world.root),
    static_origin: originOf(P.static_origin, 'platform.static_origin'),
    own_paths: ownPaths(P.own_paths, 'platform.own_paths')
  };

  const tenants = Object.entries(record.tenants || {}).map(([key, x]) => {
    const origin = originOf(`https://${x.host}`, `tenants.${key}.host`);
    return {
      key,
      host: hostOf(origin),
      origin,
      entity_id: String(x.entity),
      website_id: String(x.website_id),
      site_name: String(x.site_name),
      root_path: '/',
      carry_path: x.carry ? String(x.carry) : null,
      sets: (x.sets || []).map(String),
      own_paths: ownPaths(x.own_paths, `tenants.${key}.own_paths`)
    };
  });
  const profiles = tenants.filter((x) => x.sets.includes('profile'));
  if (profiles.length !== 1 || !profiles[0].sets.includes('profile_only')) fail('exactly one tenant holds the profile and profile_only sets');
  const profile = profiles[0];
  const hosts = [platform.host, ...tenants.map((x) => x.host)];
  if (new Set(hosts).size !== hosts.length) fail('a host is both the platform and a tenant, or two tenants');

  const targetOrigin = (to, where) => {
    if (to === 'platform') return platform.origin;
    const m = /^tenants\.(.+)$/.exec(String(to));
    const x = m && tenants.find((y) => y.key === m[1]);
    if (!x) fail(`${where}: "${to}" is neither platform nor a tenant`);
    return x.origin;
  };
  const doors = Object.entries(record.doors || {}).map(([host, d]) => {
    const origin = originOf(`https://${host}`, `doors["${host}"]`);
    if (hosts.includes(hostOf(origin))) fail(`doors["${host}"] is also the platform or a tenant`);
    if (!['worker:mccluster', 'cloudflare-zone-redirect-rule'].includes(d.served_by)) fail(`doors["${host}"].served_by is unknown: ${d.served_by}`);
    return { host: hostOf(origin), origin, to: String(d.to), to_origin: targetOrigin(d.to, `doors["${host}"].to`), served_by: d.served_by, state: String(d.state), api_cors: d.api_cors === true };
  });
  const workerDoors = doors.filter((d) => d.served_by === 'worker:mccluster');

  /* the lists, each in the order today's code names them */
  const worldHosts = [platform.host, ...workerDoors.filter((d) => d.to === 'platform').map((d) => d.host)];
  const siteOrigins = [...tenants.map((x) => x.origin), platform.origin, ...workerDoors.map((d) => d.origin)];
  const corsOrigins = [...tenants.map((x) => x.origin), platform.origin, ...doors.filter((d) => d.api_cors).map((d) => d.origin)];
  const returnOrigins = [platform.origin, ...tenants.map((x) => x.origin)];
  const fallback = sw.returns_fallback === 'platform' ? platform.origin : targetOrigin(sw.returns_fallback, `edge.stages[${stageName}].switches.returns_fallback`);
  const labels = profile.host.split('.');

  const own = record.url_ownership || fail('no url_ownership');
  const pages = {};
  const seen = new Map();
  for (const set of SETS) {
    pages[set] = paths(own[set], `url_ownership.${set}`).sort();
    for (const p of pages[set]) {
      if (seen.has(p)) fail(`${p} is in url_ownership.${seen.get(p)} and url_ownership.${set}`);
      seen.set(p, set);
    }
  }
  const promoted = (own.promoted_at_deploy || []).map((d, i) => {
    if (!SETS.includes(d.set)) fail(`url_ownership.promoted_at_deploy[${i}].set is not a set`);
    return { prefix: paths([d.path], `url_ownership.promoted_at_deploy[${i}].path`)[0], set: d.set };
  });
  const both = paths(record.both_hosts, 'both_hosts');
  const entity = (key) => (record.entities && record.entities[key]) || fail(`entities.${key} is missing`);

  return {
    schema: SCHEMA,
    record: record.schema_version,
    stage: stageRow.stage,
    switches: {
      platform_serves: sw.platform_serves,
      profile_host_routed: sw.profile_host_routed === true,
      carry: sw.carry === true,
      returns_fallback: String(sw.returns_fallback),
      metadata: String(sw.metadata)
    },
    platform,
    profile,
    tenants,
    doors,
    world_hosts: worldHosts,
    world_origins: worldHosts.map((h) => `https://${h}`),
    site_origins: siteOrigins,
    site_hosts: siteOrigins.map(hostOf),
    frame_ancestors: ["'self'", ...siteOrigins],
    cors_origins: corsOrigins,
    return_origins: returnOrigins,
    return_fallback_origin: fallback,
    cookie_domain: labels.length > 2 ? labels.slice(1).join('.') : profile.host,
    ids: {
      person: String(entity('matthew_mccluster').id),
      organization: String(entity('mccluster_corp').id),
      platform_website: platform.website_id,
      profile_website: profile.website_id
    },
    entity_urls: {
      person: String(entity('matthew_mccluster').url),
      organization: String(entity('mccluster_corp').url)
    },
    world: {
      document: String(world.document),
      root: String(world.root),
      query_keys: (world.query_keys || []).map(String),
      rooms: paths(world.rooms, 'world.rooms'),
      room_prefixes: paths(world.room_prefixes, 'world.room_prefixes')
    },
    both_hosts: { paths: both.filter((p) => !p.endsWith('/')), prefixes: both.filter((p) => p.endsWith('/')) },
    pages,
    promoted
  };
}

/* ---------- the helpers, one source rendered for JavaScript and for TypeScript ---------- */

/* Each output gets this function verbatim (types only in the TypeScript one), so the Worker, the pages and the
   functions answer every question the same way. ty() inserts a TypeScript annotation and nothing in JavaScript.
   The body uses no template literals and no regular expressions, so it can sit in this template unescaped. */
function makeSiteSource(ts) {
  const ty = (s) => (ts ? s : '');
  return `function makeSite(t${ty(': SiteTable')})${ty(': Site')} {
  const sets${ty(': Record<string, PageSet>')} = {};
  for (const name of SETS) for (const p of t.pages[name]) sets[p] = name;
  /* the path alone: no query, no fragment, a leading slash, a directory's index.html folded into the directory */
  function cleanPath(path${ty(': unknown')})${ty(': string')} {
    let p = String(path == null ? '' : path);
    let cut = p.length;
    const q = p.indexOf('?');
    const h = p.indexOf('#');
    if (q !== -1 && q < cut) cut = q;
    if (h !== -1 && h < cut) cut = h;
    p = p.slice(0, cut);
    if (p.charAt(0) !== '/') p = '/' + p;
    if (p.slice(-11) === '/index.html') p = p.slice(0, -10);
    return p;
  }
  function underAny(p${ty(': string')}, prefixes${ty(': readonly string[]')})${ty(': boolean')} {
    return prefixes.some((x) => p.indexOf(x) === 0);
  }
  function inOwn(p${ty(': string')}, own${ty(': SiteOwnPaths')})${ty(': boolean')} {
    return own.generated.indexOf(p) !== -1 || own.subtrees.some((r) => p === r || p.indexOf(r + '/') === 0);
  }
  /* a page address: a directory or an .html file */
  function isPageLike(path${ty(': unknown')})${ty(': boolean')} {
    const p = cleanPath(path);
    return p.slice(-1) === '/' || p.slice(-5) === '.html';
  }
  /* the record's set for a published page (url_ownership), or null for anything it does not classify */
  function pageSet(path${ty(': unknown')})${ty(': PageSet | null')} {
    const p = cleanPath(path);
    if (Object.prototype.hasOwnProperty.call(sets, p)) return sets[p];
    for (const d of t.promoted) if (p.indexOf(d.prefix) === 0) return d.set;
    return null;
  }
  /* a path a host answers itself (the company page, crawler files, the news): that host's origin, else null */
  function ownPathOrigin(path${ty(': unknown')})${ty(': string | null')} {
    const p = cleanPath(path);
    if (inOwn(p, t.platform.own_paths)) return t.platform.origin;
    for (const x of t.tenants) if (inOwn(p, x.own_paths)) return x.origin;
    return null;
  }
  function isOwnPath(path${ty(': unknown')})${ty(': boolean')} {
    return ownPathOrigin(path) !== null;
  }
  /* the World and the rooms it opens, which the platform serves from the static origin today */
  function isWorldRoom(path${ty(': unknown')})${ty(': boolean')} {
    const p = cleanPath(path);
    return t.world.rooms.indexOf(p) !== -1 || underAny(p, t.world.room_prefixes);
  }
  /* answered on the platform and on the profile host alike, never redirected */
  function isBothHosts(path${ty(': unknown')})${ty(': boolean')} {
    const p = cleanPath(path);
    return t.both_hosts.paths.indexOf(p) !== -1 || underAny(p, t.both_hosts.prefixes);
  }
  /* where the page lives: the origin its canonical names (stage-independent); null when unclassified */
  function homeOrigin(path${ty(': unknown')})${ty(': string | null')} {
    const own = ownPathOrigin(path);
    if (own) return own;
    const set = pageSet(path);
    if (set === 'platform') return t.platform.origin;
    if (set === 'profile' || set === 'profile_only') return t.profile.origin;
    return null;
  }
  /* where an absolute link to the path lands on a 200 in one hop at this stage */
  function servingOrigin(path${ty(': unknown')})${ty(': string')} {
    const own = ownPathOrigin(path);
    if (own) return own;
    if (t.switches.platform_serves === 'everything') return pageSet(path) === 'profile_only' ? t.profile.origin : t.platform.origin;
    return isWorldRoom(path) ? t.platform.origin : t.profile.origin;
  }
  /* the absolute address of a path (query and fragment kept) at this stage */
  function siteUrl(path${ty(': unknown')})${ty(': string')} {
    const raw = String(path == null ? '' : path);
    const rel = raw.charAt(0) === '/' ? raw : '/' + raw;
    return servingOrigin(rel) + rel;
  }
  /* a checkout or account return goes back where it started when that origin serves pages; else the fallback */
  function returnOrigin(origin${ty(': unknown')})${ty(': string')} {
    const o = String(origin == null ? '' : origin);
    return t.return_origins.indexOf(o) !== -1 ? o : t.return_fallback_origin;
  }
  function isWorldHost(host${ty(': unknown')})${ty(': boolean')} {
    return t.world_hosts.indexOf(String(host == null ? '' : host).toLowerCase()) !== -1;
  }
  function isSiteOrigin(origin${ty(': unknown')})${ty(': boolean')} {
    return t.site_origins.indexOf(String(origin == null ? '' : origin)) !== -1;
  }
  /* what a request's host is to the router: the platform, a tenant, a door, or none of the site's (null) */
  function hostRole(host${ty(': unknown')})${ty(': HostRole | null')} {
    const h = String(host == null ? '' : host).toLowerCase();
    if (h === t.platform.host) return { role: 'platform', host: h, origin: t.platform.origin };
    for (const x of t.tenants) if (h === x.host) return { role: 'tenant', host: h, origin: x.origin, key: x.key };
    for (const d of t.doors) if (h === d.host) return { role: 'door', host: h, origin: d.origin, to: d.to, to_origin: d.to_origin, served_by: d.served_by };
    return null;
  }
  return Object.freeze(Object.assign({}, t, {
    cleanPath, isPageLike, pageSet, ownPathOrigin, isOwnPath, isWorldRoom, isBothHosts,
    homeOrigin, servingOrigin, siteUrl, returnOrigin, isWorldHost, isSiteOrigin, hostRole
  }));
}`;
}

function deepFreezeSource(ts) {
  return ts
    ? `function deepFreeze<V>(value: V): V {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const k of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[k]);
  }
  return value;
}`
    : `function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const k of Object.keys(value)) deepFreeze(value[k]);
  }
  return value;
}`;
}

/* the named exports the Worker and the functions import (the pages read the same names off window.MCC_SITE) */
const NAMED = [
  ['STAGE', 'stage', 'string'],
  ['SWITCHES', 'switches', 'SiteSwitches'],
  ['PLATFORM_ORIGIN', 'platform.origin', 'string'],
  ['PLATFORM_HOST', 'platform.host', 'string'],
  ['WORLD_URL', 'platform.world_url', 'string'],
  ['STATIC_ORIGIN', 'platform.static_origin', 'string'],
  ['PROFILE_ORIGIN', 'profile.origin', 'string'],
  ['PROFILE_HOST', 'profile.host', 'string'],
  ['TENANTS', 'tenants', 'readonly SiteTenant[]'],
  ['DOORS', 'doors', 'readonly SiteDoor[]'],
  ['WORLD_HOSTS', 'world_hosts', 'readonly string[]'],
  ['WORLD_ORIGINS', 'world_origins', 'readonly string[]'],
  ['SITE_ORIGINS', 'site_origins', 'readonly string[]'],
  ['SITE_HOSTS', 'site_hosts', 'readonly string[]'],
  ['FRAME_ANCESTORS', 'frame_ancestors', 'readonly string[]'],
  ['CORS_ORIGINS', 'cors_origins', 'readonly string[]'],
  ['RETURN_ORIGINS', 'return_origins', 'readonly string[]'],
  ['RETURN_FALLBACK_ORIGIN', 'return_fallback_origin', 'string'],
  ['COOKIE_DOMAIN', 'cookie_domain', 'string'],
  ['IDS', 'ids', 'SiteIds'],
  ['ENTITY_URLS', 'entity_urls', 'SiteEntityUrls'],
  ['WORLD_ROOMS', 'world.rooms', 'readonly string[]'],
  ['WORLD_PREFIXES', 'world.room_prefixes', 'readonly string[]'],
  ['WORLD_QUERY_KEYS', 'world.query_keys', 'readonly string[]'],
  ['BOTH_HOSTS', 'both_hosts', 'SiteBothHosts']
];
const HELPERS = ['cleanPath', 'isPageLike', 'pageSet', 'ownPathOrigin', 'isOwnPath', 'isWorldRoom', 'isBothHosts',
  'homeOrigin', 'servingOrigin', 'siteUrl', 'returnOrigin', 'isWorldHost', 'isSiteOrigin', 'hostRole'];
export const EXPORTS = Object.freeze({ table: 'SITE_TABLE', site: 'SITE', factory: 'makeSite', named: NAMED.map(([n]) => n), helpers: [...HELPERS] });

const TS_TYPES = `export type PageSet = 'platform' | 'profile' | 'profile_only';
export interface SiteOwnPaths { readonly generated: readonly string[]; readonly subtrees: readonly string[] }
export interface SiteSwitches { readonly platform_serves: string; readonly profile_host_routed: boolean; readonly carry: boolean; readonly returns_fallback: string; readonly metadata: string }
export interface SitePlatform { readonly origin: string; readonly host: string; readonly website_id: string; readonly site_name: string; readonly operator_id: string; readonly front_door_path: string; readonly app_start_path: string; readonly world_url: string; readonly static_origin: string; readonly own_paths: SiteOwnPaths }
export interface SiteTenant { readonly key: string; readonly host: string; readonly origin: string; readonly entity_id: string; readonly website_id: string; readonly site_name: string; readonly root_path: string; readonly carry_path: string | null; readonly sets: readonly string[]; readonly own_paths: SiteOwnPaths }
export interface SiteDoor { readonly host: string; readonly origin: string; readonly to: string; readonly to_origin: string; readonly served_by: string; readonly state: string; readonly api_cors: boolean }
export interface SiteIds { readonly person: string; readonly organization: string; readonly platform_website: string; readonly profile_website: string }
export interface SiteEntityUrls { readonly person: string; readonly organization: string }
export interface SiteWorld { readonly document: string; readonly root: string; readonly query_keys: readonly string[]; readonly rooms: readonly string[]; readonly room_prefixes: readonly string[] }
export interface SiteBothHosts { readonly paths: readonly string[]; readonly prefixes: readonly string[] }
export interface SitePages { readonly platform: readonly string[]; readonly profile: readonly string[]; readonly profile_only: readonly string[] }
export interface SiteTable {
  readonly schema: string; readonly record: string; readonly stage: string; readonly switches: SiteSwitches;
  readonly platform: SitePlatform; readonly profile: SiteTenant; readonly tenants: readonly SiteTenant[]; readonly doors: readonly SiteDoor[];
  readonly world_hosts: readonly string[]; readonly world_origins: readonly string[]; readonly site_origins: readonly string[]; readonly site_hosts: readonly string[];
  readonly frame_ancestors: readonly string[]; readonly cors_origins: readonly string[]; readonly return_origins: readonly string[]; readonly return_fallback_origin: string;
  readonly cookie_domain: string; readonly ids: SiteIds; readonly entity_urls: SiteEntityUrls; readonly world: SiteWorld; readonly both_hosts: SiteBothHosts;
  readonly pages: SitePages; readonly promoted: readonly { readonly prefix: string; readonly set: PageSet }[];
}
export interface HostRole { readonly role: 'platform' | 'tenant' | 'door'; readonly host: string; readonly origin: string; readonly key?: string; readonly to?: string; readonly to_origin?: string; readonly served_by?: string }
export interface Site extends SiteTable {
  cleanPath(path: unknown): string; isPageLike(path: unknown): boolean; pageSet(path: unknown): PageSet | null;
  ownPathOrigin(path: unknown): string | null; isOwnPath(path: unknown): boolean; isWorldRoom(path: unknown): boolean; isBothHosts(path: unknown): boolean;
  homeOrigin(path: unknown): string | null; servingOrigin(path: unknown): string; siteUrl(path: unknown): string; returnOrigin(origin: unknown): string;
  isWorldHost(host: unknown): boolean; isSiteOrigin(origin: unknown): boolean; hostRole(host: unknown): HostRole | null;
}`;

/* ---------- the three outputs ---------- */

const json = (v) => JSON.stringify(v, null, 2);
/* one top-level key per line, each value compact: a short block at the top of every page, readable in a diff */
function compact(table) {
  return '{\n' + Object.entries(table).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n  }';
}
function header(audience) {
  return `/* GENERATED by tools/build-site-hosts.mjs from data/seo/domain-architecture.json. Do not edit by hand:
   change the record, then run \`node tools/build-site-hosts.mjs --write\`; CI runs --check and fails on drift.

   ${audience}
   One table and one set of helpers (makeSite), the same in the Worker, on the pages (window.MCC_SITE) and in
   the Supabase functions. The table's stage (the record's edge.now) says what each host serves now. */`;
}

export function renderWorker(table) {
  const named = NAMED.map(([name, path]) => `export const ${name} = SITE_TABLE.${path};`).join('\n');
  return `${header('Worker mccluster reads its hosts here: the host router, the CORS list, frame-ancestors and the\n   origins a checkout or account return may name.')}
const SETS = ${JSON.stringify(SETS)};

${deepFreezeSource(false)}

export ${makeSiteSource(false)}

export const SITE_TABLE = deepFreeze(${json(table)});

export const SITE = makeSite(SITE_TABLE);
${named}
export const { ${HELPERS.join(', ')} } = SITE;
`;
}

export function renderFunctions(table) {
  const named = NAMED.map(([name, path, type]) => `export const ${name}: ${type} = SITE_TABLE.${path};`).join('\n');
  return `${header('The Supabase functions read their hosts here: the address a checkout or account return names\n   follows the request (returnOrigin), and nothing else names a host.')}
${TS_TYPES}

const SETS: readonly PageSet[] = ${JSON.stringify(SETS)};

${deepFreezeSource(true)}

export ${makeSiteSource(true)}

export const SITE_TABLE: SiteTable = deepFreeze<SiteTable>(${json(table)});

export const SITE: Site = makeSite(SITE_TABLE);
${named}
export const { ${HELPERS.join(', ')} } = SITE;
`;
}

export function renderClientBlock(table) {
  /* the same helpers without their explanatory comments (they are in the Worker's copy): this runs first on every page */
  const body = makeSiteSource(false).split('\n').filter((l) => !/^\s*\/\*.*\*\/\s*$/.test(l)).map((l) => (l ? '  ' + l : l)).join('\n');
  const freeze = deepFreezeSource(false).split('\n').map((l) => (l ? '  ' + l : l)).join('\n');
  return `${BLOCK_BEGIN}
/* window.MCC_SITE: where the platform and Matthew's profile are, which hosts serve the World, and where a path
   lives and is served at this stage (the helpers of workers/mccluster/src/platform/hosts.generated.js, the
   same table). Frozen. Read it, never write a host into a page script. */
(function (w) {
  'use strict';
  const SETS = ${JSON.stringify(SETS)};
${freeze}
${body}
  w.MCC_SITE = makeSite(deepFreeze(${compact(table)}));
})(typeof window !== 'undefined' ? window : this);
${BLOCK_END}
`;
}

/* the generated block inside js/shell-boot.js: where it is, or null when the markers are missing or broken */
export function findClientBlock(source) {
  const start = source.indexOf(BLOCK_BEGIN);
  if (start === -1) return null;
  const endAt = source.indexOf(BLOCK_END, start);
  if (endAt === -1) return null;
  let end = endAt + BLOCK_END.length;
  if (source.charAt(end) === '\n') end += 1;
  return { start, end, text: source.slice(start, end) };
}
/* js/shell-boot.js with the block at its very top, everything after it untouched */
export function spliceClientBlock(source, block) {
  const found = findClientBlock(source);
  const rest = found ? source.slice(0, found.start) + source.slice(found.end) : source;
  return block + rest;
}
/* js/shell-boot.js without the block, for the host-literal scan */
export function withoutClientBlock(source) {
  const found = findClientBlock(source);
  return found ? source.slice(0, found.start) + source.slice(found.end) : source;
}

/* every output path and the exact text it must hold for this record */
export function expectedOutputs(record, root = ROOT) {
  const table = siteTable(record);
  const clientPath = join(root, OUTPUTS.client);
  const client = existsSync(clientPath) ? readFileSync(clientPath, 'utf8') : '';
  return {
    [OUTPUTS.worker]: renderWorker(table),
    [OUTPUTS.client]: spliceClientBlock(client, renderClientBlock(table)),
    [OUTPUTS.functions]: renderFunctions(table)
  };
}

export function drift(root = ROOT) {
  const want = expectedOutputs(readRecord(root), root);
  return Object.entries(want).filter(([rel, text]) => {
    const file = join(root, rel);
    return !existsSync(file) || readFileSync(file, 'utf8') !== text;
  }).map(([rel]) => rel);
}

export function write(root = ROOT) {
  const want = expectedOutputs(readRecord(root), root);
  const written = [];
  for (const [rel, text] of Object.entries(want)) {
    const file = join(root, rel);
    if (existsSync(file) && readFileSync(file, 'utf8') === text) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    written.push(rel);
  }
  return written;
}

/* ---------- host literals left in code ---------- */

export const SCAN_ROOTS = Object.freeze(['js', 'workers/mccluster/src', 'supabase/functions']);
const SCAN_EXT = /\.(?:m?js|cjs|ts|mts|json|html)$/;
/* A site host in code: matthew./www./here. or the bare mccluster.org (never api., mcp. or another subdomain, never an
   e-mail domain), humanuprise.com and equityuprise.com with or without www, a regular expression's escaped form,
   a leading-dot or wildcard suffix, and the dead repository's address mcclusterishere.github.io/Here. */
export const HOST_LITERAL = /(?<![\w.@\\-])(?:(?:www|here|matthew)\\?\.|\*?\\?\.)?mccluster\\?\.org(?![\w-])|(?<![\w.@\\-])(?:www\\?\.|\*?\\?\.)?(?:humanuprise|equityuprise)\\?\.com(?![\w-])|mcclusterishere\\?\.github\\?\.io\/Here(?![\w-])/gi;

const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
/* JavaScript or TypeScript with its comments blanked (newlines kept); strings, template text and regular
   expressions stay, because a host there is code. */
export function stripJsComments(src) {
  const n = src.length;
  let out = '';
  let i = 0;
  let depth = 0;
  const templates = [];
  let prev = '';
  let word = '';
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  function template() {
    while (i < n) {
      const ch = src[i];
      if (ch === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
      if (ch === '`') { out += ch; i += 1; prev = '`'; word = ''; return; }
      if (ch === '$' && src[i + 1] === '{') { out += '${'; i += 2; depth += 1; templates.push(depth); prev = '{'; word = ''; return; }
      out += ch; i += 1;
    }
  }
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { let j = i; while (j < n && src[j] !== '\n') j += 1; out += blank(src.slice(i, j)); i = j; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const j = e === -1 ? n : e + 2; out += blank(src.slice(i, j)); i = j; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1); i = j + 1; prev = c; word = ''; continue;
    }
    if (c === '`') { out += c; i += 1; template(); continue; }
    if (c === '{') { depth += 1; out += c; i += 1; prev = c; word = ''; continue; }
    if (c === '}') {
      if (templates.length && templates[templates.length - 1] === depth) { templates.pop(); depth -= 1; out += c; i += 1; template(); continue; }
      depth -= 1; out += c; i += 1; prev = c; word = ''; continue;
    }
    if (c === '/') {
      const regex = !prev || KEYWORDS_BEFORE_REGEX.has(word) || !/[\w$)\]]/.test(prev);
      if (regex) {
        let j = i + 1;
        let cls = false;
        while (j < n && src[j] !== '\n') {
          const ch = src[j];
          if (ch === '\\') { j += 2; continue; }
          if (cls) { if (ch === ']') cls = false; } else if (ch === '[') cls = true; else if (ch === '/') break;
          j += 1;
        }
        j += 1;
        while (j < n && /[a-z]/i.test(src[j])) j += 1;
        out += src.slice(i, j); i = j; prev = '/'; word = ''; continue;
      }
      out += c; i += 1; prev = c; word = ''; continue;
    }
    if (/\s/.test(c)) { out += c; i += 1; continue; }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j += 1;
      word = src.slice(i, j); out += word; prev = word.charAt(word.length - 1); i = j; continue;
    }
    out += c; i += 1; prev = c; word = '';
  }
  return out;
}
/* HTML with its comments blanked, and the comments of its inline scripts */
export function stripHtmlComments(src) {
  let out = '';
  let i = 0;
  const re = /<!--[\s\S]*?-->|(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi;
  let m;
  while ((m = re.exec(src))) {
    out += src.slice(i, m.index);
    out += m[1] ? m[1] + stripJsComments(m[2]) + m[3] : m[0].replace(/[^\n]/g, ' ');
    i = re.lastIndex;
  }
  return out + src.slice(i);
}
export function codeOf(text, file) {
  if (/\.json$/.test(file)) return text;
  if (/\.html$/.test(file)) return stripHtmlComments(text);
  return stripJsComments(text);
}
export function hostLiterals(text, file = 'x.js') {
  return codeOf(text, file).match(new RegExp(HOST_LITERAL.source, HOST_LITERAL.flags)) || [];
}

function walk(root, rel, out) {
  const dir = join(root, rel);
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) walk(root, child, out);
    else if (e.isFile() && SCAN_EXT.test(e.name)) out.push(child);
  }
  return out;
}
/* every scanned file that names a site host in code, outside the generated outputs, with its count */
export function scanHostLiterals(root = ROOT) {
  const rows = [];
  for (const top of SCAN_ROOTS) {
    for (const file of walk(root, top, [])) {
      if (file === OUTPUTS.worker || file === OUTPUTS.functions) continue;
      let text = readFileSync(join(root, file), 'utf8');
      if (file === OUTPUTS.client) text = withoutClientBlock(text);
      const found = hostLiterals(text, file);
      if (found.length) rows.push({ file, count: found.length });
    }
  }
  return rows.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/* ---------- the pending lists: who converts which file, and when ---------- */

export const PENDING_DIR = 'scripts/test/site-hosts-pending';
export const LANES = Object.freeze({
  worker: { list: `${PENDING_DIR}/worker.json`, scope: 'workers/mccluster/src/' },
  functions: { list: `${PENDING_DIR}/functions.json`, scope: 'supabase/functions/' },
  client: { list: `${PENDING_DIR}/client.json`, scope: 'js/' },
  engine: { list: `${PENDING_DIR}/engine.json`, scope: 'js/' }
});
export const STAGE_NAMES = /^(?:P[0-4]|F|engine stage [0-4])$/;

/* THE CEILING: the four lists as they stand (P0 built them on 2026-11-23 with 7 files and 112 host literals in code; P1
   converted the engine's three files and took them off). A list names no file outside this table and allows no file
   more than its count here, and every list allows exactly what the scan finds, so a literal removed is a count lowered
   in the same change and freed room is never refilled. The ceiling follows the lists down: a count lowered on a list is
   lowered here in the same change, and a file that leaves its list leaves this table, or a later edit could raise the
   list back up to it. Nothing raises a number here; scripts/test/site-hosts.test.mjs pins the same table, so it cannot be
   raised in one place. */
export const PENDING_CEILING = Object.freeze({
  'js/live-content.js': 1,
  'js/mcc-auth.js': 1,
  'workers/mccluster/src/company-site/pages.generated.js': 86,
  'workers/mccluster/src/seek-first/console.html': 3
});

export function readPending(root = ROOT) {
  const lanes = {};
  for (const [lane, { list }] of Object.entries(LANES)) lanes[lane] = JSON.parse(readFileSync(join(root, list), 'utf8'));
  return lanes;
}

/* Every way the code and the lists disagree, as plain sentences (empty when they agree). The lists only
   shrink: an unlisted file may not name a host; a list never names a file the ceiling does not, nor allows more than
   the ceiling; a listed file names exactly as many hosts as its list allows (no more: a regression; no fewer: lower
   the count now); a file that no longer names one leaves its list; and the ceiling is exactly the lists. */
export function pendingProblems(rows = scanHostLiterals(), lanes = readPending(), ceiling = PENDING_CEILING) {
  const problems = [];
  const listed = new Map();
  const engineOwned = new Set(((lanes.engine && lanes.engine.owned_files) || []).map(String));
  const cap = (file) => (Object.prototype.hasOwnProperty.call(ceiling, file) ? ceiling[file] : null);
  for (const [lane, data] of Object.entries(lanes)) {
    for (const entry of (data && data.files) || []) {
      const where = `${LANES[lane].list}: ${entry.file}`;
      if (listed.has(entry.file)) problems.push(`${where} is also listed in ${LANES[listed.get(entry.file)].list}`);
      listed.set(entry.file, lane);
      if (!String(entry.file).startsWith(LANES[lane].scope)) problems.push(`${where} is outside ${LANES[lane].scope}`);
      if (lane === 'engine' && !engineOwned.has(entry.file)) problems.push(`${where} is not an engine-owned file (engine.json owned_files)`);
      if (lane === 'client' && engineOwned.has(entry.file)) problems.push(`${where} is engine-owned: it belongs in ${LANES.engine.list}`);
      if (!Number.isInteger(entry.count) || entry.count < 1) problems.push(`${where} needs a whole count of 1 or more`);
      if (!STAGE_NAMES.test(String(entry.stage || ''))) problems.push(`${where} needs the stage that converts it (P0..P4, F or "engine stage N"), got "${entry.stage}"`);
      if (cap(entry.file) === null) problems.push(`${where} is not on the ceiling (PENDING_CEILING: the lists as P0 built them, lowered with every conversion): the lists only shrink, so a new file reads its hosts from the generated outputs instead`);
      else if (Number.isInteger(entry.count) && entry.count > cap(entry.file)) problems.push(`${where} allows ${entry.count}, more than the ${cap(entry.file)} the ceiling allows (PENDING_CEILING): the lists only shrink`);
    }
  }
  const found = new Map(rows.map((r) => [r.file, r.count]));
  for (const { file, count } of rows) {
    if (!listed.has(file)) { problems.push(`${file} names a site host ${count} time(s) and is on no pending list: read it from the generated outputs instead (tools/build-site-hosts.mjs)`); continue; }
    const entry = lanes[listed.get(file)].files.find((e) => e.file === file);
    if (count > entry.count) problems.push(`${file} names a site host ${count} time(s), more than the ${entry.count} its list allows: the list only shrinks`);
    else if (count < entry.count) problems.push(`${file} names a site host ${count} time(s) and ${LANES[listed.get(file)].list} still allows ${entry.count}: lower it to ${count} in the same change (the list only shrinks; freed room is never refilled)`);
  }
  for (const [file, lane] of listed) {
    if (!found.has(file)) problems.push(`${file} no longer names a site host: remove it from ${LANES[lane].list}`);
  }
  /* the ceiling follows the lists down (V-1 of the P0 verification) */
  for (const [file, cap] of Object.entries(ceiling)) {
    const lane = listed.get(file);
    const entry = lane ? lanes[lane].files.find((e) => e.file === file) : null;
    if (!entry) problems.push(`PENDING_CEILING still names ${file}, which no list names any more: drop it from the ceiling in the same change (tools/build-site-hosts.mjs and scripts/test/site-hosts.test.mjs)`);
    else if (Number.isInteger(entry.count) && entry.count < cap) problems.push(`PENDING_CEILING still allows ${cap} for ${file}, and ${LANES[lane].list} now allows ${entry.count}: lower the ceiling in the same change (tools/build-site-hosts.mjs and scripts/test/site-hosts.test.mjs), or a later edit could raise the list back up to it`);
  }
  return problems;
}

/* ---------- the command ---------- */

function main(argv) {
  const mode = argv.find((a) => ['--write', '--check', '--scan'].includes(a));
  if (mode === '--write') {
    const written = write();
    console.log(written.length ? `wrote ${written.join(', ')}` : 'every generated output is current');
    return 0;
  }
  if (mode === '--check') {
    const stale = drift();
    if (stale.length) {
      console.error(`site hosts drifted from ${RECORD}: ${stale.join(', ')}\nrun: node tools/build-site-hosts.mjs --write`);
      return 1;
    }
    console.log(`site hosts current: ${Object.values(OUTPUTS).join(', ')}`);
    return 0;
  }
  if (mode === '--scan') {
    const rows = scanHostLiterals();
    let lanes = null;
    try { lanes = readPending(); } catch (e) { console.error(`pending lists unreadable: ${e.message}`); }
    const owner = new Map();
    if (lanes) for (const [lane, data] of Object.entries(lanes)) for (const e of data.files || []) owner.set(e.file, `${lane} (${e.stage}, ${e.count})`);
    for (const r of rows) console.log(`${String(r.count).padStart(4)}  ${r.file}  ${owner.get(r.file) || 'NOT LISTED'}`);
    const total = rows.reduce((s, r) => s + r.count, 0);
    console.log(`${rows.length} files, ${total} site-host literals in code outside the generated outputs`);
    const problems = lanes ? pendingProblems(rows, lanes) : [];
    for (const p of problems) console.error(`problem: ${p}`);
    return problems.length ? 1 : 0;
  }
  console.error('usage: node tools/build-site-hosts.mjs --write | --check | --scan');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
