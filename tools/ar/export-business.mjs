#!/usr/bin/env node
// Export one fictional business from the canonical city manifest into the Unity AR client's
// StreamingAssets, so the phone app can render the storefront offline.
//
//   node tools/ar/export-business.mjs                       # gauranfucking-tea (Phase A storefront)
//   node tools/ar/export-business.mjs --id <business-id>    # any business, v1 or expansion
//   node tools/ar/export-business.mjs --check               # exit 1 if the committed snapshot drifted
//
// The source of truth stays core/data/fictional-city/district.v1.json. This file only selects and
// copies fields; it never authors lore. The published copy at
// https://matthew.mccluster.org/data/fictional-city/district.v1.json is byte-identical to the source
// (tools/publish-fictional-city.mjs does not reserialize), so source.sha256 lets the app tell whether
// its snapshot came from the manifest that is live.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOURCE = 'core/data/fictional-city/district.v1.json';
export const OUT_DIR = 'ar/Assets/StreamingAssets/fictional-city/businesses';
export const SCHEMA = 'mccluster.ar-business/v1';
export const DEFAULT_ID = 'gauranfucking-tea';

const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]));

/** Build the snapshot object for one business. Pure: same manifest bytes, same output. */
export function buildBusinessExport(manifestBytes, id = DEFAULT_ID) {
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schema !== 'mccluster.fictional-city/v1') throw new Error('Unexpected city manifest schema: ' + manifest.schema);
  const all = (key) => Array.isArray(manifest[key]) ? manifest[key] : [];
  const business = [...all('businesses'), ...all('expansionBusinesses')].find(b => b.id === id);
  if (!business) throw new Error('No business with id ' + id);
  const brandId = business.brandId || id;
  const brand = all('brands').find(b => b.id === brandId) || null;
  const people = [...all('npcs'), ...all('expansionNpcs')];
  const staff = Array.isArray(business.staffIds) && business.staffIds.length
    ? business.staffIds.map(sid => {
        const p = people.find(n => n.id === sid);
        if (!p) throw new Error(`Business ${id} names staff ${sid}, who is not in the manifest`);
        return p;
      })
    : people.filter(n => n.businessId === id && n.placement !== 'route');
  const goods = [...all('items'), ...all('expansionItems')];
  const items = Array.isArray(business.itemIds) && business.itemIds.length
    ? business.itemIds.map(iid => goods.find(i => i.id === iid)).filter(Boolean)
    : goods.filter(i => i.businessId === id);

  return {
    schema: SCHEMA,
    source: {
      path: SOURCE,
      publishedUrl: 'https://matthew.mccluster.org/data/fictional-city/district.v1.json',
      manifestSchema: manifest.schema,
      revision: manifest.revision,
      sha256: createHash('sha256').update(manifestBytes).digest('hex'),
    },
    business: pick(business, ['id', 'brandId', 'name', 'category', 'tagline', 'description', 'color', 'ads', 'interior', 'staffIds', 'itemIds']),
    brand: brand ? pick(brand, ['id', 'name', 'tagline', 'summary']) : null,
    staff: staff.map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      placement: p.placement,
      greeting: p.dialogue?.greeting ?? null,
      farewell: p.dialogue?.farewell ?? null,
    })),
    items: items.map(i => pick(i, ['id', 'name', 'description', 'kind', 'price'])),
  };
}

export const serialize = (obj) => JSON.stringify(obj, null, 2) + '\n';
export const outPath = (id, root = ROOT) => resolve(root, OUT_DIR, id + '.json');

/** The parts of a snapshot that must equal the manifest. source.revision/sha256 are provenance:
 *  they record which manifest the snapshot came from and are allowed to lag unrelated city edits. */
export function comparable(snapshot) {
  const { source, ...rest } = snapshot;
  return { ...rest, source: { path: source.path, publishedUrl: source.publishedUrl, manifestSchema: source.manifestSchema } };
}

async function main(argv) {
  const idIx = argv.indexOf('--id');
  const id = idIx >= 0 ? argv[idIx + 1] : DEFAULT_ID;
  if (!id || !/^[a-z0-9-]+$/.test(id)) throw new Error('Business id must be lowercase letters, digits and hyphens');
  const bytes = await readFile(resolve(ROOT, SOURCE));
  const snapshot = buildBusinessExport(bytes, id);
  const target = outPath(id);
  if (argv.includes('--check')) {
    const committed = JSON.parse(await readFile(target, 'utf8'));
    const same = JSON.stringify(comparable(committed)) === JSON.stringify(comparable(snapshot));
    if (!same) {
      console.error(`${target} no longer matches ${SOURCE}. Run: node tools/ar/export-business.mjs --id ${id}`);
      process.exit(1);
    }
    console.log(`ok ${id} matches ${SOURCE}`);
    return;
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, serialize(snapshot));
  console.log(`wrote ${target} (${snapshot.staff.length} staff, ${snapshot.items.length} items, manifest ${snapshot.source.sha256.slice(0, 12)})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(err => { console.error(err.message); process.exit(1); });
}
