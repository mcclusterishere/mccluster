import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const here = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.resolve(here, '../sql');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

await client.connect();
try {
  const files = (await fs.readdir(sqlDir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(sqlDir, file), 'utf8');
    console.log(`Applying ${file}`);
    await client.query(sql);
  }
  console.log('Migrations complete');
} finally {
  await client.end();
}
