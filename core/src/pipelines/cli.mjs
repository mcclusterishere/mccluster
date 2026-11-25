#!/usr/bin/env node
// node src/pipelines/cli.mjs --source gmail|calendar|stripe [--fixture file.json] [--write] [--mode initial|incremental|replay|manual]
// Default is a dry run into memory. --write calls the owner-gated Supabase RPCs (needs the pending SQL applied).
// Prints counts only.
import { runSourcePipeline } from './run.mjs';
import { createMemorySink, createSupabaseSink } from './sink.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
}

const source = arg('source');
const write = process.argv.includes('--write');
let sink;
if (write) {
  const { rest } = await import('../supabase.mjs');
  sink = createSupabaseSink({ orgId: process.env.MCCLUSTER_ORG_ID, actorId: process.env.MCCLUSTER_OWNER_PROFILE_ID, rest });
} else {
  sink = createMemorySink();
}
try {
  const out = await runSourcePipeline({ source, sink, fixture: arg('fixture'), mode: arg('mode') || 'incremental' });
  console.log(JSON.stringify(out));
} catch (err) {
  console.error(JSON.stringify({ source, error: err.message, code: err.code || null }));
  process.exitCode = 1;
}
