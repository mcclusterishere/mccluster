// The contribution contract (COMPUTE-CONTRIBUTION-LEDGER.md) lives on branch
// prime/contribution-ledger. While the file is absent from this tree, every
// place that cites it must name that branch right there, so no reader is sent
// to a path that does not exist in this checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CONTRACT = 'COMPUTE-CONTRIBUTION-LEDGER.md';
const BRANCH = 'prime/contribution-ledger';
const FILES = [
  'core/src/compute/node-agent-config.mjs',
  'core/src/compute/node-agent.mjs',
  'core/src/compute/ollama-adapter.mjs',
  'core/windows/mccluster-node.ps1',
  'core/windows/tests/mccluster-node.tests.ps1',
  'desktop/windows/PROOF-MODE.md',
  'desktop/windows/README.md',
  'desktop/windows/src/Contribution.cs',
  'desktop/windows/src/LocalJobs.cs',
  'desktop/windows/src/Program.cs',
  'desktop/windows/src/StatusPanel.cs',
  'desktop/windows/tests/DesktopTests.cs',
  'docs/control-plane/WINDOWS-NODE.md'
];

test('every citation of the contribution contract names the branch it lives on while the file is not in this tree', () => {
  const present = fs.existsSync(path.join(ROOT, 'docs', 'control-plane', CONTRACT));
  let citations = 0;
  for (const relative of FILES) {
    const lines = fs.readFileSync(path.join(ROOT, relative), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.includes(CONTRACT)) return;
      citations += 1;
      if (present) return;
      const nearby = lines.slice(Math.max(0, index - 3), index + 4).join('\n');
      assert.ok(nearby.includes(BRANCH), `${relative}:${index + 1} cites ${CONTRACT} without naming branch ${BRANCH} within three lines`);
    });
  }
  assert.ok(citations >= FILES.length, `each listed file cites the contract (${citations} citations in ${FILES.length} files)`);
  if (!present) {
    for (const doc of ['desktop/windows/PROOF-MODE.md', 'desktop/windows/README.md', 'docs/control-plane/WINDOWS-NODE.md']) {
      assert.match(fs.readFileSync(path.join(ROOT, doc), 'utf8').replace(/\s+/g, ' '), /not in this tree/i, `${doc} says plainly that the contract file is not in this tree`);
    }
  }
});
