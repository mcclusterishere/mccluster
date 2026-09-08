// Public intake for Equity Uprise. The browser may submit; it may never choose
// status, roles, approvals or publication state. Every accepted submission is
// normalized into the canonical graph and emits an immutable event.
import {
  cors, db, emitEvent, json, orgBySlug, safeEmail, safeText, sha256Hex, verifyCaller, verifyTurnstile,
} from "../_shared/eu-policy-os.ts";

function arr(v: unknown, max = 30) {
  return Array.isArray(v) ? v.slice(0, max).map((x) => safeText(x, 120)).filter(Boolean) : [];
}

function randomToken(bytes = 32) {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function publicInitiative(orgId: string, id: unknown) {
  const sid = safeText(id, 80);
  if (!sid) return null;
  const rows = await db(`eu_initiatives?id=eq.${encodeURIComponent(sid)}&org_id=eq.${orgId}&visibility=eq.public&select=id,title&limit=1`);
  return rows?.[0] ?? null;
}

async function upsertStakeholder(orgId: string, input: Record<string, unknown>, source: string) {
  const email = safeEmail(input.email);
  if (!email) throw new Error("valid email required");
  const existing = await db(`eu_stakeholders?org_id=eq.${orgId}&email=ilike.${encodeURIComponent(email)}&select=id,name,email&limit=1`);
  if (existing?.length) {
    const id = existing[0].id;
    await db(`eu_stakeholders?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: safeText(input.name, 160) || existing[0].name,
        title: safeText(input.title, 180),
        phone: safeText(input.phone, 60),
        city: safeText(input.city, 100),
        region: safeText(input.region, 100),
        stakeholder_types: arr(input.stakeholder_types),
        expertise_tags: arr(input.expertise_tags),
        source,
        consent: typeof input.consent === "object" && input.consent ? input.consent : {},
      }),
    });
    return { id, email };
  }

  let stakeholderOrgId: string | null = null;
  const orgName = safeText(input.organization, 220);
  const domain = safeText(input.organization_domain, 200).toLowerCase();
  if (orgName) {
    let orgRows = domain
      ? await db(`eu_stakeholder_orgs?org_id=eq.${orgId}&domain=ilike.${encodeURIComponent(domain)}&select=id&limit=1`)
      : [];
    if (!orgRows?.length) {
      orgRows = await db("eu_stakeholder_orgs", {
        method: "POST",
        body: JSON.stringify({
          org_id: orgId,
          name: orgName,
          domain: domain || null,
          kind: safeText(input.organization_kind, 80) || "other",
          jurisdiction: safeText(input.jurisdiction, 160),
          website: safeText(input.organization_website, 500),
        }),
      });
    }
    stakeholderOrgId = orgRows?.[0]?.id ?? null;
  }

  const rows = await db("eu_stakeholders", {
    method: "POST",
    body: JSON.stringify({
      org_id: orgId,
      stakeholder_org_id: stakeholderOrgId,
      name: safeText(input.name, 160),
      title: safeText(input.title, 180),
      email,
      phone: safeText(input.phone, 60),
      city: safeText(input.city, 100),
      region: safeText(input.region, 100),
      stakeholder_types: arr(input.stakeholder_types),
      expertise_tags: arr(input.expertise_tags),
      source,
      consent: typeof input.consent === "object" && input.consent ? input.consent : {},
      metadata: {},
    }),
  });
  return { id: rows[0].id, email };
}

async function stakeholderIntake(_req: Request, body: Record<string, unknown>) {
  const org = await orgBySlug("mccluster");
  const initiative = await publicInitiative(org.id, body.initiative_id);
  if (!initiative) throw new Error("active public initiative required");
  const person = await upsertStakeholder(org.id, body, "equity-uprise-intake");

  const links = await db(
    `eu_stakeholder_links?initiative_id=eq.${initiative.id}&stakeholder_id=eq.${person.id}&select=id&limit=1`,
  );
  let linkId = links?.[0]?.id;
  if (!linkId) {
    const made = await db("eu_stakeholder_links", {
      method: "POST",
      body: JSON.stringify({
        org_id: org.id,
        initiative_id: initiative.id,
        stakeholder_id: person.id,
        role: safeText(body.role, 100) || "stakeholder",
        stance: ["support","conditional-support","neutral","unknown","concerned","oppose","mixed"].includes(String(body.stance))
          ? body.stance : "unknown",
        contribution_types: arr(body.contribution_types),
        stage: "identified",
        stage_source: "system",
        next_action: body.wants_meeting === true ? "Review meeting request" : "Review intake",
      }),
    });
    linkId = made[0].id;
  }

  const idem = await sha256Hex(`stakeholder:${initiative.id}:${person.email}:${safeText(body.message, 2000)}`);
  await emitEvent({
    orgId: org.id,
    initiativeId: initiative.id,
    eventType: "stakeholder.intake.submitted",
    entityType: "eu_stakeholder_links",
    entityId: linkId,
    sourceSystem: "web",
    data: {
      stakeholder_id: person.id,
      contribution_types: arr(body.contribution_types),
      wants_meeting: body.wants_meeting === true,
      message: safeText(body.message, 4000),
    },
    idempotencyKey: idem,
  });
  return { ok: true, stakeholder_id: person.id, relationship_id: linkId };
}

async function fellowshipIntake(req: Request, body: Record<string, unknown>) {
  const org = await orgBySlug("mccluster");
  const email = safeEmail(body.email);
  const name = safeText(body.name, 160);
  if (!email || !name) throw new Error("name and valid email required");
  const caller = await verifyCaller(req);
  const stakeholder = await upsertStakeholder(org.id, body, "equity-uprise-fellowship");
  const initiativeIds = arr(body.initiative_ids, 20);
  const validInitiatives: string[] = [];
  for (const id of initiativeIds) {
    const i = await publicInitiative(org.id, id);
    if (i) validInitiatives.push(i.id);
  }

  const prior = await db(`eu_fellowship_applications?org_id=eq.${org.id}&email=ilike.${encodeURIComponent(email)}&stage=not.in.(declined,withdrawn)&select=id,stage&order=created_at.desc&limit=1`);
  if (prior?.length) return { ok: true, application_id: prior[0].id, stage: prior[0].stage, duplicate: true };

  const bookingToken = randomToken();
  const bookingTokenHash = await sha256Hex(bookingToken);
  const made = await db("eu_fellowship_applications", {
    method: "POST",
    body: JSON.stringify({
      org_id: org.id,
      m_uid: caller?.mUid ?? null,
      stakeholder_id: stakeholder.id,
      cohort: safeText(body.cohort, 100),
      applicant_name: name,
      preferred_name: safeText(body.preferred_name, 120),
      email,
      phone: safeText(body.phone, 60),
      location: safeText(body.location, 180),
      occupation: safeText(body.occupation, 220),
      policy_interests: arr(body.policy_interests),
      initiative_ids: validInitiatives,
      skills: arr(body.skills),
      availability: typeof body.availability === "object" && body.availability ? body.availability : {},
      responses: typeof body.responses === "object" && body.responses ? body.responses : {},
      work_samples: Array.isArray(body.work_samples) ? body.work_samples.slice(0, 20) : [],
      consent: typeof body.consent === "object" && body.consent ? body.consent : {},
      stage: "submitted",
      submitted_at: new Date().toISOString(),
      booking_token_hash: bookingTokenHash,
    }),
  });
  const app = made[0];
  await emitEvent({
    orgId: org.id,
    eventType: "fellowship.submitted",
    entityType: "eu_fellowship_applications",
    entityId: app.id,
    sourceSystem: "web",
    actorMUid: caller?.mUid ?? null,
    actorUserId: caller?.authUserId ?? null,
    data: { stakeholder_id: stakeholder.id, initiative_ids: validInitiatives },
    idempotencyKey: `fellowship:${app.id}:submitted`,
  });
  return { ok: true, application_id: app.id, stage: app.stage, booking_token: bookingToken };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const body = await req.json();
    const ok = await verifyTurnstile(req, body.turnstile_token);
    if (!ok) return json({ error: "verification failed" }, 403);
    const action = safeText(body.action, 40);
    if (action === "stakeholder") return json(await stakeholderIntake(req, body));
    if (action === "fellowship") return json(await fellowshipIntake(req, body));
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "intake failed" }, 400);
  }
});
