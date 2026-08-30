// DOMAIN CHECK — is this address free, and what does it cost.
//
// Public, unauthenticated, and read-only: it takes a name, asks the
// registries, and answers. It never writes a customer record, never
// takes money, and never returns anything it did not get from a
// registry or from public.domain_tlds.
//
// The price it returns is the DATABASE's price. The browser is told
// what an address costs; it is never asked. checkout/index.ts remains
// the only thing that decides what a card gets charged, and it prices
// the offering row, not this answer — so a tampered response here
// changes what a visitor is SHOWN and cannot change what they PAY.
//
// Deploy with JWT verification OFF: a visitor who has not signed in is
// exactly the person typing in this box.

import {
  type Candidate, callerIp, candidates, clientKey, normalize, rank, rdapUrl, readRdap,
} from "./domain.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// A salt that changes when the deployment does is fine — the throttle
// only needs buckets to be stable for a minute, and a rotating salt
// means yesterday's table cannot be matched against today's.
const SALT = Deno.env.get("DOMAIN_RATE_SALT") ?? SRV.slice(-24);

const RATE_LIMIT = Number(Deno.env.get("DOMAIN_RATE_LIMIT") ?? 40);
const CACHE_HOURS = 6;
const RDAP_TIMEOUT_MS = 8000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const db = (path: string, init?: RequestInit) =>
  fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SRV,
      Authorization: `Bearer ${SRV}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

type Tld = { tld: string; sellable: boolean; price_usd: string | number | null; note: string | null };

/* The list, re-read at most once a minute. An isolate lives for a few
   requests, so this is a cheap win rather than a cache to reason about;
   a TLD added in the database is live within the minute either way. */
let tldCache: { at: number; rows: Tld[] } | null = null;
async function tlds(): Promise<Tld[]> {
  if (tldCache && Date.now() - tldCache.at < 60_000) return tldCache.rows;
  const r = await db("domain_tlds?enabled=eq.true&select=tld,sellable,price_usd,note&order=sellable.desc,tld.asc");
  const rows = (await r.json().catch(() => [])) as Tld[];
  if (Array.isArray(rows) && rows.length) tldCache = { at: Date.now(), rows };
  return tldCache?.rows ?? [];
}

/* ONE ADDRESS, ONE ANSWER, THROUGH THE CACHE.

   A miss costs an outbound request to a registry that rate-limits, so
   a hit is not an optimisation here, it is the thing that keeps the
   feature working when a page gets shared. An UNKNOWN is cached for
   two minutes rather than six hours: a registry having a bad moment
   should not make an address unanswerable for the afternoon. */
async function look(name: string): Promise<{ available: boolean | null; cached: boolean }> {
  const hit = await db(`domain_lookups?name=eq.${encodeURIComponent(name)}&expires_at=gt.${new Date().toISOString()}&select=available,hits`)
    .then((r) => r.json()).catch(() => []);
  if (Array.isArray(hit) && hit.length) {
    // fire-and-forget: a hit count is worth having and never worth waiting for
    db(`domain_lookups?name=eq.${encodeURIComponent(name)}`, {
      method: "PATCH", body: JSON.stringify({ hits: (hit[0].hits ?? 0) + 1 }),
    }).catch(() => {});
    return { available: hit[0].available ?? null, cached: true };
  }

  /* ONE RETRY, AND ONLY FOR THE ANSWERS THAT ARE NOT ANSWERS.
     Three lookups leave here at once and the bootstrap service in
     front of the registries throttles bursts, so a first attempt can
     come back 429 for a name that is plainly free. A 200 or a 404 is
     the registry speaking and is never retried; everything else gets
     one more go after a breath, which turns most unknowns back into
     real answers without turning one search into six requests. */
  let status = 0, body: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 700));
    try {
      const res = await fetch(rdapUrl(name), {
        headers: { Accept: "application/rdap+json, application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(RDAP_TIMEOUT_MS),
      });
      status = res.status;
      body = await res.json().catch(() => null);
    } catch {
      status = 0;
      body = null;
    }
    if (readRdap(status, body) !== "unknown") break;
  }

  const verdict = readRdap(status, body);
  const available = verdict === "unknown" ? null : verdict === "available";
  const ttlMs = verdict === "unknown" ? 2 * 60_000 : CACHE_HOURS * 3600_000;

  await db("domain_lookups?on_conflict=name", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      name,
      tld: name.slice(name.lastIndexOf(".") + 1),
      available,
      status,
      source: "rdap",
      checked_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
      hits: 1,
    }),
  }).catch(() => {});

  return { available, cached: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const { name } = await req.json().catch(() => ({}));

  const parsed = normalize(name);
  if (!parsed.ok) return json({ ok: false, reason: parsed.reason, results: [] }, 200);

  // THE THROTTLE RUNS BEFORE THE LOOKUP, NOT AFTER.
  // A limiter that counts requests it has already paid for is a
  // counter, not a limiter.
  const key = await clientKey(callerIp(req.headers), SALT);
  const allowed = await db("rpc/domain_rate_take", {
    method: "POST",
    body: JSON.stringify({ p_client: key, p_limit: RATE_LIMIT }),
  }).then((r) => r.json()).catch(() => true);
  if (allowed === false) {
    return json({ ok: false, reason: "Give it a second — that is a lot of looking up at once.", results: [] }, 429);
  }

  const list = await tlds();
  const wanted = candidates(parsed, list);

  if (!wanted.length) {
    return json({
      ok: false,
      reason: parsed.tld
        ? "." + parsed.tld + " is not one we register. Try .com, .net or .org — or send the name and it gets set up for you."
        : "Nothing to check.",
      results: [],
    }, 200);
  }

  const byTld = new Map(list.map((t) => [t.tld, t]));

  const results: Candidate[] = await Promise.all(wanted.map(async (n) => {
    const tld = n.slice(n.lastIndexOf(".") + 1);
    const t = byTld.get(tld);
    const { available, cached } = await look(n);
    return {
      name: n,
      tld,
      available,
      sellable: !!t?.sellable,
      price: t?.price_usd == null ? null : Number(t.price_usd),
      note: t?.note ?? null,
      cached,
    };
  }));

  results.sort(rank);

  return json({ ok: true, query: parsed.label + (parsed.tld ? "." + parsed.tld : ""), results });
});
