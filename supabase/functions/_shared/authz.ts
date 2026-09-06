// AUTHZ — the one place that decides whether a caller may do a thing.
//
// This exists because three deployed functions were making the same
// mistake in the same way: `verify_jwt = true` at the gateway, then a
// switch to the service-role key, and no check in between. That is
// authentication mistaken for authorization. A valid account is not a
// permission; it only says the caller is *someone*.
//
// Three rules, and they are the whole file:
//
//   1. VERIFY, DON'T DECODE. A JWT payload is base64, not a signature.
//      Reading `sub` out of it proves nothing — anyone can write a
//      token whose payload says whatever they like. The only way to
//      know a token is real is to ask the issuer, which is what
//      verifyCaller does.
//
//   2. THE ORG COMES FROM THE RESOURCE. Never from the request body,
//      never from an environment variable. If the caller names the org,
//      the caller chooses their own tenant.
//
//   3. THE SERVICE KEY IS NOT A PERSON. A function calling another
//      function with the service-role key is exactly the confused
//      deputy this file exists to stop, so that token is refused as an
//      identity. Callers forward the human's token instead, and the
//      human is authorized at the far end.

const SB = Deno.env.get("SUPABASE_URL")!;
const SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export class AuthzError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** org_members.role. Ordered, because "can this role do that" is a
 *  comparison and writing it as a pile of string equalities is how one
 *  branch ends up missing. */
const RANK: Record<string, number> = { viewer: 1, staff: 2, owner: 3 };

export type Role = "viewer" | "staff" | "owner";
export type Caller = { id: string; email: string | null };

const srvHeaders = {
  apikey: SRV,
  Authorization: `Bearer ${SRV}`,
  "content-type": "application/json",
};

/**
 * Who is calling. Throws rather than returning null: a caller that
 * cannot be identified must never fall through into a code path that
 * treats them as anonymous-but-allowed.
 */
export async function verifyCaller(req: Request): Promise<Caller> {
  const header = req.headers.get("authorization") ?? "";
  if (!/^bearer\s+/i.test(header)) throw new AuthzError("Authentication required", 401);
  const token = header.replace(/^bearer\s+/i, "").trim();

  // Rule 3. Presenting the service key means something in the chain is
  // trying to act as the platform rather than as a person.
  if (token === SRV) {
    throw new AuthzError("Service credentials are not an identity; forward the caller's token", 403);
  }

  const r = await fetch(`${SB}/auth/v1/user`, {
    headers: { apikey: SRV, Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new AuthzError("Authentication required", 401);

  const user = await r.json().catch(() => null);
  if (!user?.id) throw new AuthzError("Authentication required", 401);
  return { id: user.id, email: user.email ?? null };
}

/**
 * The caller's role in one org, or a refusal. `minRole` is the least
 * privilege that may perform the action:
 *
 *   viewer — read what the org already did
 *   staff  — change the org's own state (draft, build, queue, pause)
 *   owner  — irreversible outward acts (send mail, publish, approve)
 *
 * The split matters most at the last line. Everything above it can be
 * undone by someone having a bad morning; a sent email cannot.
 */
export async function requireOrgRole(
  req: Request,
  orgId: string,
  minRole: Role,
): Promise<{ caller: Caller; role: Role }> {
  return await requireRoleFor(await verifyCaller(req), orgId, minRole);
}

/** The same check for a caller who has already been verified. Callers
 *  that must resolve a resource before they know the org use this, so
 *  the identity check still happens FIRST — otherwise the resource
 *  lookup answers differently for a real id than a made-up one, and an
 *  unauthenticated stranger can tell which ids exist. */
export async function requireRoleFor(
  caller: Caller,
  orgId: string,
  minRole: Role,
): Promise<{ caller: Caller; role: Role }> {
  const r = await fetch(
    `${SB}/rest/v1/org_members?org_id=eq.${encodeURIComponent(orgId)}` +
      `&profile_id=eq.${encodeURIComponent(caller.id)}&select=role&limit=1`,
    { headers: srvHeaders },
  );
  if (!r.ok) throw new AuthzError("Could not check your membership", 500);

  const rows = await r.json().catch(() => []);
  const role = rows?.[0]?.role as Role | undefined;

  // Deliberately the same message for "not a member" and "no such org":
  // distinguishing them tells a stranger which org ids are real.
  if (!role) throw new AuthzError("You do not have access to this organisation", 403);

  if ((RANK[role] ?? 0) < RANK[minRole]) {
    throw new AuthzError(`This action requires ${minRole}; your role is ${role}`, 403);
  }
  return { caller, role };
}

/** Rule 2, as a function. The org is whatever the row says, so a caller
 *  who guesses a campaign id still only reaches the org that campaign
 *  actually belongs to — and is then refused there. */
export async function orgOfCampaign(campaignId: string): Promise<string> {
  const r = await fetch(
    `${SB}/rest/v1/out_campaigns?id=eq.${encodeURIComponent(campaignId)}&select=org_id&limit=1`,
    { headers: srvHeaders },
  );
  if (!r.ok) throw new AuthzError("Could not resolve that campaign", 500);
  const rows = await r.json().catch(() => []);
  // Same refusal a non-member gets, so a missing id and a forbidden id
  // are indistinguishable from outside. Otherwise this is an oracle for
  // enumerating which campaign ids exist.
  if (!rows?.length) throw new AuthzError("You do not have access to this campaign", 403);
  return rows[0].org_id as string;
}

export async function orgIdBySlug(slug: string): Promise<string> {
  const r = await fetch(
    `${SB}/rest/v1/orgs?slug=eq.${encodeURIComponent(slug)}&select=id&limit=1`,
    { headers: srvHeaders },
  );
  const rows = r.ok ? await r.json().catch(() => []) : [];
  if (!rows?.length) throw new AuthzError("org not configured", 500);
  return rows[0].id as string;
}

/** Turn a thrown AuthzError into a response, and anything else into a
 *  500 that does not leak internals to the caller. */
export function authzResponse(e: unknown, cors: Record<string, string>): Response | null {
  if (e instanceof AuthzError) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: e.status,
      headers: { ...cors, "content-type": "application/json" },
    });
  }
  return null;
}
