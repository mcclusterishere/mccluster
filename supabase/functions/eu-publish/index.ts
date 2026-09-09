// Canonical publication gate. Publishing the canonical record and distributing
// it to external systems are separate high-risk acts with separate approvals.
import {
  authorize, cors, db, emitEvent, json, orgBySlug, rpc, safeText, sha256Hex, verifyCaller,
} from "../_shared/eu-policy-os.ts";

async function manuscriptContext(orgId: string, manuscriptId: unknown) {
  const id = safeText(manuscriptId, 80);
  const ms = await db(`eu_manuscripts?id=eq.${encodeURIComponent(id)}&org_id=eq.${orgId}&select=*&limit=1`);
  if (!ms?.length) throw new Error("manuscript not found");
  const m = ms[0];
  const projects = await db(`eu_research_projects?id=eq.${m.research_project_id}&org_id=eq.${orgId}&select=*&limit=1`);
  if (!projects?.length) throw new Error("research project not found");
  const sections = await db(`eu_manuscript_sections?manuscript_id=eq.${m.id}&select=*&order=ordinal.asc`);
  const comments = await db(`eu_review_comments?manuscript_id=eq.${m.id}&state=eq.open&select=id,section_id,body`);
  const claims = await db(`eu_claims?research_project_id=eq.${m.research_project_id}&status=neq.retired&select=id,claim,claim_type,status,sensitivity`);
  return { manuscript: m, project: projects[0], sections: sections ?? [], comments: comments ?? [], claims: claims ?? [] };
}

async function readiness(orgId: string, manuscriptId: unknown) {
  const ctx = await manuscriptContext(orgId, manuscriptId);
  const gaps: Array<Record<string, unknown>> = [];
  if (!ctx.sections.length) gaps.push({ code: "no_sections", message: "Manuscript has no sections." });
  const notApproved = ctx.sections.filter((s: any) => s.status !== "approved");
  if (notApproved.length) gaps.push({ code: "sections_not_approved", count: notApproved.length, section_keys: notApproved.map((s: any) => s.section_key) });
  if (ctx.comments.length) gaps.push({ code: "open_review_comments", count: ctx.comments.length });

  for (const c of ctx.claims) {
    if (c.claim_type !== "factual" && c.claim_type !== "estimate") continue;
    const ev = await db(`eu_claim_evidence?claim_id=eq.${c.id}&relation=in.(supports,method)&select=source_id,verified_at`);
    if (!ev?.length) gaps.push({ code: "unsupported_claim", claim_id: c.id, claim: String(c.claim).slice(0, 220) });
  }
  const highClaims = ctx.claims.filter((c: any) => ["high", "legal-review"].includes(c.sensitivity) && c.status !== "approved");
  if (highClaims.length) gaps.push({ code: "sensitive_claims_unapproved", count: highClaims.length, claim_ids: highClaims.map((c: any) => c.id) });

  const content = ctx.sections.map((s: any) => `${s.section_key}\n${s.heading}\n${s.body_markdown}`).join("\n\n---\n\n");
  const contentHash = await sha256Hex(content);
  return { ready: gaps.length === 0, gaps, content_hash: contentHash, ...ctx };
}

async function requireReview(caller: any, orgId: string, projectId: string) {
  const orgDecision = await authorize(caller, orgId, "research.review");
  if (orgDecision.allowed) return;
  if (!caller.mUid) throw new Error("review permission required");
  const rows = await db(`eu_research_members?research_project_id=eq.${projectId}&m_uid=eq.${caller.mUid}&status=eq.active&role=in.(principal-investigator,editor,reviewer)&select=role&limit=1`);
  if (!rows?.length) throw new Error("review permission required");
}

