#!/usr/bin/env node
/* MISSION CATALOG IMPORT: validate the frozen catalog against applied SQL and generate its recovery files.

     node tools/build-mission-import.mjs          # validate the catalog, write the files, remove stale ones
     node tools/build-mission-import.mjs --check  # fail if a file drifted from the catalog or a stale one remains

   Writes, under supabase/pending/ (this tool never touches a database; every file needs the owner's
   approval of its exact SQL, see supabase/pending/PROMOTION-ORDER.md, section 10):
     20261117100200_action_mission_drawdown_import.rollback.sql   deletes exactly those ids, however many parts ran;
                                                                  refuses while referenced
     20261117100300_action_mission_drawdown_publish.rollback.sql  open -> draft, exactly those ids

   Checks, never writes, the publication (20261120061714_action_mission_drawdown_publish.sql, applied 2026-11-20)
   and the import parts: the missions as drafts, plus their details, applied in production in
   order on 2026-11-18 and promoted to supabase/migrations/<version>_action_mission_drawdown_import_NN.sql under
   the versions production recorded (APPLIED_IMPORT_PART_VERSIONS). They were staged and reviewed in
   supabase/pending/ as 20261117100200_action_mission_drawdown_import_01.sql .. _NN.sql, and the SQL still names
   them so (importPartStageName): an applied migration keeps its bytes, including its historical pending header.
   A build that would change an import part or the publication stops instead.

   The parts. Until 2026-11-18 the import was one file, 20261117100200_action_mission_drawdown_import.sql
   (188,022 bytes): more than one Supabase MCP `apply_migration` call can carry when the operator sends the
   committed file byte for byte. It is now cut, in catalog order, into the fewest parts of at most
   IMPORT_PART_MAX_BYTES bytes each, as even in size as that count allows, applied one at a time as migrations
   action_mission_drawdown_import_01 to _NN. Each part is one transaction: its missions, then their details rows,
   ON CONFLICT DO NOTHING. It refuses (55000), changing nothing, unless the details table exists and, from part 02
   on, the part before it is in: that part's last mission is there with its details row (a part is one transaction,
   so that row stands for all of it). One rollback serves every part. The one-file import is no longer written:
   singleImportReference() rebuilds it byte for byte, in memory only, for the proofs that the parts leave exactly
   its rows; --check fails while that file, or a part this catalog does not build, is on disk, so two appliable
   copies of the import never sit side by side.

   Every row is checked before anything is written, and one bad row stops the build:
     - against production's check constraints on public.action_missions. PRODUCTION_MISSION_CHECKS below is
       pg_get_constraintdef() output, read (SELECT only) from project zmnhbrjyhxzhkxmhkexs on 2026-11-17, and
       is evaluated here with SQL's rules: a check fails only when it is false, never when it is null. An
       unknown shape of check stops the build instead of being skipped;
     - against the constraints of public.action_mission_details
       (supabase/migrations/20261118021521_action_mission_details.sql; DETAIL_LIMITS mirrors them and
       scripts/test/mission-import.test.mjs holds the two together);
     - against the catalog's own rules (data/missions/drawdown/README.md): kind civic, status draft, original
       wording credited, and every CC BY 4.0 row's credit_line naming its creators, record, DOI and licence URL.

   Ids are deterministic: UUID v5 (RFC 9562, section 5.5) of "mccluster:mission:drawdown:<slug>" under
   NAMESPACE, so a rerun of the import inserts nothing and the publish names the same rows. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const CATALOG_PATH = 'data/missions/drawdown/missions.json';
export const DETAILS_SQL_PATH = 'supabase/migrations/20261118021521_action_mission_details.sql';
export const PUBLISH_STAGE_FILE = 'supabase/pending/20261117100300_action_mission_drawdown_publish.sql';
export const OUTPUT_FILES = Object.freeze({
  importRollback: 'supabase/pending/20261117100200_action_mission_drawdown_import.rollback.sql',
  publish: 'supabase/migrations/20261120061714_action_mission_drawdown_publish.sql',
  publishRollback: 'supabase/pending/20261117100300_action_mission_drawdown_publish.rollback.sql',
});

/** The most bytes (UTF-8) one import part may hold: what one `apply_migration` call carries safely. */
export const IMPORT_PART_MAX_BYTES = 32000;
const pad2 = (i) => String(i).padStart(2, '0');
/** Part i (1-based): the migration name it is applied under. */
export const importPartName = (i) => `action_mission_drawdown_import_${pad2(i)}`;
/**
 * Part i (1-based): the name it was staged and reviewed under in supabase/pending/. The generated SQL names the parts
 * by it (the guards' hints, the publish, the import rollback), so it never changes: an applied part's bytes cannot.
 */
export const importPartStageName = (i) => `20261117100200_${importPartName(i)}.sql`;
/**
 * The ledger versions production recorded for parts 01 to 07, applied 2026-11-18 (read, SELECT only, that day). Each
 * part is now that migration, supabase/migrations/<version>_<name>.sql, the stored statement byte for byte.
 */
export const APPLIED_IMPORT_PART_VERSIONS = Object.freeze([
  '20261118034753', '20261118034926', '20261118035056', '20261118035221', '20261118035346', '20261118035521', '20261118035654',
]);
/** Part i (1-based): its file, the applied migration. A part with no applied version means the catalog changed. */
export function importPartFile(i) {
  const version = APPLIED_IMPORT_PART_VERSIONS[i - 1];
  if (!version) throw new Error(`import part ${pad2(i)} has no applied migration: the parts are in production, so a change to ${CATALOG_PATH} is a new migration, never a regenerated part`);
  return `supabase/migrations/${version}_${importPartName(i)}.sql`;
}
/** A staged part left in supabase/pending/: stale once the parts are applied (two appliable copies of the import). */
const PART_FILE = /^20261117100200_action_mission_drawdown_import_[0-9]+[.]sql$/;
/** The import as one file, written until 2026-11-18 and replaced by the parts. It must not come back beside them. */
export const RETIRED_IMPORT_FILE = 'supabase/pending/20261117100200_action_mission_drawdown_import.sql';
const fileName = (path) => path.slice(path.lastIndexOf('/') + 1);

