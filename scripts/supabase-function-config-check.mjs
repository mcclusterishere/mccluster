import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const functionsDir = path.join(root, 'supabase', 'functions');
const configPath = path.join(root, 'supabase', 'config.toml');

const dirs = fs.readdirSync(functionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
  .map((entry) => entry.name)
  .sort();

const config = fs.readFileSync(configPath, 'utf8');
const configured = new Map();
const lines = config.split(/\r?\n/);
let current = null;

for (const line of lines) {
  const header = line.match(/^\[functions\.([^\]]+)\]$/);
  if (header) {
    current = header[1];
    if (configured.has(current)) throw new Error(`duplicate function config: ${current}`);
    configured.set(current, null);
    continue;
  }
  const verify = line.match(/^verify_jwt\s*=\s*(true|false)\s*$/);
  if (verify && current) configured.set(current, verify[1] === 'true');
}

const missing = dirs.filter((name) => !configured.has(name));
const stale = [...configured.keys()].filter((name) => !dirs.includes(name));

if (missing.length || stale.length) {
  if (missing.length) console.error('Function directories missing config.toml entries:', missing.join(', '));
  if (stale.length) console.error('config.toml entries without matching function directories:', stale.join(', '));
  process.exit(1);
}

for (const name of dirs) {
  if (typeof configured.get(name) !== 'boolean') {
    console.error(`Function ${name} does not declare verify_jwt explicitly`);
    process.exit(1);
  }
}

console.log(`Supabase function auth manifest complete: ${dirs.length} functions`);