function seriesFromProject(p: any, body: Record<string, unknown>) {
  const explicit = safeText(body.series_key, 8);
  if (explicit) return explicit;
  const slug = String(p.slug ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return slug.slice(0, 3) || "GEN";
}

async function prepare(caller: any, org: any, body: Record<string, unknown>) {
  const state = await readiness(org.id, body.manuscript_id);
  await requireReview(caller, org.id, state.project.id);
  if (!state.ready) return { ok: false, ready: false, gaps: state.gaps, content_hash: state.content_hash };

  const existing = await db(`eu_publications?manuscript_id=eq.${state.manuscript.id}&status=not.in.(retracted,superseded)&select=*&order=created_at.desc&limit=1`);
  if (existing?.length) return { ok: true, publication: existing[0], content_hash: state.content_hash, existing: true };

  const stableResult = await rpc("eu_next_publication_id_service", { p_org: org.id, p_series: seriesFromProject(state.project, body) });
  const stableId = typeof stableResult === "string" ? stableResult : Array.isArray(stableResult) ? stableResult[0] : String(stableResult);
  const title = safeText(body.title, 800) || state.manuscript.title;
  const artifactRows = await db("eu_artifacts", { method: "POST", body: JSON.stringify({
    org_id: org.id, initiative_id: state.project.initiative_id, research_project_id: state.project.id,
    artifact_type: "publication", title, status: "review", sha256: state.content_hash,
    metadata: { manuscript_id: state.manuscript.id, stable_id: stableId }, created_by_m_uid: caller.mUid,
  }) });
  const artifact = artifactRows[0];
  const pubRows = await db("eu_publications", { method: "POST", body: JSON.stringify({
    org_id: org.id, initiative_id: state.project.initiative_id, research_project_id: state.project.id,
    manuscript_id: state.manuscript.id, artifact_id: artifact.id, stable_id: stableId,
    publication_type: safeText(body.publication_type, 50) || "report", title,
    subtitle: safeText(body.subtitle, 800), abstract: safeText(body.abstract, 30000) || state.project.abstract,
    keywords: Array.isArray(body.keywords) ? body.keywords.slice(0, 50).map((x: unknown) => safeText(x, 120)).filter(Boolean) : [],
    jurisdiction: safeText(body.jurisdiction, 300), license: safeText(body.license, 200),
    funding_statement: safeText(body.funding_statement, 10000), conflict_statement: safeText(body.conflict_statement, 10000),
    status: "final-review", current_version: "1.0", metadata: {}, created_by_m_uid: caller.mUid,
  }) });
  const publication = pubRows[0];

  const contributorInput = Array.isArray(body.contributors) ? body.contributors.slice(0, 100) : [];
  for (let i = 0; i < contributorInput.length; i++) {
    const c: any = contributorInput[i];
    const displayName = safeText(c.display_name, 300);
    if (!displayName) continue;
    await db("eu_publication_contributors", { method: "POST", body: JSON.stringify({
      publication_id: publication.id, m_uid: c.m_uid || null, display_name: displayName,
      affiliation: safeText(c.affiliation, 500), orcid: safeText(c.orcid, 100), is_author: c.is_author !== false,
      author_order: Number(c.author_order) || i + 1, corresponding: c.corresponding === true,
      credit_roles: Array.isArray(c.credit_roles) ? c.credit_roles.slice(0, 14).map((x: unknown) => safeText(x, 100)).filter(Boolean) : [],
      contribution_statement: safeText(c.contribution_statement, 5000), approval_state: "pending",
    }) });
  }
  for (const claim of state.claims) {
    await db("eu_publication_claims", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ publication_id: publication.id, claim_id: claim.id, section_key: "" }) });
  }
  await db("eu_publication_versions", { method: "POST", body: JSON.stringify({
    publication_id: publication.id, version_label: "1.0", version_type: "version", title,
    abstract: publication.abstract, content_hash: state.content_hash, metadata: { manuscript_revision: state.manuscript.current_revision },
    created_by_m_uid: caller.mUid,
  }) });
  await emitEvent({ orgId: org.id, initiativeId: state.project.initiative_id, eventType: "publication.prepared", entityType: "eu_publications", entityId: publication.id, actorMUid: caller.mUid, actorUserId: caller.authUserId, data: { stable_id: stableId, content_hash: state.content_hash }, idempotencyKey: `publication:${publication.id}:prepared:${state.content_hash}` });
  return { ok: true, publication, content_hash: state.content_hash, ready: true };
}

async function publicationVersion(orgId: string, publicationId: unknown) {
  const id = safeText(publicationId, 80);
  const pubs = await db(`eu_publications?id=eq.${encodeURIComponent(id)}&org_id=eq.${orgId}&select=*&limit=1`);
  if (!pubs?.length) throw new Error("publication not found");
  const publication = pubs[0];
  const versions = await db(`eu_publication_versions?publication_id=eq.${publication.id}&version_label=eq.${encodeURIComponent(publication.current_version)}&select=*&limit=1`);
  if (!versions?.length) throw new Error("publication version not found");
  return { publication, version: versions[0] };
}

