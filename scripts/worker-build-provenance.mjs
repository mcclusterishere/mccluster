import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Wrangler runs this in its configuration directory. This ignored build input
// identifies the bundled checkout even when the deployer sets no DEPLOY_SHA.
const output = path.resolve('.wrangler/build-provenance.mjs');
await rm(output, { force: true });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sha = git('rev-parse', '--verify', 'HEAD');
if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Cannot identify the Worker checkout');
const dirty = Boolean(git('status', '--porcelain', '--untracked-files=no'));
const ref = process.env.GITHUB_REF_NAME || git('rev-parse', '--abbrev-ref', 'HEAD');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `export const build = ${JSON.stringify({ sha, ref, dirty })};\n`);
console.log(`Worker build provenance: ${sha}${dirty ? ' (modified checkout; health will report unknown)' : ''}`);
