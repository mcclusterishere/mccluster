// CONTEXT-INGEST — same envelope as Worker POST /v1/ai/ingest.
//
// Canonical ingress is the Worker. This function exists so adapters that
// already speak Supabase Edge can land on the same private schema without
// inventing a second memory store. It authenticates itself: either a
// house-owner JWT or the service role. Anon cannot write.

const SB = Deno.env.get("SUPABASE_URL") ?? "";
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const PROVIDERS = new Set(["chatgpt", "claude", "grok", "gemini", "copilot", "local", "other"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rpc(name: string, body: unknown) {
  const r = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SRV,
      Authorization: `Bearer ${SRV}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(data?.message || "ingest failed"), { status: r.status, detail: data });
  return data;
}

async function caller(req: Request) {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return null;
  const token = authorization.slice(7);
  if (SRV && token === SRV) return { kind: "service" as const };
  const res = await fetch(`${SB}/auth/v1/user`, {
    headers: { apikey: SRV, authorization },
  });
  if (!res.ok) return null;
  const user = await res.json();
  const orgs = await fetch(`${SB}/rest/v1/orgs?slug=eq.mccluster&select=id&limit=1`, {
    headers: { apikey: SRV, Authorization: `Bearer ${SRV}` },
  }).then((r) => r.json());
  const houseId = orgs?.[0]?.id;
  if (!houseId) return null;
  const memberships = await fetch(
    `${SB}/rest/v1/org_members?org_id=eq.${houseId}&profile_id=eq.${user.id}&role=eq.owner&select=org_id&limit=1`,
    { headers: { apikey: SRV, Authorization: `Bearer ${SRV}` } },
  ).then((r) => r.json());
  if (!memberships?.length) return null;
  return { kind: "owner" as const, user, houseId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!SB || !SRV) return json({ error: "not configured" }, 503);

  const who = await caller(req);
  if (!who) return json({ error: "Authentication required" }, 401);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "envelope required" }, 400);
  if (!body.org_id && who.kind === "owner") body.org_id = who.houseId;
  if (!UUID.test(String(body.org_id || ""))) return json({ error: "org_id required" }, 400);
  if (!PROVIDERS.has(String(body.provider || "").toLowerCase())) {
    return json({ error: "provider must be chatgpt, claude, grok, gemini, copilot, local, or other" }, 400);
  }
  if (!body.external_conversation_id) return json({ error: "external_conversation_id required" }, 400);
  if (!body.idempotency_key) return json({ error: "idempotency_key required" }, 400);

  try {
    const data = await rpc("ai_ingest", { envelope: body });
    return json(data, data?.duplicate ? 200 : 202);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "ingest failed" }, 400);
  }
});
