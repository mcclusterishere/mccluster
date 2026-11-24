/* window.MCC_SITE for tests, read the way a page reads it: the generated block at the top of js/shell-boot.js run in a
   sandbox that holds nothing but window (today's record), or the same block rendered by tools/build-site-hosts.mjs for
   another record or stage: the equityuprise rewrite of SPEC-PLATFORM 2.3 (platform.origin https://equityuprise.com,
   mccluster.org McCluster Corp's own tenant), the rehearsal scripts/test/site-hosts.test.mjs runs on the generated table,
   or a later stage of today's record (P1: the platform serves everything). */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { findClientBlock, renderClientBlock, siteTable, readRecord } from '../../../tools/build-site-hosts.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const NEXT = 'https://equityuprise.com';
export const COMPANY = 'https://mccluster.org';
export const PROFILE = 'https://matthew.mccluster.org';

export function siteFromBlock(text) {
  const window = {};
  vm.runInNewContext(text, { window });
  return window.MCC_SITE;
}
/* what every page that loads js/shell-boot.js reads today */
export function shippedSite(root = ROOT) {
  const found = findClientBlock(readFileSync(join(root, 'js/shell-boot.js'), 'utf8'));
  if (!found) throw new Error('js/shell-boot.js carries no generated site-hosts block');
  return siteFromBlock(found.text);
}
/* the block rendered for a record at a stage (the record's own stage when none is named) */
export function siteFor(record, stage) {
  return siteFromBlock(renderClientBlock(siteTable(record, stage ? { stage } : {})));
}
/* today's record at a later stage */
export function stageSite(stage, root = ROOT) {
  return siteFor(readRecord(root), stage);
}
/* the record rewritten for stage F, as scripts/test/site-hosts.test.mjs rewrites it */
export function equityupriseRecord(record = readRecord(ROOT)) {
  const F = JSON.parse(JSON.stringify(record));
  if (F.platform.next.origin !== NEXT) throw new Error('the record no longer names the next platform');
  F.platform.origin = NEXT;
  F.platform.website_id = `${NEXT}/#website`;
  F.platform.site_name = 'Equity Uprise';
  F.platform.own_paths = { generated: ['/robots.txt', '/sitemap.xml', '/llms.txt'], subtrees: [] };
  F.tenants.company = { host: 'mccluster.org', entity: record.entities.mccluster_corp.id, website_id: `${COMPANY}/#website`, site_name: 'McCluster Corp', root: '/company', sets: [], own_paths: { generated: ['/company'], subtrees: ['/news'] } };
  F.doors = {
    'www.equityuprise.com': { to: 'platform', served_by: 'worker:mccluster', state: 'routed', api_cors: false },
    'www.mccluster.org': { to: 'tenants.company', served_by: 'worker:mccluster', state: 'routed', api_cors: false },
    'humanuprise.com': record.doors['humanuprise.com'],
    'www.humanuprise.com': record.doors['www.humanuprise.com'],
    'here.mccluster.org': record.doors['here.mccluster.org']
  };
  return F;
}
export function equityupriseSite(stage = 'P1', root = ROOT) {
  return siteFor(equityupriseRecord(readRecord(root)), stage);
}
/* a record whose profile host lives under another registrable domain: proves a value is read from the table, never
   from a literal that happens to agree with today's */
export function elsewhereRecord(record = readRecord(ROOT)) {
  const X = JSON.parse(JSON.stringify(record));
  X.platform.origin = 'https://platform.example';
  X.platform.website_id = 'https://platform.example/#website';
  X.platform.static_origin = 'https://me.profile.example';
  X.tenants.matthew.host = 'me.profile.example';
  X.doors = { 'www.platform.example': { to: 'platform', served_by: 'worker:mccluster', state: 'routed', api_cors: false } };
  return X;
}
export function elsewhereSite(stage = 'P0', root = ROOT) {
  return siteFor(elsewhereRecord(readRecord(root)), stage);
}
