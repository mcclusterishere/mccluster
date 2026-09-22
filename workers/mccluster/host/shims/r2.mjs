/* ============================================================
   R2, backed by the local filesystem.

   src/seek-first/archive.js uses exactly five methods -- put, get, head,
   list, delete -- so that is what this implements. Nothing more: a
   broader fake invites code that leans on behaviour the filesystem
   cannot honour.

   WHAT DIFFERS FROM R2, and it matters for how you run this:

     Durability.  R2 replicates. A directory on one VPS does not. This
                  archive is now yours to back up, and backup-mail.sh is
                  not covering it -- it backs up the mail store only.
     Concurrency. put() writes to a temp file and renames, so a reader
                  never sees a half-written object. Two simultaneous puts
                  to the same key still resolve to whichever rename lands
                  second, same as R2.
     Listing.     Lexicographic by key, like R2, because the cursor
                  contract depends on stable ordering.
   ============================================================ */
import { mkdir, writeFile, readFile, stat, rm, rename, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = process.env.R2_ARCHIVE_DIR || '/var/lib/mccluster/seek-first-archive';

/* Keys may contain '/', which is what makes them look like paths. They
   must not be able to contain '..', which is what would make them escape
   one. */
function safePath(key) {
  const k = String(key).replace(/^\/+/, '');
  if (!k || k.split('/').some((seg) => seg === '..' || seg === '.')) {
    throw new Error(`unsafe object key: ${key}`);
  }
  return join(ROOT, ...k.split('/'));
}

const metaPath = (p) => `${p}.r2meta.json`;

async function readMeta(p) {
  try { return JSON.parse(await readFile(metaPath(p), 'utf8')); } catch { return {}; }
}

function objectFor(key, bytes, meta, st) {
  return {
    key,
    size: st.size,
    etag: meta.etag,
    httpEtag: `"${meta.etag}"`,
    uploaded: st.mtime,
    httpMetadata: meta.httpMetadata || {},
    customMetadata: meta.customMetadata || {},
    body: bytes ? new Blob([bytes]).stream() : undefined,
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
    async text() { return Buffer.from(bytes).toString('utf8'); },
    async json() { return JSON.parse(Buffer.from(bytes).toString('utf8')); },
  };
}

export function makeR2Bucket() {
  return {
    async put(key, value, options = {}) {
      const p = safePath(key);
      await mkdir(dirname(p), { recursive: true });
      const bytes = Buffer.isBuffer(value) ? value
        : value instanceof ArrayBuffer ? Buffer.from(value)
        : ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        : Buffer.from(String(value));
      const etag = createHash('md5').update(bytes).digest('hex');
      // temp + rename, so a concurrent get() never reads a partial object
      const tmp = `${p}.${randomUUID()}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, p);
      await writeFile(metaPath(p), JSON.stringify({
        etag,
        httpMetadata: options.httpMetadata || {},
        customMetadata: options.customMetadata || {},
      }));
      const st = await stat(p);
      return objectFor(key, null, { etag, ...options }, st);
    },

    async get(key) {
      const p = safePath(key);
      try {
        const [bytes, st, meta] = await Promise.all([readFile(p), stat(p), readMeta(p)]);
        return objectFor(key, bytes, meta, st);
      } catch { return null; }
    },

    async head(key) {
      const p = safePath(key);
      try {
        const [st, meta] = await Promise.all([stat(p), readMeta(p)]);
        return objectFor(key, null, meta, st);
      } catch { return null; }
    },

    async delete(key) {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) {
        const p = safePath(k);
        await rm(p, { force: true });
        await rm(metaPath(p), { force: true });
      }
    },

    async list({ prefix = '', limit = 1000, cursor } = {}) {
      const found = [];
      async function walk(dir) {
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const full = join(dir, e.name);
          if (e.isDirectory()) { await walk(full); continue; }
          if (e.name.endsWith('.r2meta.json') || e.name.endsWith('.tmp')) continue;
          found.push(relative(ROOT, full).split(sep).join('/'));
        }
      }
      await walk(ROOT);
      // Lexicographic, because the cursor below is a key and only means
      // anything against a stable order.
      const keys = found.filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? keys.findIndex((k) => k > cursor) : 0;
      const page = keys.slice(start < 0 ? keys.length : start, (start < 0 ? keys.length : start) + limit);
      const objects = [];
      for (const k of page) {
        const p = safePath(k);
        const [st, meta] = await Promise.all([stat(p), readMeta(p)]);
        objects.push(objectFor(k, null, meta, st));
      }
      const truncated = start >= 0 && start + limit < keys.length;
      return { objects, truncated, cursor: truncated ? page[page.length - 1] : undefined };
    },
  };
}
