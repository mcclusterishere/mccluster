// Invoked only inside mccluster-preview-build@.service's restricted namespace.
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
const root = '/build';
const { directory } = JSON.parse(await readFile(`${root}/.mccluster-preview-build.json`, 'utf8'));
if (typeof directory !== 'string' || directory.includes('\\') || directory.split('/').includes('..')) throw new Error('Invalid build directory');
const cwd = resolve(root, directory);
if (cwd !== root && !cwd.startsWith(root + sep)) throw new Error('Build path escaped worktree');
await readFile(`${cwd}/package-lock.json`); // Reproducible dependency installation is mandatory.
async function npm(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/npm', args, { cwd, shell: false, stdio: 'inherit',
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', CI: '1' } });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Preview build failed (${code})`)));
  });
}
await npm(['ci','--ignore-scripts','--no-audit','--no-fund']);
await npm(['run','build']);
