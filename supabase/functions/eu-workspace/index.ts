// Authenticated collaboration API for fellows/researchers/editors.
// Auth establishes identity; project membership establishes workspace access;
// the control plane governs institution-level actions.
import {
  authorize, cors, db, emitEvent, json, orgBySlug, safeText, verifyCaller,
} from "../_shared/eu-policy-os.ts";

function arr(v: unknown, max = 50) {
  return Array.isArray(v) ? v.slice(0, max).map((x) => safeText(x, 240)).filter(Boolean) : [];
}

async function project(orgId: string, projectId: unknown) {
  const id = safeText(projectId, 80);
  const rows = await db(`eu_research_projects?id=eq.${encodeURIComponent(id)}&org_id=eq.${orgId}&select=*&limit=1`);
  if (!rows?.length) throw new Error("research project not found");
  return rows[0];
}

async function researchRole(caller: { authUserId: string; mUid: string | null }, orgId: string, projectId: string) {
  const orgDecision = await authorize(caller as any, orgId, "research.write");
  if (orgDecision.allowed) return { role: "org-staff", canWrite: true, canReview: true };
  if (!caller.mUid) return { role: "none", canWrite: false, canReview: false };
  const rows = await db(`eu_research_members?research_project_id=eq.${projectId}&m_uid=eq.${caller.mUid}&status=eq.active&select=role,permissions&limit=1`);
  if (!rows?.length) return { role: "none", canWrite: false, canReview: false };
  const role = String(rows[0].role);
  return {
    role,
    canWrite: ["principal-investigator","editor","researcher","contributor"].includes(role),
    canReview: ["principal-investigator","editor","reviewer"].includes(role),
  };
}

async function requireWrite(caller: any, orgId: string, projectId: string) {
  const a = await researchRole(caller, orgId, projectId);
  if (!a.canWrite) throw new Error("research write permission required");
  return a;
}

async function requireReview(caller: any, orgId: string, projectId: string) {
  const a = await researchRole(caller, orgId, projectId);
  if (!a.canReview) throw new Error("research review permission required");
  return a;
}

async function addSource(caller: any, org: any, body: Record<string, unknown>) {
  const p = await project(org.id, body.research_project_id);
  await requireWrite(caller, org.id, p.id);
  const title = safeText(body.title, 500);
  if (!title) throw new Error("source title required");
  const rows = await db("eu_sources", {
    method: "POST",
    body: JSON.stringify({
      org_id: org.id, research_project_id: p.id, source_type: safeText(body.source_type, 80) || "web",
      title, authors: Array.isArray(body.authors) ? body.authors.slice(0, 100) : [],
      publisher: safeText(body.publisher, 300), published_at: body.published_at || null,
      url: safeText(body.url, 1500), canonical_url: safeText(body.canonical_url, 1500),
      doi: safeText(body.doi, 300), external_ids: typeof body.external_ids === "object" && body.external_ids ? body.external_ids : {},
      snapshot_ref: typeof body.snapshot_ref === "object" && body.snapshot_ref ? body.snapshot_ref : {},
      sha256: safeText(body.sha256, 128), citation: typeof body.citation === "object" && body.citation ? body.citation : {},
      verification: "unverified", added_by_m_uid: caller.mUid,
    }),
  });
  const row = rows[0];
  await emitEvent({ orgId: org.id, initiativeId: p.initiative_id, eventType: "source.added", entityType: "eu_sources", entityId: row.id, actorMUid: caller.mUid, actorUserId: caller.authUserId, data: { research_project_id: p.id, title } });
  return row;
}

async function verifySource(caller: any, org: any, body: Record<string, unknown>) {
  const sourceId = safeText(body.source_id, 80);
  const srcs = await db(`eu_sources?id=eq.${encodeURIComponent(sourceId)}&select=*&limit=1`);
  if (!srcs?.length) throw new Error("source not found");
  const p = await project(org.id, srcs[0].research_project_id);
  await requireReview(caller, org.id, p.id);
  const verification = ["retrieved","verified","superseded","broken"].includes(String(body.verification)) ? String(body.verification) : "verified";
  await db(`eu_sources?id=eq.${sourceId}`, { method: "PATCH", body: JSON.stringify({ verification, last_checked_at: new Date().toISOString(), superseded_by: body.superseded_by || null }) });
  await emitEvent({ orgId: org.id, initiativeId: p.initiative_id, eventType: verification === "superseded" ? "source.superseded" : `source.${verification}`, entityType: "eu_sources", entityId: sourceId, actorMUid: caller.mUid, actorUserId: caller.authUserId, data: { research_project_id: p.id, superseded_by: body.superseded_by || null } });
  return { ok: true };
}

