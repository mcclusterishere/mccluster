/* Census TIGER/Line boundary catalogue parser. A listing entry is a
   discoverable file for a vintage, not downloaded/validated geometry; the
   record carries the vintage and the state FIPS so a later, separately
   authorised download can attach geometry_ref. Pure; no network. */
import { provenance, intakeRecord } from '../provenance.js';

export const PARSER_VERSION = 'eup.census/1';
export const SOURCE_ID = 'census_tiger';
const RIGHTS = 'census-public-domain-2026-11';
const FILE = /tl_(\d{4})_(\d{2})_(place|county|state|cd\d*|sldu|sldl)\.zip/i;

/* Accepts either the HTML index text or an array of {name,modified,size}. */
export function parseCensusTigerListing(input, { fetched_at, raw_hash = null, jurisdictionByFips = {} }) {
  const entries = Array.isArray(input) ? input : [...String(input || '').matchAll(/href="(tl_\d{4}_\d{2}_[a-z0-9]+\.zip)"[^<]*<\/a>\s*(\d{4}-\d{2}-\d{2})?[^\n]*?(\d+[KM]?)?/gi)].map((m) => ({ name: m[1], modified: m[2] || null, size: m[3] || null }));
  const out = [];
  for (const e of entries) {
    const m = FILE.exec(e.name || '');
    if (!m) continue;
    const [, vintage, fips, layer] = m;
    const jurisdiction = jurisdictionByFips[fips];
    out.push(intakeRecord(`tiger:${vintage}:${fips}:${layer.toLowerCase()}`, {
      jurisdiction_external_id: jurisdiction || null, vintage, layer: layer.toLowerCase(), state_fips: fips,
      effective_from: `${vintage}-01-01`, effective_to: null, geometry_ref: null, file: e.name, size: e.size || null,
      validated: false
    }, provenance({ source_id: SOURCE_ID, source_record_id: `tiger:${e.name}`, url: `https://www2.census.gov/geo/tiger/TIGER${vintage}/${layer.toUpperCase()}/${e.name}`, fetched_at, upstream_updated_at: e.modified || null, parser_version: PARSER_VERSION, rights_revision: RIGHTS, coverage: 'partial' }), raw_hash));
  }
  return out;
}
