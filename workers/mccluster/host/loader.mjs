/* ============================================================
   The two things Wrangler does to the module graph that Node does not.

   1. `cloudflare:workers` resolves to a real module on the Workers
      runtime. src/here-tenant-agent.js imports DurableObject from it at
      the top level, so without this the ENTIRE graph fails to load --
      not just the Durable Object part, but the 95% of the API that never
      touches one.

   2. wrangler.toml declares a [[rules]] block of type "Text" globbing
      every .html file (written out in wrangler.toml -- not repeated
      literally here, because the glob contains a star-slash and would
      close this comment),
      which makes `import html from './console.html'` yield the file's
      contents as a string. Node refuses the extension outright. This
      reproduces that rule rather than working around it, so the same
      import means the same thing on both hosts.

   Registered through host/register.mjs (--import), which is what gets
   these hooks in front of the whole graph.
   ============================================================ */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIM = pathToFileURL(join(HERE, 'shims', 'cloudflare-workers.mjs')).href;

const TEXT_EXTENSIONS = /\.(html|txt|sql|md)$/i;

export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: SHIM, shortCircuit: true };
  if (TEXT_EXTENSIONS.test(specifier)) {
    const parent = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : process.cwd();
    const url = specifier.startsWith('.')
      ? pathToFileURL(join(parent, specifier)).href
      : (await next(specifier, context)).url;
    return { url, format: 'module', shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (process.env.LOADER_TRACE) console.error('[load]', url);
  if (TEXT_EXTENSIONS.test(url)) {
    const text = await readFile(fileURLToPath(url), 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(text)};`,
    };
  }
  return next(url, context);
}