async function addClaim(caller: any, org: any, body: Record<string, unknown>) {
  const p = await project(org.id, body.research_project_id);
  await requireWrite(caller, org.id, p.id);
  const claim = safeText(body.claim, 12000);
  if (!claim) throw new Error("claim required");
  const rows = await db("eu_claims", {
    method: "POST",
    body: JSON.stringify({
      org_id: org.id, research_project_id: p.id, section_key: safeText(body.section_key, 160), claim,
      claim_type: ["factual","analytic","recommendation","definition","estimate"].includes(String(body.claim_type)) ? body.claim_type : "factual",
      status: "draft", confidence: typeof body.confidence === "number" ? Math.max(0, Math.min(1, body.confidence)) : null,
      sensitivity: ["normal","high","legal-review"].includes(String(body.sensitivity)) ? body.sensitivity : "normal",
      created_by_m_uid: caller.mUid,
    }),
  });
  const row = rows[0];
  await emitEvent({ orgId: org.id, initiativeId: p.initiative_id, eventType: "claim.added", entityType: "eu_claims", entityId: row.id, actorMUid: caller.mUid, actorUserId: caller.authUserId, data: { research_project_id: p.id, claim_type: row.claim_type } });
  return row;
}

async function linkEvidence(caller: any, org: any, body: Record<string, unknown>) {
  const claimId = safeText(body.claim_id, 80), sourceId = safeText(body.source_id, 80);
  const claims = await db(`eu_claims?id=eq.${encodeURIComponent(claimId)}&select=*&limit=1`);
  if (!claims?.length) throw new Error("claim not found");
  const p = await project(org.id, claims[0].research_project_id);
  await requireWrite(caller, org.id, p.id);
  const srcs = await db(`eu_sources?id=eq.${encodeURIComponent(sourceId)}&research_project_id=eq.${p.id}&select=id&limit=1`);
  if (!srcs?.length) throw new Error("source is not in this research project");
  const relation = ["supports","contradicts","context","method"].includes(String(body.relation)) ? body.relation : "supports";
  const locator = safeText(body.locator, 500);
  const rows = await db("eu_claim_evidence", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ claim_id: claimId, source_id: sourceId, relation, locator, excerpt: safeText(body.excerpt, 4000), note: safeText(body.note, 3000) }),
  });
  await emitEvent({ orgId: org.id, initiativeId: p.initiative_id, eventType: "evidence.linked", entityType: "eu_claims", entityId: claimId, actorMUid: caller.mUid, actorUserId: caller.authUserId, data: { source_id: sourceId, relation, locator } });
  return rows?.[0] ?? { ok: true };
}

async function saveSection(caller: any, org: any, body: Record<string, unknown>) {
  const manuscriptId = safeText(body.manuscript_id, 80);
  const manuscripts = await db(`eu_manuscripts?id=eq.${encodeURIComponent(manuscriptId)}&org_id=eq.${org.id}&select=*&limit=1`);
  if (!manuscripts?.length) throw new Error("manuscript not found");
  const m = manuscripts[0];
  const p = await project(org.id, m.research_project_id);
  await requireWrite(caller, org.id, p.id);
  const key = safeText(body.section_key, 160);
  if (!key) throw new Error("section_key required");
  let sections = await db(`eu_manuscript_sections?manuscript_id=eq.${m.id}&section_key=eq.${encodeURIComponent(key)}&select=*&limit=1`);
  let section;
  if (!sections?.length) {
    sections = await db("eu_manuscript_sections", { method: "POST", body: JSON.stringify({ manuscript_id: m.id, section_key: key, ordinal: Number(body.ordinal) || 0, heading: safeText(body.heading, 500), body_markdown: safeText(body.body_markdown, 200000), status: "draft", assigned_m_uid: body.assigned_m_uid || null, last_editor_m_uid: caller.mUid }) });
    section = sections[0];
  } else {
    section = sections[0];
    await db(`eu_manuscript_sections?id=eq.${section.id}`, { method: "PATCH", body: JSON.stringify({ heading: safeText(body.heading, 500), body_markdown: safeText(body.body_markdown, 200000), status: body.submit_for_review === true ? "in-review" : section.status, last_editor_m_uid: caller.mUid, updated_at: new Date().toISOString() }) });
  }
  const revisions = await db(`eu_section_revisions?section_id=eq.${section.id}&select=revision_no&order=revision_no.desc&limit=1`);
  const revisionNo = (Number(revisions?.[0]?.revision_no) || 0) + 1;
  await db("eu_section_revisions", { method: "POST", body: JSON.stringify({ section_id: section.id, revision_no: revisionNo, heading: safeText(body.heading, 500), body_markdown: safeText(body.body_markdown, 200000), change_summary: safeText(body.change_summary, 2000), created_by_m_uid: caller.mUid }) });
  await db(`eu_manuscripts?id=eq.${m.id}`, { method: "PATCH", body: JSON.stringify({ current_revision: Number(m.current_revision || 0) + 1 }) });
  await emitEvent({ orgId: org.id, initiativeId: p.initiative_id, eventType: body.submit_for_review === true ? "manuscript.section.submitted" : "manuscript.section.saved", entityType: "eu_manuscript_sections", entityId: section.id, actorMUid: caller.mUid, actorUserId: caller.authUserId, data: { manuscript_id: m.id, section_key: key, revision_no: revisionNo } });
  return { section_id: section.id, revision_no: revisionNo };
}

