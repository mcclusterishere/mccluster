export const SB = Deno.env.get("SUPABASE_URL")!;
export const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-turnstile-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8" },
  });

export async function db(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("apikey", SRV);
  headers.set("authorization", `Bearer ${SRV}`);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (!headers.has("prefer")) headers.set("prefer", "return=representation");
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers });
  const text = await r.text();
  if (!r.ok) throw new Error(`db ${r.status}: ${text.slice(0, 1000)}`);
  return text ? JSON.parse(text) : null;
}

export async function rpc(fn: string, args: Record<string, unknown>) {
  return db(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
}

export type Caller = { authUserId: string; mUid: string | null; email: string };

export async function verifyCaller(req: Request): Promise<Caller | null> {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token || token === SRV) return null;
  const r = await fetch(`${SB}/auth/v1/user`, {
    headers: { apikey: SRV, authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const u = await r.json();
  if (typeof u?.id !== "string") return null;
  const links = await db(`m_auth_user_links?auth_user_id=eq.${encodeURIComponent(u.id)}&select=m_uid&limit=1`);
  return { authUserId: u.id, mUid: links?.[0]?.m_uid ?? null, email: String(u.email ?? "") };
}

export async function orgBySlug(slug = "mccluster") {
  const rows = await db(`orgs?slug=eq.${encodeURIComponent(slug)}&enabled=eq.true&select=id,slug,name&limit=1`);
  if (!rows?.length) throw new Error("organization not found");
  return rows[0] as { id: string; slug: string; name: string };
}

export async function authorize(
  caller: Caller,
  orgId: string,
  capability: string,
  opts: { resourceType?: string; resourceId?: string; requestHash?: string; approvalId?: string } = {},
) {
  const row = await rpc("control_authorize_service", {
    p_actor: caller.authUserId,
    p_org: orgId,
    p_capability: capability,
    p_resource_type: opts.resourceType ?? null,
    p_resource_id: opts.resourceId ?? null,
    p_request_hash: opts.requestHash ?? null,
    p_approval_id: opts.approvalId ?? null,
  });
  const decision = Array.isArray(row) ? row[0] : row;
  return decision as { allowed?: boolean; reason?: string; role?: string; risk?: string };
}

export async function emitEvent(input: {
  orgId: string;
  initiativeId?: string | null;
  eventType: string;
  entityType?: string;
  entityId?: string;
  sourceSystem?: string;
  sourceId?: string;
  actorMUid?: string | null;
  actorUserId?: string | null;
  data?: Record<string, unknown>;
  causationEventId?: number | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
}) {
  const body = {
    org_id: input.orgId,
    initiative_id: input.initiativeId ?? null,
    event_type: input.eventType,
    entity_type: input.entityType ?? "",
    entity_id: input.entityId ?? "",
    source_system: input.sourceSystem ?? "equity-uprise",
    source_id: input.sourceId ?? "",
    actor_m_uid: input.actorMUid ?? null,
    actor_user_id: input.actorUserId ?? null,
    data: input.data ?? {},
    causation_event_id: input.causationEventId ?? null,
    correlation_id: input.correlationId ?? null,
    idempotency_key: input.idempotencyKey ?? null,
  };
  try {
    const rows = await db("eu_events", { method: "POST", body: JSON.stringify(body) });
    return rows?.[0] ?? null;
  } catch (e) {
    // Idempotency collisions are success from the caller's point of view.
    if (input.idempotencyKey && String(e).includes("duplicate key")) return null;
    throw e;
  }
}

export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: "unconfigured" | "missing_token" | "rejected" };

/**
 * Bot check for the two public, unauthenticated EU surfaces.
 *
 * This used to return `true` when TURNSTILE_SECRET_KEY was unset, which
 * is the wrong direction to fail. Nothing else guards eu-intake or
 * eu-calendar — no rate limit, no honeypot — so an unset secret meant
 * anyone could mass-insert into eu_stakeholders and
 * eu_fellowship_applications, and the secret is unset by default.
 * "Not configured" is not "verified".
 *
 * It now denies unless the check actually passes. The one exception is
 * EU_INTAKE_UNPROTECTED, which exists so the forms can be demonstrated
 * before a Turnstile widget is provisioned. It is deliberately awkward to
 * set by accident, and it announces itself on every single request so it
 * cannot quietly become the production posture.
 */
export async function verifyTurnstile(req: Request, bodyToken?: string): Promise<TurnstileResult> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
  if (!secret) {
    if (Deno.env.get("EU_INTAKE_UNPROTECTED") === "true") {
      console.warn(
        "EU_INTAKE_UNPROTECTED=true: accepting a public submission with NO bot verification. " +
          "Set TURNSTILE_SECRET_KEY and unset this before launch.",
      );
      return { ok: true };
    }
    console.error("TURNSTILE_SECRET_KEY is not set; refusing the public submission.");
    return { ok: false, reason: "unconfigured" };
  }
  const token = bodyToken || req.headers.get("x-turnstile-token") || "";
  if (!token) return { ok: false, reason: "missing_token" };
  const fd = new FormData();
  fd.set("secret", secret);
  fd.set("response", token);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: fd });
  if (!r.ok) return { ok: false, reason: "rejected" };
  const j = await r.json();
  return j?.success === true ? { ok: true } : { ok: false, reason: "rejected" };
}

/**
 * The response a failed check should produce.
 *
 * An operator who forgot the secret and a bot that failed the challenge
 * are different problems, and telling them apart in the response saves a
 * long debugging session without telling a bot anything it can use.
 */
export function turnstileFailure(result: Extract<TurnstileResult, { ok: false }>) {
  if (result.reason === "unconfigured") {
    return {
      status: 503,
      body: {
        error: "Submissions are temporarily unavailable",
        detail: "Bot verification is not configured on this deployment.",
      },
    };
  }
  return { status: 403, body: { error: "verification failed" } };
}

export function safeText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

export function safeEmail(value: unknown) {
  const s = safeText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : "";
}

export async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