async function publish(caller: any, org: any, body: Record<string, unknown>) {
  const { publication: p, version: v } = await publicationVersion(org.id, body.publication_id);
  const requestHash = await sha256Hex(JSON.stringify({
    action: "publication.publish",
    publication_id: p.id,
    stable_id: p.stable_id,
    version: v.version_label,
    content_hash: v.content_hash,
  }));
  const approvalId = safeText(body.approval_id, 80);
  const decision = await authorize(caller, org.id, "publication.publish", {
    resourceType: "eu_publications", resourceId: p.id, requestHash, approvalId,
  });
  if (!decision.allowed) return { ok: false, approval_required: true, reason: decision.reason, request_hash: requestHash };

  await db(`eu_publications?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ status: "approved", approved_by_m_uid: caller.mUid }) });
  await db(`eu_artifacts?id=eq.${p.artifact_id}`, { method: "PATCH", body: JSON.stringify({ status: "approved" }) });
  const renderJob = await db("eu_jobs", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      org_id: org.id, initiative_id: p.initiative_id, job_type: "publication.render", provider: "internal",
      action: "render-package", capability: "publication.publish", resource_type: "eu_publications", resource_id: p.id,
      payload: { publication_id: p.id, version_label: v.version_label, content_hash: v.content_hash, request_hash: requestHash },
      state: "queued", approval_id: approvalId || null,
      idempotency_key: `publication:${p.id}:${v.version_label}:render:${v.content_hash}`,
    }),
  });

  await emitEvent({
    orgId: org.id, initiativeId: p.initiative_id, eventType: "publication.approved",
    entityType: "eu_publications", entityId: p.id, actorMUid: caller.mUid, actorUserId: caller.authUserId,
    data: { stable_id: p.stable_id, version: v.version_label, content_hash: v.content_hash, request_hash: requestHash, render_job_id: renderJob?.[0]?.id },
    idempotencyKey: `publication:${p.id}:approved:${v.content_hash}`,
  });
  return {
    ok: true,
    publication_id: p.id,
    stable_id: p.stable_id,
    request_hash: requestHash,
    render_job_id: renderJob?.[0]?.id ?? null,
    distribution_ready: false,
  };
}

type DistributionGroup = {
  capability: string;
  targets: any[];
  request_hash: string;
};

async function distributionGroups(orgId: string, p: any, v: any): Promise<DistributionGroup[]> {
  const targets = await db(`eu_distribution_targets?org_id=eq.${orgId}&enabled=eq.true&select=*&order=provider.asc,label.asc`);
  const external = (targets ?? []).filter((t: any) => t.target_type !== "canonical-site" && t.provider !== "equity-uprise");
  const grouped = new Map<string, any[]>();
  for (const target of external) {
    const capability = safeText(target.capability, 120) || "publication.distribute";
    const arr = grouped.get(capability) ?? [];
    arr.push(target);
    grouped.set(capability, arr);
  }

  const result: DistributionGroup[] = [];
  for (const [capability, groupTargets] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const targetFingerprint = groupTargets
      .map((t: any) => ({ id: t.id, provider: t.provider, target_type: t.target_type, label: t.label }))
      .sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)));
    const requestHash = await sha256Hex(JSON.stringify({
      action: "publication.distribute.batch",
      publication_id: p.id,
      stable_id: p.stable_id,
      version: v.version_label,
      content_hash: v.content_hash,
      capability,
      targets: targetFingerprint,
    }));
    result.push({ capability, targets: groupTargets, request_hash: requestHash });
  }
  return result;
}

function approvalFor(body: Record<string, unknown>, capability: string, groupCount: number) {
  const approvals = body.approvals;
  if (approvals && typeof approvals === "object" && !Array.isArray(approvals)) {
    return safeText((approvals as Record<string, unknown>)[capability], 80);
  }
  if (groupCount === 1) return safeText(body.approval_id, 80);
  return "";
}

async function distributionPlan(caller: any, org: any, body: Record<string, unknown>) {
  const { publication: p, version: v } = await publicationVersion(org.id, body.publication_id);
  if (!["published", "corrected"].includes(String(p.status))) {
    return { ok: false, ready: false, reason: "canonical publication is not live yet", publication_status: p.status };
  }
  const groups = await distributionGroups(org.id, p, v);
  const requirements = [];
  for (const group of groups) {
    const decision = await authorize(caller, org.id, group.capability, {
      resourceType: "eu_publications", resourceId: p.id, requestHash: group.request_hash,
    });
    requirements.push({
      capability: group.capability,
      risk: decision.risk ?? null,
      request_hash: group.request_hash,
      targets: group.targets.map((t: any) => ({ id: t.id, provider: t.provider, label: t.label, target_type: t.target_type })),
      approval_required: decision.reason === "approval_required",
      allowed_without_approval: decision.allowed === true,
      reason: decision.reason ?? null,
    });
  }
  return { ok: true, ready: true, publication_id: p.id, stable_id: p.stable_id, version: v.version_label, content_hash: v.content_hash, requirements };
}

async function distribute(caller: any, org: any, body: Record<string, unknown>) {
  const { publication: p, version: v } = await publicationVersion(org.id, body.publication_id);
  if (!["published", "corrected"].includes(String(p.status)) || !p.canonical_url) {
    return { ok: false, ready: false, reason: "canonical publication must be live before external distribution", publication_status: p.status };
  }

  const groups = await distributionGroups(org.id, p, v);
  if (!groups.length) return { ok: true, queued: 0, message: "no external distribution targets are enabled" };

  const decisions: Array<{ group: DistributionGroup; approval_id: string; decision: any }> = [];
  for (const group of groups) {
    const approvalId = approvalFor(body, group.capability, groups.length);
    const decision = await authorize(caller, org.id, group.capability, {
      resourceType: "eu_publications", resourceId: p.id, requestHash: group.request_hash, approvalId,
    });
    decisions.push({ group, approval_id: approvalId, decision });
  }

  const denied = decisions.filter((x) => !x.decision?.allowed);
  if (denied.length) {
    return {
      ok: false,
      authorization_required: true,
      requirements: denied.map(({ group, decision }) => ({
        capability: group.capability,
        request_hash: group.request_hash,
        reason: decision?.reason ?? "denied",
        risk: decision?.risk ?? null,
        targets: group.targets.map((t: any) => ({ id: t.id, provider: t.provider, label: t.label, target_type: t.target_type })),
      })),
    };
  }

  let queued = 0;
  const jobs: string[] = [];
  for (const { group, approval_id } of decisions) {
    for (const target of group.targets) {
      const deliveryKey = `publication:${p.id}:${v.version_label}:target:${target.id}:${v.content_hash}`;
      const deliveryRows = await db("eu_deliveries", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify({
          org_id: org.id, initiative_id: p.initiative_id, publication_id: p.id, artifact_id: p.artifact_id,
          target_id: target.id, version_label: v.version_label, state: "queued", idempotency_key: deliveryKey,
        }),
      });
      let delivery = deliveryRows?.[0];
      if (!delivery) {
        const existing = await db(`eu_deliveries?org_id=eq.${org.id}&idempotency_key=eq.${encodeURIComponent(deliveryKey)}&select=*&limit=1`);
        delivery = existing?.[0];
      }
      if (!delivery) continue;

      const jobRows = await db("eu_jobs", {
        method: "POST",
        headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify({
          org_id: org.id, initiative_id: p.initiative_id, job_type: "publication.distribute", provider: target.provider,
          action: "deliver", capability: group.capability, resource_type: "eu_publications", resource_id: p.id,
          payload: {
            delivery_id: delivery.id, publication_id: p.id, version_label: v.version_label, target_id: target.id,
            content_hash: v.content_hash, request_hash: group.request_hash,
          },
          state: "queued", approval_id: approval_id || null,
          idempotency_key: `delivery:${delivery.id}:job:${group.request_hash}`,
        }),
      });
      const job = jobRows?.[0];
      if (job?.id) {
        jobs.push(job.id);
        queued++;
        await db(`eu_deliveries?id=eq.${delivery.id}`, { method: "PATCH", body: JSON.stringify({ job_id: job.id }) });
      }
    }
  }

  await emitEvent({
    orgId: org.id, initiativeId: p.initiative_id, eventType: "publication.distribution_queued",
    entityType: "eu_publications", entityId: p.id, actorMUid: caller.mUid, actorUserId: caller.authUserId,
    data: { version: v.version_label, content_hash: v.content_hash, queued, job_ids: jobs },
    idempotencyKey: `publication:${p.id}:distribution:${v.content_hash}:${groups.map((g) => g.request_hash).join(":")}`,
  });
  return { ok: true, publication_id: p.id, queued, job_ids: jobs };
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
    if (action === "readiness") {
      const state = await readiness(org.id, body.manuscript_id);
      await requireReview(caller, org.id, state.project.id);
      return json({ ready: state.ready, gaps: state.gaps, content_hash: state.content_hash });
    }
    if (action === "prepare") return json(await prepare(caller, org, body));
    if (action === "publish") return json(await publish(caller, org, body));
    if (action === "distribution-plan") return json(await distributionPlan(caller, org, body));
    if (action === "distribute") return json(await distribute(caller, org, body));
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "publication failed" }, 400);
  }
});
