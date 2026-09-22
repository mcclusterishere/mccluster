/* ============================================================
   PARITY — does the Node host answer like Cloudflare does?

   This is the instrument the whole migration turns on. Run it against
   both hosts, fix what differs, and only move the DNS when it is quiet.

   IT ONLY PROBES ENDPOINTS THAT ARE SAFE TO PROBE. Every request here is
   a GET with no credentials, because pointing a comparison harness at
   authenticated or mutating routes means writing to production twice and
   calling the mess "parity".

   Fields that are EXPECTED to differ are named and ignored rather than
   quietly normalised away -- a diff tool that hides differences by
   default is how a real one gets missed.
   ============================================================ */
const A = process.env.PARITY_A || 'https://api.mccluster.org';
const B = process.env.PARITY_B || 'http://127.0.0.1:8788';

/* Legitimately different between the two hosts. */
const VOLATILE = new Set([
  'checked_at',      // timestamp
  'deployment_ref',  // how the SHA was stamped, not what is running
  'now', 'timestamp', 'generated_at', 'request_id', 'trace_id',
]);

const PATHS = [
  '/healthz',
  '/v1/health',
  '/v1/does-not-exist',              // 404 shape matters as much as 200s
];

function strip(v) {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v)
      .filter(([k]) => !VOLATILE.has(k))
      .map(([k, x]) => [k, strip(x)]));
  }
  return v;
}

async function probe(base, path) {
  const started = Date.now();
  try {
    const res = await fetch(base + path, { headers: { accept: 'application/json' } });
    const text = await res.text();
    let body; try { body = strip(JSON.parse(text)); } catch { body = text.slice(0, 400); }
    return { status: res.status, type: res.headers.get('content-type') || '', body, ms: Date.now() - started };
  } catch (e) {
    return { status: 0, error: e.message, ms: Date.now() - started };
  }
}

let differences = 0;
console.log(`A  ${A}\nB  ${B}\n`);

for (const path of PATHS) {
  const [a, b] = await Promise.all([probe(A, path), probe(B, path)]);
  const same = a.status === b.status && JSON.stringify(a.body) === JSON.stringify(b.body);
  if (same) {
    console.log(`  same   ${path.padEnd(24)} ${a.status}   (${a.ms}ms / ${b.ms}ms)`);
  } else {
    differences++;
    console.log(`  DIFF   ${path}`);
    console.log(`     A  ${a.status} ${JSON.stringify(a.body ?? a.error).slice(0, 220)}`);
    console.log(`     B  ${b.status} ${JSON.stringify(b.body ?? b.error).slice(0, 220)}`);
  }
}

console.log(`\n${PATHS.length - differences}/${PATHS.length} identical`);
if (differences) {
  console.log('\nNot ready to cut over. Each difference is something a caller would see.');
  process.exit(1);
}
console.log('\nParity on the probed routes. Note this covers unauthenticated GETs only;');
console.log('the authenticated surface still needs a real client exercised against B.');
