/* A failed subprocess must say why, in the row the digest reads.
   ============================================================
   The first autonomous code_patch run recorded exactly
   "/usr/local/bin/opencode exited with 1" and nothing else. True,
   useless, and undiagnosable without SSH to the node — which is the
   one thing an autonomous loop is supposed to save you. run() already
   carries the child's streams on error.result; failJob simply dropped
   them. These pin that they survive, and that they stay short enough
   to belong in a report. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'supabase.mjs');

test('failJob keeps a tail of what the process actually said', async () => {
  const src = await readFile(SRC, 'utf8');
  assert.match(src, /function failureDetail\(error\)/,
    'a failed subprocess must contribute its output to last_error');
  assert.match(src, /\$\{failureDetail\(error\)\}/,
    'failJob must actually call it');
  assert.match(src, /result\.stderr/, 'stderr is where a failing CLI explains itself');
});

test('the detail is bounded, because last_error is read in a digest', async () => {
  const src = await readFile(SRC, 'utf8');
  const fn = /function failureDetail\(error\)[\s\S]*?\n\}/.exec(src);
  assert.ok(fn, 'failureDetail not found');
  const caps = [...fn[0].matchAll(/tail\([^,]+,\s*(\d+)\)/g)].map((m) => Number(m[1]));
  assert.ok(caps.length >= 2, 'both streams should be capped');
  for (const cap of caps) {
    assert.ok(cap > 0 && cap <= 2000, `tail cap ${cap} is not digest-sized`);
  }
  assert.match(src, /const message = `\$\{String\(error\?\.message[\s\S]*?\.slice\(0, 4000\)/,
    'the whole message must still be clamped before it reaches the column');
});
