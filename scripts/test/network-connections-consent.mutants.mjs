// Mutants of the pending consent guard: each statement of
// supabase/pending/20261119062110_network_connections_consent_guard_v1.sql removed in turn must fail a check. Writes each
// mutant to a temporary folder beside the unchanged rollback and runs the proofs on it through
// NETWORK_CONNECTIONS_CONSENT_DIR: the static checks (network-connections-consent-sql.test.mjs), the PGlite proof and,
// when a disposable server is allowed, the native proof. The file as it is must pass every one of them.
//
//   PGLITE_MODULE=<PGlite 0.3.14 dist/index.js> node scripts/test/network-connections-consent.mutants.mjs
//   (add ALLOW_LOCAL_EUP_DB_TESTS=1 PG_BIN=<PostgreSQL 16 or 17 bin> PG_MODULE=<node-postgres> for the native proof)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIX_FILE, ROLLBACK_FILE, fixSql, rollbackSql, splitStatements } from './support/network-connections-database.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const runners = [
  ['static', ['--test', join(here, 'network-connections-consent-sql.test.mjs')]],
  ['PGlite', [join(here, 'network-connections-consent.integration.mjs')]]
];
if (process.env.ALLOW_LOCAL_EUP_DB_TESTS === '1' && process.env.PG_BIN) runners.push(['native', [join(here, 'network-connections-consent.native.integration.mjs')]]);

const fix = await fixSql();
const rollback = await rollbackSql();
const variants = [['the file as it is', fix],
  ...splitStatements(fix).map((s, i) => [`without #${i + 1} ${s.text.split('\n')[0].slice(0, 72)}`, fix.slice(0, s.start) + fix.slice(s.end)])];

let wrong = 0;
for (const [label, text] of variants) {
  const dir = mkdtempSync(join(tmpdir(), 'nc-consent-mutant-'));
  try {
    writeFileSync(join(dir, FIX_FILE), text);
    writeFileSync(join(dir, ROLLBACK_FILE), rollback);
    const results = runners.map(([name, args]) => {
      const r = spawnSync(process.execPath, args, { env: { ...process.env, NETWORK_CONNECTIONS_CONSENT_DIR: dir }, encoding: 'utf8', timeout: 180000 });
      return [name, r.status === 0 ? 'passes' : 'fails'];
    });
    const failed = results.filter(([, r]) => r === 'fails').map(([name]) => name);
    const asExpected = label === 'the file as it is' ? failed.length === 0 : failed.length > 0;
    if (!asExpected) wrong += 1;
    console.log(`${asExpected ? 'ok' : 'NOT OK'}  ${label}: ${results.map(([name, r]) => `${name} ${r}`).join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(wrong ? `network-connections-consent mutants: ${wrong} not as expected` : `network-connections-consent mutants: the file passes; each of ${variants.length - 1} mutants fails a check`);
process.exit(wrong ? 1 : 0);
