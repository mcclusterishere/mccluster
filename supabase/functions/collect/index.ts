// COLLECT — the house's own eyes, and the only writer of public.events.
//
// This is what replaces Google Analytics. Not a wrapper around it, not a
// mirror of it: the collector itself, on the platform's own infrastructure,
// writing to the platform's own table, readable by the owner without asking
// anyone's permission or logging into anyone's dashboard.
//
// WHY THIS EXISTS AT ALL, RATHER THAN THE BROWSER POSTING STRAIGHT TO THE
// TABLE — WHICH IS WHAT USED TO HAPPEN.
//
// A page cannot see its own IP address. There is no API for it, and every
// client-side trick for getting one is a request to somebody else's server,
// which is precisely the dependency this removes. The address exists in
// exactly one place: on the request, at the edge. So the server has to be the
// writer, and once it is, three other things stop being claims and start
// being observations — the address, the user agent, and the country. A
// visitor can lie about all three from a console; they cannot lie about them
// here.
//
// WHAT IS STILL THE CLIENT'S WORD. device_id and session_id are minted in the
// browser and taken as given. They identify a browser store, not a person,
// and a forged one costs a smudged funnel and nothing else. The columns are
// commented as such in the migration so nobody later mistakes them for
// identity.
//
// Deploy with JWT verification OFF. Most traffic is anonymous and anonymous
// traffic is most of what there is to learn. A signed-in visitor sends their
// token anyway, and it is verified below rather than believed.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// A batch is a page's worth of intent, not a firehose. Past these, something
// is wrong or someone is playing, and either way the answer is the same.
const MAX_EVENTS = 50;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_NAME = 120;
const MAX_PATH = 300;
const MAX_REF = 500;
const MAX_UA = 500;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // THE LAST BATCH OF A VISIT IS SENT WHILE THE PAGE IS BEING TORN DOWN.
  // It carries an apikey header, so it is preflighted, and a preflight
  // started at that moment frequently does not finish — which would lose
  // precisely the events that say what somebody did last. Caching the
  // preflight for a day means the first batch of the visit pays for it
  // and the goodbye batch reuses the answer.
  "Access-Control-Max-Age": "86400",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type Headers_ = { get(k: string): string | null };

// Same precedence domain-check uses, so the house has one answer to "who is
// calling". x-forwarded-for is a list and the client-controlled entries are on
// the right; the leftmost is the one the edge put there.
function callerIp(h: Headers_): string | null {
  const xff = h.get("x-forwarded-for") || "";
  const first = xff.split(",")[0].trim();
  return first || h.get("cf-connecting-ip") || h.get("x-real-ip") || null;
}

// Geo is whatever the edge chose to tell us, and which edge is serving this
// varies. Cloudflare always sends the country and sends region/city/ASN on
// some plans; Deno Deploy uses different names again; Fly and Vercel others.
// Ask for all of them, accept none of them, never guess — and keep the raw
// header set in `edge` so the next widening of this function is driven by what
// actually arrived in production rather than by what the docs promised.
const GEO_HEADERS = [
  "cf-ipcountry", "cf-region", "cf-region-code", "cf-ipcity", "cf-postal-code",
  "cf-iplatitude", "cf-iplongitude", "cf-timezone", "cf-ipcontinent",
  "cf-asn", "cf-as-organization", "cf-ray", "cf-ipasnum",
  "x-vercel-ip-country", "x-vercel-ip-country-region", "x-vercel-ip-city",
  "x-vercel-ip-latitude", "x-vercel-ip-longitude", "x-vercel-ip-timezone",
  "fly-region", "fly-client-ip", "x-country-code", "x-region", "x-deno-region",
  "accept-language", "sec-ch-ua-platform", "sec-ch-ua-mobile", "sec-ch-ua",
  "dnt", "sec-gpc",
];

function edgeFacts(h: Headers_): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of GEO_HEADERS) {
    const v = h.get(n);
    if (v) out[n] = v.slice(0, 200);
  }
  return out;
}

function geo(h: Headers_) {
  const pick = (...names: string[]) => {
    for (const n of names) {
      const v = h.get(n);
      if (v && v !== "XX" && v !== "T1") return v.slice(0, 120);
    }
    return null;
  };
  const num = (v: string | null) => {
    if (!v) return null;
    const f = Number(v);
    return Number.isFinite(f) ? f : null;
  };
  return {
    country: pick("cf-ipcountry", "x-vercel-ip-country", "x-country-code"),
    region: pick("cf-region", "x-vercel-ip-country-region", "x-region"),
    city: pick("cf-ipcity", "x-vercel-ip-city"),
    postal: pick("cf-postal-code"),
    latitude: num(pick("cf-iplatitude", "x-vercel-ip-latitude")),
    longitude: num(pick("cf-iplongitude", "x-vercel-ip-longitude")),
    timezone: pick("cf-timezone", "x-vercel-ip-timezone"),
    asn: (() => {
      const a = num(pick("cf-asn", "cf-ipasnum"));
      return a != null ? Math.trunc(a) : null;
    })(),
    asn_org: pick("cf-as-organization"),
  };
}