/** Fixed namespace for mission ids (a random version 4 UUID chosen once, 2026-11-17). Never change it: every id moves. */
export const NAMESPACE = '4540f730-bb7d-4dde-b727-03881158e001';
export const CATALOG = 'drawdown';
export const ID_NAME_PREFIX = `mccluster:mission:${CATALOG}:`;

/** public.action_missions in production, read 2026-11-17 (information_schema / pg_attribute, SELECT only). */
export const PRODUCTION_MISSION_COLUMNS = Object.freeze([
  ['id', 'uuid', true], ['campaign_id', 'text', false], ['title', 'text', true], ['description', 'text', true],
  ['domain', 'text', true], ['difficulty', 'smallint', true], ['base_points', 'integer', true],
  ['proof_required', 'boolean', true], ['verification_mode', 'text', true], ['skills', 'text[]', true],
  ['capacity', 'integer', false], ['status', 'text', true], ['starts_at', 'timestamp with time zone', false],
  ['ends_at', 'timestamp with time zone', false], ['created_at', 'timestamp with time zone', true],
  ['updated_at', 'timestamp with time zone', true], ['kind', 'text', true], ['discovery_category', 'text', false],
].map(([name, type, notNull]) => Object.freeze({ name, type, notNull })));

/** pg_get_constraintdef() of every CHECK on public.action_missions in production, read 2026-11-17. Verbatim. */
export const PRODUCTION_MISSION_CHECKS = Object.freeze({
  action_missions_base_points_check: 'CHECK (((base_points >= 10) AND (base_points <= 1000)))',
  action_missions_capacity_check: 'CHECK (((capacity IS NULL) OR (capacity > 0)))',
  action_missions_difficulty_check: 'CHECK (((difficulty >= 1) AND (difficulty <= 5)))',
  action_missions_discovery_category_check: "CHECK ((discovery_category = ANY (ARRAY['create'::text, 'help'::text, 'explore'::text, 'earn'::text])))",
  action_missions_domain_check: "CHECK ((domain = ANY (ARRAY['music'::text, 'advocacy'::text, 'community'::text, 'business'::text, 'research'::text, 'education'::text, 'mutual_aid'::text, 'creative'::text, 'other'::text])))",
  action_missions_kind_check: "CHECK ((kind = ANY (ARRAY['civic'::text, 'clip'::text])))",
  action_missions_status_check: "CHECK ((status = ANY (ARRAY['draft'::text, 'open'::text, 'paused'::text, 'closed'::text])))",
  action_missions_title_check: 'CHECK (((char_length(title) >= 1) AND (char_length(title) <= 160)))',
  action_missions_verification_mode_check: "CHECK ((verification_mode = ANY (ARRAY['review'::text, 'peer'::text, 'automatic'::text, 'none'::text])))",
});

/** The constraints of public.action_mission_details, in JavaScript. Lengths count characters, as char_length does. */
export const DETAIL_LIMITS = Object.freeze({
  catalog: { nullable: false, re: /^[a-z][a-z0-9_-]{1,39}$/ },
  slug: { nullable: false, min: 3, max: 120, re: /^[a-z0-9]+(-[a-z0-9]+)*$/ },
  proof_hint: { nullable: true, min: 1, max: 500 },
  safety_note: { nullable: true, min: 1, max: 500 },
  credit_line: { nullable: false, min: 1, max: 1000 },
  about: { nullable: true, min: 1, max: 1200 },
  about_credit: { nullable: true, min: 1, max: 300 },
  source_url: { nullable: true, min: 9, max: 500, re: /^https:\/\/\S+$/ },
  license_name: { nullable: true, min: 1, max: 100 },
  license_url: { nullable: true, min: 9, max: 500, re: /^https:\/\/\S+$/ },
  doi: { nullable: true, min: 20, max: 300, re: /^https:\/\/doi[.]org\/10[.][0-9]{4,9}\/\S+$/ },
});
export const DETAIL_PAIRS = Object.freeze([['about', 'about_credit'], ['license_name', 'license_url']]);