async function comment(caller: any, org: any, body: Record<string, unknown>) {
  const manuscriptId = safeText(body.manuscript_id, 80);
  const ms = await db(`eu_manuscripts?id=eq.${encodeURIComponent(manuscriptId)}&org_id=eq.${org.id}&select=id,research_project_id&limit=1`);
  if (!ms?.length) throw new Error("manuscript not found");
  const p = await project(org.id, ms[0].research_project_id);
  const access = await researchRole(caller, org.id, p.id);
  if (access.role === "none") throw new Error("research membership required");
  const text = safeText(body.body, 12000);
  if (!text) throw new Error("comment required");
  const rows = await db("eu_review_comments", { method: "POST", body: JSON.stringify({ org_id: org.id, manuscript_id: manuscriptId, section_id: body.section_id || null, parent_id: body.parent_id || null, author_m_uid: caller.mUid, body: text, anchor: typeof body.anchor === "object" && body.anchor ? body.anchor : {} }) });
  await emitEvent({ orgId: org.id, initiativeId: p.initiative_id, eventType: "review.comment.added", entityType: "eu_review_comments", entityId: rows[0].id, actorMUid: caller.mUid, actorUserId: caller.authUserId, data: { manuscript_id: manuscriptId, section_id: body.section_id || null } });
  return rows[0];
}

async function approveSection(caller: any, org: any, body: Record<string, unknown>) {
  const sectionId = safeText(body.section_id, 80);
  const sections = await db(`eu_manuscript_sections?id=eq.${encodeURIComponent(sectionId)}&select=id,manuscript_id,section_key&limit=1`);
  if (!sections?.length) throw new Error("section not found");
  const ms = await db(`eu_manuscripts?id=eq.${sections[0].manuscript_id}&org_id=eq.${org.id}&select=id,research_project_id&limit=1`);
  if (!ms?.length) throw new Error("manuscript not found");
  const p = await project(org.id, ms[0].research_project_id);
  await requireReview(caller, org.id, p.id);
  await db(`eu_manuscript_sections?id=eq.${sectionId}`, { method: "PATCH", body: JSON.stringify({ status: "approved", last_editor_m_uid: caller.mUid }) });
  await emitEvent({ orgId: org.id, initiativeId: p.initiative_id, eventType: "manuscript.section.approved", entityType: "eu_manuscript_sections", entityId: sectionId, actorMUid: caller.mUid, actorUserId: caller.authUserId, data: { manuscript_id: ms[0].id, section_key: sections[0].section_key } });
  return { ok: true };
}

async function createProject(caller: any, org: any, body: Record<string, unknown>) {
  const decision = await authorize(caller, org.id, "research.write");
  if (!decision.allowed) throw new Error("org research permission required");
  const title = safeText(body.title, 500), slug = safeText(body.slug, 160).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (!title || !slug) throw new Error("title and slug required");
  const rows = await db("eu_research_projects", { method: "POST", body: JSON.stringify({ org_id: org.id, initiative_id: body.initiative_id || null, slug, title, abstract: safeText(body.abstract, 12000), objective: safeText(body.objective, 12000), methodology: safeText(body.methodology, 40000), status: "active", visibility: safeText(body.visibility, 20) || "internal", owner_m_uid: caller.mUid, settings: {} }) });
  const p = rows[0];
  if (caller.mUid) await db("eu_research_members", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ research_project_id: p.id, m_uid: caller.mUid, role: "principal-investigator", status: "active" }) });
  await emitEvent({ orgId: org.id, initiativeId: p.initiative_id, eventType: "research.project.created", entityType: "eu_research_projects", entityId: p.id, actorMUid: caller.mUid, actorUserId: caller.authUserId, data: { title, slug } });
  return p;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const caller = await verifyCaller(req);
  if (!caller) return json({ error: "authentication required" }, 401);
  try {
    const org = await orgBySlug("mccluster");
    const body = await req.json();
    const action = safeText(body.action, 60);
    if (action === "project.create") return json(await createProject(caller, org, body));
    if (action === "source.add") return json(await addSource(caller, org, body));
    if (action === "source.verify") return json(await verifySource(caller, org, body));
    if (action === "claim.add") return json(await addClaim(caller, org, body));
    if (action === "evidence.link") return json(await linkEvidence(caller, org, body));
    if (action === "section.save") return json(await saveSection(caller, org, body));
    if (action === "review.comment") return json(await comment(caller, org, body));
    if (action === "section.approve") return json(await approveSection(caller, org, body));
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "workspace failed" }, 400);
  }
});