// A crawler is traffic, not an audience, and mixing the two quietly ruins
// every number downstream. Marked rather than dropped: a rising crawl is
// itself worth being able to see.
const BOT = /bot|crawl|spider|slurp|bingpreview|headless|phantom|puppeteer|playwright|curl|wget|python-requests|axios|go-http|java\/|scrapy|lighthouse|gtmetrix|pingdom|uptime|monitor|facebookexternalhit|preview|embed/i;
function looksLikeBot(ua: string | null): boolean {
  if (!ua) return true;   // no user agent at all is not a person with a browser
  return BOT.test(ua);
}

// An IP is only stored if it is actually an address. A malformed value would
// fail the inet cast at insert and take the whole batch down with it, so it is
// dropped here instead: a row with no address still carries its event.
function validIp(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (v4.test(ip)) return ip.split(".").every((o) => Number(o) <= 255) ? ip : null;
  // Loose IPv6: hex groups and colons, optionally a zone or an embedded v4.
  if (/^[0-9a-fA-F:]+(%[0-9a-zA-Z]+)?$/.test(ip) && ip.includes(":")) return ip;
  return null;
}

// THE SIGNED-IN VISITOR IS VERIFIED, NOT BELIEVED.
//
// The browser sends whatever token it holds. Decoding it here without
// checking the signature would let anyone file events under anyone's id, so
// the token goes back to the auth server, which is the only thing that can
// say whether it is real. Anonymous — the common case — never pays for this.
async function resolveUid(auth: string | null): Promise<string | null> {
  if (!auth || !/^Bearer\s+\S/i.test(auth)) return null;
  try {
    const r = await fetch(`${SB}/auth/v1/user`, {
      headers: { apikey: SRV, Authorization: auth },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return typeof u?.id === "string" ? u.id : null;
  } catch {
    return null;
  }
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, reason: "POST only" }, 405);

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ ok: false, reason: "too large" }, 413);

  let body: Record<string, unknown>;
  try {
    body = obj(JSON.parse(raw || "{}"));
  } catch {
    return json({ ok: false, reason: "bad json" }, 400);
  }

  const incoming = Array.isArray(body.events) ? body.events : [];
  if (!incoming.length) return json({ ok: true, written: 0 });

  const h = req.headers;
  const ip = validIp(callerIp(h));
  const g = geo(h);
  const edge = edgeFacts(h);
  const ua = str(h.get("user-agent"), MAX_UA);
  const bot = looksLikeBot(ua);
  const uid = await resolveUid(h.get("authorization"));

  // Client-minted, and labelled as such. See the header note.
  const deviceId = str(body.device_id, 64);
  const sessionId = str(body.session_id, 64);
  const device = obj(body.device);

  const rows: Record<string, unknown>[] = [];
  for (const e of incoming.slice(0, MAX_EVENTS)) {
    const ev = obj(e);
    const name = str(ev.name, MAX_NAME);
    // A nameless event is not an event. Skipping it beats failing the
    // batch it arrived in, which would lose the events either side of it.
    if (!name) continue;
    rows.push({
      name,
      path: str(ev.path, MAX_PATH) ?? "",
      props: obj(ev.props),
      // The referrer is the browser's own report of where it came from, which
      // is the only place that exists either. It is a claim, and a harmless one.
      referrer: str(ev.referrer, MAX_REF),
      // Observed. Never read from the body.
      uid,
      ip,
      user_agent: ua,
      country: g.country,
      region: g.region,
      city: g.city,
      postal: g.postal,
      latitude: g.latitude,
      longitude: g.longitude,
      timezone: g.timezone,
      asn: g.asn,
      asn_org: g.asn_org,
      is_bot: bot,
      edge,
      device_id: deviceId,
      session_id: sessionId,
      device,
    });
  }

  if (!rows.length) return json({ ok: true, written: 0 });

  const r = await fetch(`${SB}/rest/v1/events`, {
    method: "POST",
    headers: {
      apikey: SRV,
      Authorization: `Bearer ${SRV}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });

  // A collector that cannot write says so. The browser ignores the answer —
  // nobody's afternoon should stop because a statistic did not land — but the
  // status is real, so a check of this endpoint tells the truth about whether
  // the house is actually recording anything. That is the whole complaint
  // this replaces: something that looked wired and was not.
  if (!r.ok) {
    return json({ ok: false, reason: `insert ${r.status}`, detail: (await r.text()).slice(0, 300) }, 502);
  }
  return json({ ok: true, written: rows.length });
});