/** The only licence the import writes into license_name / license_url / doi. Anything else needs review first. */
export const CC_BY = Object.freeze({ name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' });

const SKILL = /^[a-z][a-z0-9_-]{0,39}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const charLength = (s) => Array.from(s).length;

/** UUID version 5 (SHA-1, RFC 9562 section 5.5) of a UTF-8 name under a namespace UUID. */
export function uuidV5(name, namespace) {
  const ns = Buffer.from(String(namespace).replace(/-/g, ''), 'hex');
  if (ns.length !== 16 || !/^[0-9a-f-]{36}$/i.test(namespace)) throw new Error(`not a UUID: ${namespace}`);
  const b = createHash('sha1').update(ns).update(Buffer.from(name, 'utf8')).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const missionId = (slug) => uuidV5(ID_NAME_PREFIX + slug, NAMESPACE);

/* SQL three-valued logic for the four shapes production's checks take today. */
const isNull = (v) => v === null || v === undefined;
const and3 = (a, b) => (a === false || b === false ? false : a === null || b === null ? null : true);
const or3 = (a, b) => (a === true || b === true ? true : a === null || b === null ? null : false);
const cmp = (v, op, n) => (isNull(v) ? null : op === '>=' ? v >= n : op === '<=' ? v <= n : v > n);

/**
 * Turn one production CHECK definition into { columns, test(row) -> true | false | null }. A CHECK passes unless
 * test returns false. Throws on any shape it does not know, so a changed constraint is never silently ignored.
 */
export function checkPredicate(def) {
  let m = /^CHECK \(\(\((\w+) >= (-?\d+)\) AND \(\1 <= (-?\d+)\)\)\)$/.exec(def);
  if (m) {
    const [, col, lo, hi] = m;
    return { columns: [col], test: (r) => and3(cmp(r[col], '>=', Number(lo)), cmp(r[col], '<=', Number(hi))) };
  }
  m = /^CHECK \(\(\(char_length\((\w+)\) >= (\d+)\) AND \(char_length\(\1\) <= (\d+)\)\)\)$/.exec(def);
  if (m) {
    const [, col, lo, hi] = m;
    const len = (r) => (isNull(r[col]) ? null : charLength(String(r[col])));
    return { columns: [col], test: (r) => and3(cmp(len(r), '>=', Number(lo)), cmp(len(r), '<=', Number(hi))) };
  }
  m = /^CHECK \(\((\w+) = ANY \(ARRAY\[((?:'[^']*'::text(?:, )?)+)\]\)\)\)$/.exec(def);
  if (m) {
    const [, col, list] = m;
    const allowed = [...list.matchAll(/'([^']*)'::text/g)].map((x) => x[1]);
    return { columns: [col], allowed, test: (r) => (isNull(r[col]) ? null : allowed.includes(r[col])) };
  }
  m = /^CHECK \(\(\((\w+) IS NULL\) OR \(\1 > (-?\d+)\)\)\)$/.exec(def);
  if (m) {
    const [, col, n] = m;
    return { columns: [col], test: (r) => or3(isNull(r[col]), cmp(r[col], '>', Number(n))) };
  }
  throw new Error(`unrecognised CHECK shape, read it again and teach the tool: ${def}`);
}

/** The action_missions row the import writes for one catalog entry (created_at / updated_at take their defaults). */
export function missionRow(m) {
  return {
    id: missionId(m.slug), campaign_id: null, title: m.title, description: m.description, domain: m.domain,
    difficulty: m.difficulty, base_points: m.base_points, proof_required: true, verification_mode: m.verification_mode,
    skills: m.skills, capacity: null, status: 'draft', starts_at: null, ends_at: null, kind: 'civic',
    discovery_category: m.discovery_category,
  };
}

/** The action_mission_details row the import writes for one catalog entry. Licence and DOI only for CC BY rows. */
export function detailsRow(m) {
  const s = m.source || {};
  const ccBy = s.license === CC_BY.name;
  return {
    mission_id: missionId(m.slug), catalog: CATALOG, slug: m.slug, proof_hint: m.proof_hint, safety_note: m.safety,
    credit_line: m.credit_line, about: m.about ?? null, about_credit: m.about_credit ?? null,
    source_url: s.explorer_url ?? null, license_name: ccBy ? CC_BY.name : null, license_url: ccBy ? s.license_url : null,
    doi: ccBy ? s.doi : null,
  };
}

/** "Family, Given" (as Zenodo lists creators) -> "Given Family", the order credit lines use. */
export const creatorName = (c) => (c.includes(',') ? `${c.slice(c.indexOf(',') + 1).trim()} ${c.slice(0, c.indexOf(',')).trim()}` : c.trim());

/** Every problem with the catalog, as strings. An empty list means the catalog may be built. */
export function validateCatalog(catalog) {
  const errors = [];
  const fail = (where, msg) => errors.push(`${where}: ${msg}`);
  if (catalog?.schema !== 'mccluster.mission-catalog/v1') fail('catalog', `schema is ${JSON.stringify(catalog?.schema)}`);
  if (catalog?.catalog !== CATALOG) fail('catalog', `catalog is ${JSON.stringify(catalog?.catalog)}, this tool builds "${CATALOG}"`);
  const rows = Array.isArray(catalog?.missions) ? catalog.missions : [];
  if (!rows.length) fail('catalog', 'no missions');
  if (catalog?.count !== rows.length) fail('catalog', `count says ${catalog?.count}, missions holds ${rows.length}`);
  const checks = Object.entries(PRODUCTION_MISSION_CHECKS).map(([name, def]) => ({ name, ...checkPredicate(def) }));
  const seen = { slug: new Map(), id: new Map(), title: new Map() };
  rows.forEach((m, i) => {
    const where = `missions[${i}] ${m?.slug ?? '(no slug)'}`;
    const text = (key, value, { nullable = false } = {}) => {
      if (isNull(value)) { if (!nullable) fail(where, `${key} is missing`); return; }
      if (typeof value !== 'string') { fail(where, `${key} is not text`); return; }
      if (!value.trim()) fail(where, `${key} is blank`);
      if (CONTROL.test(value)) fail(where, `${key} holds a control character`);
      if (value !== value.trim()) fail(where, `${key} has leading or trailing space`);
    };
    for (const key of ['slug', 'title', 'description', 'proof_hint', 'safety', 'domain', 'discovery_category', 'kind', 'status', 'verification_mode', 'credit_line']) text(key, m?.[key]);
    for (const key of ['about', 'about_credit']) text(key, m?.[key], { nullable: true });
    if (m?.kind !== 'civic') fail(where, `kind is ${JSON.stringify(m?.kind)}; the import writes civic missions only`);
    if (m?.status !== 'draft') fail(where, `status is ${JSON.stringify(m?.status)}; the catalog holds drafts only`);
    for (const key of ['difficulty', 'base_points']) if (!Number.isInteger(m?.[key])) fail(where, `${key} is not an integer`);
    if (!Array.isArray(m?.skills) || m.skills.length > 12 || m.skills.some((s) => typeof s !== 'string' || !SKILL.test(s))) fail(where, 'skills must be up to 12 lowercase words');
    else if (new Set(m.skills).size !== m.skills.length) fail(where, 'skills repeat');
    if (typeof m?.slug !== 'string') return; // no id without a slug; the missing slug is already reported

    const row = missionRow(m);
    for (const c of checks) if (c.test(row) === false) fail(where, `violates ${c.name}: ${PRODUCTION_MISSION_CHECKS[c.name]}`);
    for (const col of PRODUCTION_MISSION_COLUMNS) if (col.notNull && !['created_at', 'updated_at'].includes(col.name) && isNull(row[col.name])) fail(where, `${col.name} is null`);

    const d = detailsRow(m);
    for (const [key, rule] of Object.entries(DETAIL_LIMITS)) {
      const v = d[key];
      if (isNull(v)) { if (!rule.nullable) fail(where, `details ${key} is null`); continue; }
      if (typeof v !== 'string') { fail(where, `details ${key} is not text`); continue; }
      const n = charLength(v);
      if (rule.min !== undefined && (n < rule.min || n > rule.max)) fail(where, `details ${key} is ${n} characters, outside ${rule.min}..${rule.max}`);
      if (rule.re && !rule.re.test(v)) fail(where, `details ${key} does not match ${rule.re}`);
      if (CONTROL.test(v)) fail(where, `details ${key} holds a control character`);
    }
    for (const [a, b] of DETAIL_PAIRS) if (isNull(d[a]) !== isNull(d[b])) fail(where, `${a} and ${b} must come together`);

    const s = m.source;
    if (!s || typeof s !== 'object') fail(where, 'source is missing');
    else if (s.license === CC_BY.name) {
      if (s.license_url !== CC_BY.url) fail(where, `CC BY row's license_url is ${JSON.stringify(s.license_url)}`);
      if (!Array.isArray(s.creators) || !s.creators.length) fail(where, 'CC BY row names no creators');
      if (typeof s.record_title !== 'string' || !s.record_title) fail(where, 'CC BY row names no record');
      if (typeof s.doi !== 'string' || !s.doi) fail(where, 'CC BY row has no DOI');
      const credit = String(m.credit_line).toLowerCase();
      for (const c of Array.isArray(s.creators) ? s.creators : []) if (!credit.includes(creatorName(String(c)).toLowerCase())) fail(where, `credit_line does not name the creator ${c}`);
      for (const [label, value] of [['the record', s.record_title], ['the DOI', s.doi], ['the licence URL', s.license_url], ['the licence', CC_BY.name]]) {
        if (typeof value === 'string' && value && !credit.includes(value.toLowerCase())) fail(where, `credit_line does not name ${label}`);
      }
    } else {
      if (!isNull(s.license)) fail(where, `licence ${JSON.stringify(s.license)} is not ${CC_BY.name}; review it before importing`);
      if (!isNull(s.license_url) || !isNull(s.doi)) fail(where, 'a DOI or licence URL without a CC BY licence would be dropped');
    }
    if (!isNull(s?.explorer_url) && !String(m.credit_line).includes(s.explorer_url)) fail(where, 'credit_line does not link the Explorer page');

    for (const [key, value] of [['slug', m.slug], ['id', row.id], ['title', m.title]]) {
      if (seen[key].has(value)) fail(where, `${key} repeats missions[${seen[key].get(value)}]`);
      else seen[key].set(value, i);
    }
  });
  return errors;
}

/* ---- SQL text ----------------------------------------------------------------------------------------------- */

const lit = (v) => (isNull(v) ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const textArray = (a) => (a.length ? `array[${a.map(lit).join(',')}]::text[]` : `'{}'::text[]`);
const LINE = '-- ' + '-'.repeat(110);

function summary(catalog, sha) {
  const rows = catalog.missions;
  const ccBy = rows.filter((m) => m.source?.license === CC_BY.name).length;
  return {
    n: rows.length, ccBy, about: rows.filter((m) => !isNull(m.about)).length,
    sourceUrl: rows.filter((m) => !isNull(m.source?.explorer_url)).length, sha,
  };
}

const provenance = (s) => [
  `-- GENERATED by tools/build-mission-import.mjs from ${CATALOG_PATH}`,
  `-- (sha256 ${s.sha}).`,
  '-- Do not edit by hand: change the catalog or the tool, run',
  '--   node tools/build-mission-import.mjs',
  '-- and check with node tools/build-mission-import.mjs --check (scripts/test/mission-import.test.mjs runs it).',
];

const idList = (catalog, indent) => catalog.missions.map((m, i, all) =>
  `${indent}'${missionId(m.slug)}'${i < all.length - 1 ? ',' : ' '} -- ${m.slug}`).join('\n');

/** One mission's row in the VALUES list of the missions INSERT, without the comma that separates rows. */
function missionValues(m) {
  const r = missionRow(m);
  return [
    `    (${lit(r.id)}::uuid, -- ${m.slug}`,
    `     ${lit(r.title)},`,
    `     ${lit(r.description)},`,
    `     ${lit(r.domain)}, ${lit(r.discovery_category)}, ${r.difficulty}, ${r.base_points}, ${lit(r.verification_mode)}, ${textArray(r.skills)})`,
  ].join('\n');
}

/** One mission's row in the VALUES list of the details INSERT, without the comma that separates rows. */
function detailsValues(m) {
  const d = detailsRow(m);
  return [
    `    (${lit(d.mission_id)}::uuid, ${lit(d.slug)},`,
    `     ${lit(d.proof_hint)},`,
    `     ${lit(d.safety_note)},`,
    `     ${lit(d.credit_line)},`,
    `     ${lit(d.about)},`,
    `     ${lit(d.about_credit)},`,
    `     ${lit(d.source_url)}, ${lit(d.license_name)}, ${lit(d.license_url)}, ${lit(d.doi)})`,
  ].join('\n');
}

/** The two INSERT statements for a run of missions, each under its heading: the missions, then their details. */
function insertStatements(missions, missionsHeading, detailsHeading) {
  return [
    LINE,
    missionsHeading,
    'insert into public.action_missions',
    '  (id, campaign_id, title, description, domain, difficulty, base_points, proof_required, verification_mode,',
    '   skills, capacity, status, starts_at, ends_at, kind, discovery_category)',
    "select v.id, null, v.title, v.description, v.domain, v.difficulty, v.base_points, true, v.verification_mode,",
    "       v.skills, null, 'draft', null, null, 'civic', v.discovery_category",
    '  from (values',
    missions.map(missionValues).join(',\n'),
    '  ) as v(id, title, description, domain, discovery_category, difficulty, base_points, verification_mode, skills)',
    'on conflict (id) do nothing;',
    '',
    LINE,
    detailsHeading,
    'insert into public.action_mission_details',
    '  (mission_id, catalog, slug, proof_hint, safety_note, credit_line, about, about_credit, source_url,',
    '   license_name, license_url, doi)',
    `select v.mission_id, ${lit(CATALOG)}, v.slug, v.proof_hint, v.safety_note, v.credit_line, v.about, v.about_credit,`,
    '       v.source_url, v.license_name, v.license_url, v.doi',
    '  from (values',
    missions.map(detailsValues).join(',\n'),
    '  ) as v(mission_id, slug, proof_hint, safety_note, credit_line, about, about_credit, source_url, license_name,',
    '        license_url, doi)',
    'on conflict (mission_id) do nothing;',
  ];
}

const IMPORT_GUARD_DETAILS = [
  "  if to_regclass('public.action_mission_details') is null then",
  "    raise exception 'apply 20261117100100_action_mission_details.sql before the Drawdown import' using errcode = '55000';",
  '  end if;',
];

/**
 * The import as the one file this tool wrote until 2026-11-18 (20261117100200_action_mission_drawdown_import.sql),
 * byte for byte. Never written to disk any more: the proofs apply it beside the parts and compare the rows.
 */
function buildSingleImport(catalog, s) {
  return [
    '-- PROJECT DRAWDOWN MISSION CATALOG: IMPORT AS DRAFTS',
    '--',
    ...provenance(s),
    '--',
    '-- PENDING. Not applied to production. Owner approval required. Apply with the Supabase MCP `apply_migration`',
    '-- (it runs as postgres) under the name `action_mission_drawdown_import`, AFTER',
    '-- 20261117100100_action_mission_details.sql (this file refuses to run without that table), then promote with',
    '-- the steps in supabase/pending/README.md. Order: supabase/pending/PROMOTION-ORDER.md, section 10.',
    '-- Rollback: 20261117100200_action_mission_drawdown_import.rollback.sql.',
    '-- Proof before apply: scripts/test/mission-catalog.native.integration.mjs.',
    '--',
    '-- What it does, in one transaction:',
    `--   1. Inserts ${s.n} missions into public.action_missions, every one with status 'draft': anonymous visitors`,
    "--      and members cannot read a draft (production's policy \"public reads open missions\"). Each is kind",
    "--      'civic' with proof_required true; title, description, domain, discovery category, difficulty, points,",
    '--      verification mode and skills come from the catalog; campaign_id, capacity, starts_at and ends_at are',
    '--      null. Ids are deterministic: UUID v5 of "mccluster:mission:drawdown:<slug>" under the namespace',
    `--      ${NAMESPACE} (tools/build-mission-import.mjs). ON CONFLICT (id) DO NOTHING, so a`,
    '--      rerun inserts nothing and never overwrites a mission the owner has since edited or published.',
    `--   2. Inserts their ${s.n} rows into public.action_mission_details: proof hint, safety note and credit line for`,
    `--      every mission; about with its about_credit for ${s.about}; source_url, the mission's Project Drawdown`,
    `--      Explorer page, for ${s.sourceUrl} (Deploy Clean Cooking has none); licence name, licence URL and DOI for the`,
    `--      ${s.ccBy} missions that cite a CC BY 4.0 assessment record. ON CONFLICT (mission_id) DO NOTHING.`,
    `-- Row counts: public.action_missions +${s.n} (all draft); public.action_mission_details +${s.n}. On a rerun: +0 and +0.`,
    '-- Nothing else is written. Publishing is a separate file: 20261117100300_action_mission_drawdown_publish.sql.',
    "-- Every row was checked against production's check constraints on public.action_missions (read 2026-11-17)",
    '-- and the constraints of public.action_mission_details before this file was written.',
    'begin;',
    "set local lock_timeout = '5s';",
    'set local standard_conforming_strings = on;',
    '',
    'do $import_guard$',
    'begin',
    ...IMPORT_GUARD_DETAILS,
    'end',
    '$import_guard$;',
    '',
    ...insertStatements(catalog.missions, `-- 1. ${s.n} missions, every one a draft`,
      `-- 2. their ${s.n} details rows: proof hint, safety note, credit, quotation, source, licence`),
    '',
    'commit;',
    '',
  ].join('\n');
}

/**
 * One import part. part: { index, missions, first, last } (first and last: 1-based catalog positions);
 * total: how many parts there are; previous: the part before it, or null for part 01.
 */
function buildImportPart(part, total, previous, s) {
  const k = part.missions.length;
  const [P, T] = [pad2(part.index), pad2(total)];
  const before = previous && previous.missions[previous.missions.length - 1];
  const B = previous && pad2(previous.index);
  return [
    `-- PROJECT DRAWDOWN MISSION CATALOG: IMPORT AS DRAFTS, PART ${P} OF ${T} (catalog missions ${part.first} to ${part.last} of ${s.n})`,
    '--',
    ...provenance(s),
    '--',
    '-- PENDING. Not applied to production. Owner approval required. Apply with the Supabase MCP `apply_migration`',
    `-- (it runs as postgres) under the name \`${importPartName(part.index)}\`, this file byte for byte in one call,`,
    '-- then promote it with the steps in supabase/pending/README.md.',
    `-- Order: parts 01 to ${T} one at a time, production read again between parts (supabase/pending/PROMOTION-ORDER.md,`,
    ...(previous ? [
      `-- section 10). Part ${P} refuses, changing nothing, until part ${B} is in. After part ${T}, when the owner decides:`,
      '-- the publish (20261117100300).',
    ] : [
      '-- section 10). Part 01 refuses, changing nothing, until 20261117100100_action_mission_details.sql is in, and each',
      `-- later part until the part before it is in. After part ${T}, when the owner decides: the publish (20261117100300).`,
    ]),
    `-- Rollback: ${fileName(OUTPUT_FILES.importRollback)}. One rollback serves every part.`,
    '-- Proof before apply: scripts/test/mission-catalog.native.integration.mjs.',
    '--',
    `-- What it does, in one transaction: inserts these ${k} missions into public.action_missions as drafts (kind civic,`,
    `-- proof required; ids UUID v5 of "mccluster:mission:drawdown:<slug>" under ${NAMESPACE}), then`,
    `-- their ${k} rows into public.action_mission_details, both ON CONFLICT DO NOTHING: a rerun inserts nothing and never`,
    "-- overwrites a mission the owner has since edited or published. Every row passed production's checks on",
    '-- public.action_missions (read 2026-11-17) and the constraints of public.action_mission_details.',
    `-- Row counts: public.action_missions +${k} (all draft); public.action_mission_details +${k}. On a rerun: +0 and +0.`,
    'begin;',
    "set local lock_timeout = '5s';",
    'set local standard_conforming_strings = on;',
    '',
    'do $import_guard$',
    'begin',
    ...IMPORT_GUARD_DETAILS,
    ...(previous ? [
      `  -- Part ${B} first: it is one transaction, so its last mission is there with its details row once it committed.`,
      '  if not exists (select 1 from public.action_missions m join public.action_mission_details d on d.mission_id = m.id',
      `                  where m.id = ${lit(missionId(before.slug))}::uuid) then -- ${before.slug}`,
      `    raise exception 'Drawdown import part ${P} of ${T} refused: part ${B} (${importPartName(previous.index)}) is not applied'`,
      `      using errcode = '55000', hint = 'Apply ${importPartStageName(previous.index)} first; nothing was imported.';`,
      '  end if;',
    ] : []),
    'end',
    '$import_guard$;',
    '',
    ...insertStatements(part.missions, `-- 1. ${k} missions (catalog ${part.first} to ${part.last}), every one a draft`,
      `-- 2. their ${k} details rows: proof hint, safety note, credit, quotation, source, licence`),
    '',
    'commit;',
    '',
  ].join('\n');
}

/* ---- the parts: catalog order, the fewest that fit, as even as that count allows ------------------------------ */

/* Every real total has two digits, as this stand-in does, so a part's size does not depend on the total. */
const PLAN_TOTAL = 99;
const bytes = (text) => Buffer.byteLength(text, 'utf8');

/**
 * Greedy, in catalog order: a part takes the next mission while the whole part, header and guards included, stays
 * within `budget` bytes. Throws a RangeError when one mission alone does not fit.
 */
function packParts(catalog, s, budget) {
  const parts = [];
  let open = null;
  const fits = (part) => bytes(buildImportPart(part, PLAN_TOTAL, parts[parts.length - 1] || null, s)) <= budget;
  catalog.missions.forEach((m, i) => {
    const grown = open && { ...open, missions: [...open.missions, m], last: i + 1 };
    if (grown && fits(grown)) { open = grown; return; }
    if (open) parts.push(open);
    open = { index: parts.length + 1, missions: [m], first: i + 1, last: i + 1 };
    if (!fits(open)) throw new RangeError(`${m.slug} alone does not fit in an import part of ${budget} bytes`);
  });
  if (open) parts.push(open);
  if (parts.length > PLAN_TOTAL) throw new RangeError(`${parts.length} import parts; at most ${PLAN_TOTAL}`);
  return parts;
}

const planned = new Map();
/**
 * The parts for this catalog: the fewest that each fit in IMPORT_PART_MAX_BYTES, then the smallest byte budget that
 * still needs no more of them, so they come out about the same size. Deterministic: the same catalog, the same cuts.
 */
function planParts(catalog, s) {
  // The plan depends on the rows and on the header (which names the catalog file's sha256): key on both.
  const key = `${s.sha}:${createHash('sha256').update(JSON.stringify(catalog.missions)).digest('hex')}`;
  if (planned.has(key)) return planned.get(key);
  const fewest = packParts(catalog, s, IMPORT_PART_MAX_BYTES).length;
  let [lo, hi] = [1, IMPORT_PART_MAX_BYTES];
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    let n = Infinity;
    try { n = packParts(catalog, s, mid).length; } catch (error) { if (!(error instanceof RangeError)) throw error; }
    if (n <= fewest) hi = mid; else lo = mid + 1;
  }
  const parts = packParts(catalog, s, hi);
  if (parts.length !== fewest) throw new Error(`import parts: planned ${parts.length}, the fewest is ${fewest}`);
  planned.set(key, parts);
  return parts;
}

/** The SQL of every part, in order, each checked against IMPORT_PART_MAX_BYTES. */
function renderParts(catalog, s) {
  const parts = planParts(catalog, s);
  return parts.map((part, i) => {
    const sql = buildImportPart(part, parts.length, parts[i - 1] || null, s);
    if (bytes(sql) > IMPORT_PART_MAX_BYTES) throw new Error(`${importPartStageName(part.index)} is ${bytes(sql)} bytes, over ${IMPORT_PART_MAX_BYTES}`);
    return { ...part, sql };
  });
}

/** "<part 01's staged name> to _NN.sql": how the publish and the import rollback name the parts. */
const partsSpan = (total) => `${importPartStageName(1)} to _${pad2(total)}.sql`;

function buildImportRollback(catalog, s, total) {
  /* the parts it recovers from, where they are now (the applied migrations), then the names they were staged and reviewed under
     (review of the release polish, RP-4: the staged names alone are no longer on disk) */
  return [
    `-- Recovery artifact for the import parts ${importPartFile(1)} to`,
    `-- ${fileName(importPartFile(total))}, however many of them ran: never a forward migration. They were`,
    `-- staged and reviewed as ${partsSpan(total)} and applied on 2026-11-18.`,
    '--',
    ...provenance(s),
    '--',
    '-- Owner approval required, like the forward file. Run it as postgres, as the forward file was (the Supabase',
    '-- MCP `apply_migration` runs as postgres). If the missions were published, run',
    '-- 20261117100300_action_mission_drawdown_publish.rollback.sql first.',
    '--',
    `-- What it does, in one transaction: deletes exactly the ${s.n} missions the import wrote (the ids below) and their`,
    `-- ${s.n} details rows. Row counts: public.action_missions -${s.n}, public.action_mission_details -${s.n} (fewer if some`,
    '-- are already gone; then nothing else changes). It deletes nothing else.',
    '-- It REFUSES, deleting nothing, while any other row references one of them: a member assignment (proofs hang',
    '-- off assignments, so a proof is one too), a pin, a policy, a bounty, a live room, a content item, an Intel link,',
    '-- or anything else whose foreign key points at public.action_missions (read from the catalog when it runs),',
    '-- plus the two references production holds without a foreign key (action_creator_payout_intents and',
    '-- action_creator_funding, mission_id). It locks before it counts, so no reference can appear between the count',
    '-- and the delete: the missions FOR UPDATE (a join, or a new row whose foreign key names one, waits) and those',
    '-- two tables in SHARE mode (a write already in progress on them is waited for and counted; a new one waits',
    '-- until the rollback ends). Without a foreign key, nothing stops a later write from naming a deleted id in',
    '-- those two tables. Production has no function that writes action_creator_funding, and its one writer of',
    '-- payout intents (action_creator_reserve_payout) takes the mission from an earning, whose clip campaign',
    '-- references the mission by foreign key (read 2026-11-17).',
    '-- Safe to run twice: the second run finds nothing to delete.',
    'begin;',
    "set local lock_timeout = '5s';",
    '',
    'do $import_rollback$',
    'declare',
    '  v_ids constant uuid[] := array[',
    idList(catalog, '    '),
    '  ]::uuid[];',
    "  v_soft_tables constant text[] := array['public.action_creator_payout_intents', 'public.action_creator_funding'];",
    '  v_soft text;',
    '  v_fk record;',
    '  v_n bigint;',
    "  v_refs text[] := '{}';",
    'begin',
    '  -- Lock, then count. A join takes its mission FOR UPDATE and a new referencing row takes it FOR KEY SHARE:',
    '  -- both now wait.',
    '  perform 1 from public.action_missions where id = any (v_ids) for update;',
    '  -- The tables that name a mission without a foreign key (read 2026-11-17) are not held back by that lock.',
    '  -- SHARE mode waits for a write already in progress on them, so the count below sees it, and makes a new one',
    '  -- wait until this transaction ends. Payout intents first: production\'s action_creator_reserve_payout takes',
    '  -- its write locks on the two in that order, so it and this rollback cannot deadlock.',
    '  foreach v_soft in array v_soft_tables loop',
    '    if to_regclass(v_soft) is not null then',
    "      execute format('lock table %s in share mode', to_regclass(v_soft));",
    '    end if;',
    '  end loop;',
    '',
    '  for v_fk in',
    '    select n.nspname, c.relname, a.attname',
    '      from pg_constraint k',
    '      join pg_class c on c.oid = k.conrelid',
    '      join pg_namespace n on n.oid = c.relnamespace',
    '      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]',
    "     where k.contype = 'f' and k.confrelid = 'public.action_missions'::regclass",
    "       and k.conrelid is distinct from to_regclass('public.action_mission_details')",
    '     order by 1, 2, 3',
    '  loop',
    "    execute format('select count(*) from %I.%I where %I = any ($1)', v_fk.nspname, v_fk.relname, v_fk.attname)",
    '      into v_n using v_ids;',
    "    if v_n > 0 then v_refs := v_refs || format('%I.%I.%I: %s', v_fk.nspname, v_fk.relname, v_fk.attname, v_n); end if;",
    '  end loop;',
    '',
    '  -- The references without a foreign key, locked above.',
    '  foreach v_soft in array v_soft_tables loop',
    '    if to_regclass(v_soft) is not null then',
    "      execute format('select count(*) from %s where mission_id = any ($1)', to_regclass(v_soft)) into v_n using v_ids;",
    "      if v_n > 0 then v_refs := v_refs || format('%s.mission_id: %s', v_soft, v_n); end if;",
    '    end if;',
    '  end loop;',
    '',
    '  if cardinality(v_refs) > 0 then',
    "    raise exception 'Drawdown import rollback refused: rows still reference the imported missions (%)', array_to_string(v_refs, '; ')",
    "      using errcode = '55000', hint = 'Withdraw, move or delete those rows deliberately first; nothing was deleted.';",
    '  end if;',
    '',
    "  if to_regclass('public.action_mission_details') is not null then",
    "    execute 'delete from public.action_mission_details where mission_id = any ($1)' using v_ids;",
    '  end if;',
    '  delete from public.action_missions where id = any (v_ids);',
    'end',
    '$import_rollback$;',
    '',
    'commit;',
    '',
  ].join('\n');
}

function buildPublish(catalog, s, total) {
  return [
    '-- PROJECT DRAWDOWN MISSION CATALOG: PUBLISH',
    '--',
    ...provenance(s),
    '--',
    '-- PENDING. Not applied to production. Owner approval required. Apply with the Supabase MCP `apply_migration`',
    '-- (it runs as postgres) under the name `action_mission_drawdown_publish`, AFTER the import parts',
    `-- ${partsSpan(total)}, then promote with the steps in`,
    '-- supabase/pending/README.md.',
    '-- Order: supabase/pending/PROMOTION-ORDER.md, section 10.',
    '-- Rollback: 20261117100300_action_mission_drawdown_publish.rollback.sql.',
    '-- Proof before apply: scripts/test/mission-catalog.native.integration.mjs.',
    '--',
    `-- What it does, in one transaction: sets status 'open' on exactly the ${s.n} missions the import wrote (the ids`,
    "-- below), and only where the status is still 'draft': a mission the owner has since paused, closed or opened",
    '-- is left alone. Anonymous visitors then read them through production\'s policy "public reads open missions",',
    '-- and their details through "public reads open mission details". It touches no other row and no other table.',
    '-- It REFUSES, changing nothing, unless every one of these missions exists with its details row, so no mission',
    '-- is ever published without its credit line. The trigger intel_action_open_v2 checks each mission it opens;',
    '-- none of these has an Intel decision link.',
    `-- Row counts: public.action_missions: ${s.n} rows draft -> open on the first run; 0 on a rerun.`,
    'begin;',
    "set local lock_timeout = '5s';",
    '',
    'do $publish_guard$',
    'declare',
    '  v_ids constant uuid[] := array[',
    idList(catalog, '    '),
    '  ]::uuid[];',
    '  v_missing integer;',
    'begin',
    '  select count(*) into v_missing from unnest(v_ids) as i(id)',
    '   where not exists (select 1 from public.action_missions m where m.id = i.id)',
    '      or not exists (select 1 from public.action_mission_details d where d.mission_id = i.id);',
    '  if v_missing > 0 then',
    "    raise exception 'Drawdown publish refused: % of the % missions are missing or have no details row', v_missing, cardinality(v_ids)",
    `      using errcode = '55000', hint = 'Apply the import parts ${partsSpan(total)} first; nothing was published.';`,
    '  end if;',
    'end',
    '$publish_guard$;',
    '',
    'update public.action_missions',
    "   set status = 'open', updated_at = now()",
    " where status = 'draft'",
    '   and id in (',
    idList(catalog, '     '),
    '   );',
    '',
    'commit;',
    '',
  ].join('\n');
}

function buildPublishRollback(catalog, s) {
  return [
    '-- Recovery artifact for 20261117100300_action_mission_drawdown_publish.sql: never a forward migration.',
    '--',
    ...provenance(s),
    '--',
    '-- Owner approval required, like the forward file. Run it as postgres, as the forward file was (the Supabase',
    '-- MCP `apply_migration` runs as postgres).',
    '--',
    `-- What it does, in one transaction: sets status 'draft' on exactly the ${s.n} missions the import wrote (the ids`,
    "-- below), and only where the status is 'open': a mission the owner has since paused or closed is left alone.",
    '-- Anonymous visitors and members can no longer read them or their details, and nobody can join them.',
    '-- A member who already joined keeps the assignment row; nothing is deleted.',
    `-- Row counts: public.action_missions: up to ${s.n} rows open -> draft; 0 on a rerun.`,
    'begin;',
    "set local lock_timeout = '5s';",
    '',
    'update public.action_missions',
    "   set status = 'draft', updated_at = now()",
    " where status = 'open'",
    '   and id in (',
    idList(catalog, '     '),
    '   );',
    '',
    'commit;',
    '',
  ].join('\n');
}

/** Read the catalog from the repository. */
export function readCatalog(root = ROOT) {
  const text = readFileSync(join(root, CATALOG_PATH), 'utf8');
  return { text, catalog: JSON.parse(text) };
}

/** Validate the catalog and summarize it. Throws on any invalid row. */
function prepare({ text, catalog }) {
  const errors = validateCatalog(catalog);
  if (errors.length) throw new Error(`${CATALOG_PATH} is not importable:\n  ${errors.join('\n  ')}`);
  return summary(catalog, createHash('sha256').update(text).digest('hex'));
}

/**
 * The import parts, in the order they are applied: { index, name, file, first, last, slugs, ids, bytes, sql }
 * (first and last are 1-based catalog positions). Throws on any invalid row.
 */
export function buildImportParts(input) {
  const s = prepare(input);
  return renderParts(input.catalog, s).map((p) => ({
    index: p.index, name: importPartName(p.index), file: importPartFile(p.index), first: p.first, last: p.last,
    slugs: p.missions.map((m) => m.slug), ids: p.missions.map((m) => missionId(m.slug)), bytes: bytes(p.sql), sql: p.sql,
  }));
}

/**
 * The whole import as one statement, exactly as this tool wrote 20261117100200_action_mission_drawdown_import.sql
 * until 2026-11-18. For the proofs only (the parts must leave exactly its rows); never written to disk.
 */
export function singleImportReference(input) {
  return buildSingleImport(input.catalog, prepare(input));
}

/** Validate, then return { relative path: file text } for every generated file, the parts first. Throws on any invalid row. */
export function buildFiles(input) {
  const s = prepare(input);
  const { catalog } = input;
  const parts = renderParts(catalog, s);
  return {
    ...Object.fromEntries(parts.map((p) => [importPartFile(p.index), p.sql])),
    [OUTPUT_FILES.importRollback]: buildImportRollback(catalog, s, parts.length),
    [OUTPUT_FILES.publish]: buildPublish(catalog, s, parts.length),
    [OUTPUT_FILES.publishRollback]: buildPublishRollback(catalog, s),
  };
}

/**
 * Files in supabase/pending/ that must not be there: the retired one-file import, any staged part, or the staged
 * publication (they are applied migrations now, so a pending copy would be a second appliable one).
 */
export function staleFiles(root = ROOT, files = buildFiles(readCatalog(root))) {
  return readdirSync(join(root, 'supabase/pending'))
    .map((f) => `supabase/pending/${f}`)
    .filter((path) => (path === RETIRED_IMPORT_FILE || path === PUBLISH_STAGE_FILE || PART_FILE.test(fileName(path))) && !(path in files))
    .sort();
}

/** Paths of generated files that differ from what the catalog builds today, then stale ones (empty when current). */
export function driftedFiles(root = ROOT) {
  const files = buildFiles(readCatalog(root));
  return [
    ...Object.entries(files)
      .filter(([path, out]) => !existsSync(join(root, path)) || readFileSync(join(root, path), 'utf8') !== out)
      .map(([path]) => path),
    ...staleFiles(root, files),
  ];
}

function main() {
  let files;
  try {
    files = buildFiles(readCatalog());
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    const drifted = driftedFiles();
    if (drifted.length) {
      console.error(`generated mission SQL drifted from ${CATALOG_PATH}, or a stale import file is still there; run node tools/build-mission-import.mjs\n  ${drifted.join('\n  ')}`);
      process.exit(1);
    }
    console.log(`mission import SQL is current (${Object.keys(files).length} files)`);
    return;
  }
  // The import parts and publication are applied migrations: a build checks them and never writes one. If the
  // catalog no longer builds any applied file byte for byte, nothing is written.
  const applied = Object.keys(files).filter((path) => path.startsWith('supabase/migrations/'));
  const changed = applied.filter((path) => !existsSync(join(ROOT, path)) || readFileSync(join(ROOT, path), 'utf8') !== files[path]);
  if (changed.length) {
    console.error(`${CATALOG_PATH} no longer builds the applied mission migrations byte for byte; an applied migration never changes (a catalog change is a new migration). Nothing was written:\n  ${changed.join('\n  ')}`);
    process.exit(1);
  }
  const written = Object.keys(files).filter((path) => !applied.includes(path));
  for (const path of written) writeFileSync(join(ROOT, path), files[path]);
  const stale = staleFiles(ROOT, files);
  for (const path of stale) unlinkSync(join(ROOT, path));
  console.log(`wrote ${written.join(', ')}; the ${applied.length} applied mission migrations are unchanged${stale.length ? `\nremoved ${stale.join(', ')}` : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
