// Durable Policy OS worker. It consumes eu_jobs leases, validates high-risk
// jobs against the central control plane, runs an adapter, records attempts,
// and converts every receipt/failure back into canonical state/events.
import { SB, SRV, db, emitEvent, json, rpc, safeText } from "../_shared/eu-policy-os.ts";

const WORKER_SECRET = Deno.env.get("EU_WORKER_SECRET") ?? "";
const WORKER = `eu-worker:${crypto.randomUUID().slice(0, 8)}`;

function x(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
}
function h(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function inlineMarkdown(s: string) {
  return h(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}
function markdownBlocks(md: string) {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let para: string[] = [], list: string[] = [];
  const flush = () => {
    if (para.length) { out.push(`<p>${inlineMarkdown(para.join(" "))}</p>`); para = []; }
    if (list.length) { out.push(`<ul>${list.map((v) => `<li>${inlineMarkdown(v)}</li>`).join("")}</ul>`); list = []; }
  };
  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) { if (para.length) flush(); list.push(line.replace(/^\s*[-*]\s+/, "")); continue; }
    const head = line.match(/^(#{1,6})\s+(.+)$/);
    if (head) { flush(); out.push(`<h${head[1].length}>${inlineMarkdown(head[2])}</h${head[1].length}>`); continue; }
    if (!line.trim()) { flush(); continue; }
    para.push(line.trim());
  }
  flush();
  return out.join("\n");
}

async function storagePut(bucket: string, path: string, body: BodyInit, contentType: string) {
  const r = await fetch(`${SB}/storage/v1/object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST",
    headers: { apikey: SRV, authorization: `Bearer ${SRV}`, "content-type": contentType, "x-upsert": "true" },
    body,
  });
  if (!r.ok) throw new Error(`storage ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return `${SB}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function publicationBundle(publicationId: string, versionLabel: string) {
  const pubs = await db(`eu_publications?id=eq.${encodeURIComponent(publicationId)}&select=*&limit=1`);
  if (!pubs?.length) throw new Error("publication missing");
  const p = pubs[0];
  const versions = await db(`eu_publication_versions?publication_id=eq.${p.id}&version_label=eq.${encodeURIComponent(versionLabel)}&select=*&limit=1`);
  if (!versions?.length) throw new Error("publication version missing");
  const v = versions[0];
  const ms = await db(`eu_manuscripts?id=eq.${p.manuscript_id}&select=*&limit=1`);
  const sections = await db(`eu_manuscript_sections?manuscript_id=eq.${p.manuscript_id}&select=*&order=ordinal.asc`);
  const contributors = await db(`eu_publication_contributors?publication_id=eq.${p.id}&select=*&order=author_order.asc.nullslast`);
  return { publication: p, version: v, manuscript: ms?.[0], sections: sections ?? [], contributors: contributors ?? [] };
}

function renderHtml(b: any) {
  const p = b.publication;
  const authors = b.contributors.filter((c: any) => c.is_author).map((c: any) => c.display_name);
  const citationMeta = [
    `<meta name="citation_title" content="${h(p.title)}">`,
    ...authors.map((a: string) => `<meta name="citation_author" content="${h(a)}">`),
    p.published_at ? `<meta name="citation_publication_date" content="${h(String(p.published_at).slice(0,10))}">` : "",
    p.doi ? `<meta name="citation_doi" content="${h(p.doi)}">` : "",
  ].filter(Boolean).join("\n");
  const sections = b.sections.map((s: any) => `<section id="${h(s.section_key)}"><h2>${h(s.heading)}</h2>${markdownBlocks(String(s.body_markdown ?? ""))}</section>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(p.title)}</title>${citationMeta}</head><body><article data-equity-uprise-publication="${h(p.stable_id)}" data-version="${h(b.version.version_label)}"><header><p>Equity Uprise · ${h(p.stable_id)}</p><h1>${h(p.title)}</h1>${p.subtitle ? `<p>${h(p.subtitle)}</p>` : ""}<p>${authors.map(h).join(", ")}</p><p>${h(p.abstract)}</p></header>${sections}</article></body></html>`;
}

function renderJats(b: any) {
  const p = b.publication;
  const contributors = b.contributors.filter((c: any) => c.is_author).map((c: any) => {
    const parts = String(c.display_name).trim().split(/\s+/); const surname = parts.pop() || ""; const given = parts.join(" ");
    return `<contrib contrib-type="author"><name><surname>${x(surname)}</surname><given-names>${x(given)}</given-names></name>${c.orcid ? `<contrib-id contrib-id-type="orcid">${x(c.orcid)}</contrib-id>` : ""}${c.affiliation ? `<xref ref-type="aff" rid="aff-${x(c.id)}"/>` : ""}</contrib>`;
  }).join("");
  const body = b.sections.map((s: any) => `<sec id="${x(s.section_key)}"><title>${x(s.heading)}</title><p>${x(String(s.body_markdown ?? ""))}</p></sec>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><article article-type="research-article" dtd-version="1.3" xmlns:xlink="http://www.w3.org/1999/xlink"><front><article-meta><article-id pub-id-type="publisher-id">${x(p.stable_id)}</article-id>${p.doi ? `<article-id pub-id-type="doi">${x(p.doi)}</article-id>` : ""}<title-group><article-title>${x(p.title)}</article-title></title-group><contrib-group>${contributors}</contrib-group><abstract><p>${x(p.abstract)}</p></abstract><kwd-group>${(p.keywords ?? []).map((k: string) => `<kwd>${x(k)}</kwd>`).join("")}</kwd-group></article-meta></front><body>${body}</body></article>`;
}

function citationExports(b: any) {
  const p = b.publication; const authors = b.contributors.filter((c: any) => c.is_author).map((c: any) => c.display_name);
  const year = p.published_at ? new Date(p.published_at).getUTCFullYear() : new Date().getUTCFullYear();
  const key = String(p.stable_id).replace(/[^A-Za-z0-9]/g, "");
  const bibtex = `@techreport{${key},\n  title={${p.title}},\n  author={${authors.join(" and ")}},\n  institution={Equity Uprise / McCluster Corp},\n  year={${year}},\n  number={${p.stable_id}}${p.doi ? `,\n  doi={${p.doi}}` : ""}${p.canonical_url ? `,\n  url={${p.canonical_url}}` : ""}\n}`;
  const ris = [`TY  - RPRT`, `TI  - ${p.title}`, ...authors.map((a: string) => `AU  - ${a}`), `PY  - ${year}`, `PB  - Equity Uprise / McCluster Corp`, `SN  - ${p.stable_id}`, p.doi ? `DO  - ${p.doi}` : "", p.canonical_url ? `UR  - ${p.canonical_url}` : "", `ER  -`].filter(Boolean).join("\n");
  const csl = { id: p.stable_id, type: "report", title: p.title, abstract: p.abstract, author: authors.map((a: string) => { const q=a.trim().split(/\s+/); return { family:q.pop(), given:q.join(" ") }; }), issued: { "date-parts": [[year]] }, publisher: "Equity Uprise / McCluster Corp", DOI: p.doi || undefined, URL: p.canonical_url || undefined };
  return { bibtex, ris, csl };
}

async function renderPdfIfConfigured(html: string, path: string) {
  const endpoint = Deno.env.get("PDF_RENDER_ENDPOINT") ?? "";
  const secret = Deno.env.get("PDF_RENDER_SECRET") ?? "";
  if (!endpoint) return null;
  const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify({ html, format: "A4", printBackground: true }) });
  if (!r.ok) throw new Error(`pdf renderer ${r.status}`);
  const pdf = await r.arrayBuffer();
  return storagePut("equity-uprise-public", path, pdf, "application/pdf");
}

async function handleInternal(job: any) {
  if (job.action !== "render-package") throw new Error(`unknown internal action ${job.action}`);
  const b = await publicationBundle(job.payload.publication_id, job.payload.version_label);
  const p = b.publication, v = b.version;
  const base = `publications/${String(p.stable_id).toLowerCase()}/${v.version_label}`;
  const html = renderHtml(b), jats = renderJats(b), c = citationExports(b);
  const htmlUrl = await storagePut("equity-uprise-public", `${base}/index.html`, html, "text/html; charset=utf-8");
  const jatsUrl = await storagePut("equity-uprise-public", `${base}/${p.stable_id}.xml`, jats, "application/vnd.jats+xml");
  const bibUrl = await storagePut("equity-uprise-public", `${base}/${p.stable_id}.bib`, c.bibtex, "application/x-bibtex");
  const risUrl = await storagePut("equity-uprise-public", `${base}/${p.stable_id}.ris`, c.ris, "application/x-research-info-systems");
  const cslUrl = await storagePut("equity-uprise-public", `${base}/${p.stable_id}.json`, JSON.stringify(c.csl, null, 2), "application/json");
  const pdfUrl = await renderPdfIfConfigured(html, `${base}/${p.stable_id}.pdf`);
  await db(`eu_publication_versions?id=eq.${v.id}`, { method: "PATCH", body: JSON.stringify({ html_ref: { url: htmlUrl }, jats_ref: { url: jatsUrl }, pdf_ref: pdfUrl ? { url: pdfUrl } : {}, bibtex: c.bibtex, ris: c.ris, csl_json: c.csl, published_at: new Date().toISOString() }) });
  const canonical = p.canonical_url || htmlUrl;
  await db(`eu_publications?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ status: "published", canonical_url: canonical, published_at: new Date().toISOString() }) });
  if (p.artifact_id) await db(`eu_artifacts?id=eq.${p.artifact_id}`, { method: "PATCH", body: JSON.stringify({ status: "published", canonical_url: canonical, storage_ref: { html: htmlUrl, pdf: pdfUrl, jats: jatsUrl, bibtex: bibUrl, ris: risUrl, csl: cslUrl } }) });
  await emitEvent({ orgId: job.org_id, initiativeId: p.initiative_id, eventType: "publication.published", entityType: "eu_publications", entityId: p.id, sourceSystem: "eu-worker", data: { stable_id: p.stable_id, version: v.version_label, canonical_url: canonical, pdf: pdfUrl }, idempotencyKey: `publication:${p.id}:published:${v.content_hash}` });
  return { canonical_url: canonical, html: htmlUrl, pdf: pdfUrl, jats: jatsUrl, bibtex: bibUrl, ris: risUrl, csl: cslUrl };
}

async function handleCrossref(job: any) {
  const user = Deno.env.get("CROSSREF_LOGIN_ID") ?? "", pass = Deno.env.get("CROSSREF_PASSWORD") ?? "", prefix = Deno.env.get("CROSSREF_PREFIX") ?? "";
  if (!user || !pass || !prefix) return { not_configured: true, requires: ["CROSSREF_LOGIN_ID","CROSSREF_PASSWORD","CROSSREF_PREFIX"] };
  const b = await publicationBundle(job.payload.publication_id, job.payload.version_label);
  const p = b.publication;
  if (!p.canonical_url) throw new Error("canonical publication must be live before Crossref deposit");
  const doi = p.doi || `${prefix}/${String(p.stable_id).toLowerCase()}`;
  const ts = Date.now();
  const names = b.contributors.filter((c: any) => c.is_author).map((c: any, i: number) => { const q=String(c.display_name).trim().split(/\s+/); const sur=q.pop()||""; return `<person_name contributor_role="author" sequence="${i===0?"first":"additional"}"><given_name>${x(q.join(" "))}</given_name><surname>${x(sur)}</surname>${c.orcid?`<ORCID>${x(c.orcid.replace(/^https?:\/\/orcid.org\//,""))}</ORCID>`:""}</person_name>`; }).join("");
  const year = new Date().getUTCFullYear();
  const xml = `<?xml version="1.0" encoding="UTF-8"?><doi_batch xmlns="http://www.crossref.org/schema/5.3.1" version="5.3.1"><head><doi_batch_id>${x(p.stable_id)}-${ts}</doi_batch_id><timestamp>${ts}</timestamp><depositor><depositor_name>Equity Uprise</depositor_name><email_address>${x(Deno.env.get("CROSSREF_DEPOSITOR_EMAIL") || "matthew@mccluster.org")}</email_address></depositor><registrant>McCluster Corp / Equity Uprise</registrant></head><body><report-paper publication_type="full_text"><report-paper_metadata language="en"><contributors>${names}</contributors><titles><title>${x(p.title)}</title></titles><publication_date media_type="online"><year>${year}</year></publication_date><publisher><publisher_name>Equity Uprise / McCluster Corp</publisher_name></publisher><doi_data><doi>${x(doi)}</doi><resource>${x(p.canonical_url)}</resource></doi_data></report-paper_metadata></report-paper></body></doi_batch>`;
  const form = new FormData(); form.set("operation", "doMDUpload"); form.set("login_id", user); form.set("passwd", pass); form.set("fname", new File([xml], `${p.stable_id}.xml`, { type: "application/xml" }));
  const base = Deno.env.get("CROSSREF_DEPOSIT_URL") || "https://doi.crossref.org/servlet/deposit";
  const r = await fetch(base, { method: "POST", body: form }); const text = await r.text();
  if (!r.ok) throw new Error(`crossref ${r.status}: ${text.slice(0,800)}`);
  await db(`eu_publications?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ doi }) });
  return { submitted: true, doi, response: text.slice(0,4000), note: "HTTP success means queued; submission-log verification is still required." };
}

async function handleOpenAlex(job: any) {
  const b = await publicationBundle(job.payload.publication_id, job.payload.version_label);
  const p = b.publication;
  if (!p.doi) return { not_ready: true, reason: "publication has no DOI yet" };
  const key = Deno.env.get("OPENALEX_API_KEY") ?? "";
  const mailto = Deno.env.get("OPENALEX_MAILTO") ?? "matthew@mccluster.org";
  const q = new URLSearchParams({ filter: `doi:https://doi.org/${p.doi}`, mailto });
  if (key) q.set("api_key", key);
  const r = await fetch(`https://api.openalex.org/works?${q}`); const j = await r.json();
  if (!r.ok) throw new Error(`openalex ${r.status}`);
  const w = j.results?.[0]; if (!w) return { found: false };
  await db("eu_citation_snapshots", { method: "POST", body: JSON.stringify({ org_id: job.org_id, publication_id: p.id, provider: "openalex", cited_by_count: w.cited_by_count ?? null, works: [], raw: w }) });
  return { found: true, openalex_id: w.id, cited_by_count: w.cited_by_count ?? null };
}

async function handleExternalStub(job: any) {
  const envMap: Record<string, string[]> = {
    zenodo: ["ZENODO_TOKEN"], osf: ["OSF_TOKEN"], orcid: ["ORCID_CLIENT_ID","ORCID_CLIENT_SECRET"],
    "regulations-gov": ["REGULATIONS_GOV_API_KEY"], linkedin: ["LINKEDIN_TOKEN"], tiktok: ["TIKTOK_ACCESS_TOKEN"], youtube: ["GOOGLE_REFRESH_TOKEN"], ddex: ["DDEX_DPID"],
  };
  const requires = envMap[job.provider] ?? [];
  const missing = requires.filter((k) => !Deno.env.get(k));
  if (missing.length) return { not_configured: true, provider: job.provider, requires: missing };
  return { adapter_scaffolded: true, provider: job.provider, blocked: true, reason: "credential is present but provider-specific contract/validation is not enabled in this first scaffold" };
}

async function authorized(job: any) {
  const caps = await db(`control_capabilities?capability=eq.${encodeURIComponent(job.capability || "")}&select=risk&limit=1`);
  const risk = caps?.[0]?.risk ?? "low";
  if (risk !== "high") return { allowed: true };
  if (!job.approval_id || !job.payload?.request_hash) return { allowed: false, reason: "approval_required" };
  const approvals = await db(`control_approvals?id=eq.${job.approval_id}&select=requested_by,state,request_hash,expires_at&limit=1`);
  if (!approvals?.length) return { allowed: false, reason: "approval_missing" };
  const a = approvals[0];
  const decision = await rpc("control_authorize_service", { p_actor: a.requested_by, p_org: job.org_id, p_capability: job.capability, p_resource_type: job.resource_type, p_resource_id: job.resource_id, p_request_hash: job.payload.request_hash, p_approval_id: job.approval_id });
  return Array.isArray(decision) ? decision[0] : decision;
}

async function runJob(job: any) {
  const started = new Date().toISOString();
  const attemptNo = Number(job.attempts || 1);
  await db("eu_job_attempts", { method: "POST", body: JSON.stringify({ job_id: job.id, attempt: attemptNo, worker: WORKER, request: { provider: job.provider, action: job.action, payload: job.payload }, started_at: started }) });
  try {
    const auth = await authorized(job);
    if (!auth?.allowed) {
      await db(`eu_jobs?id=eq.${job.id}`, { method: "PATCH", body: JSON.stringify({ state: "waiting-approval", lease_owner: null, lease_until: null, last_error: auth?.reason || "approval required" }) });
      await db(`eu_job_attempts?job_id=eq.${job.id}&attempt=eq.${attemptNo}`, { method: "PATCH", body: JSON.stringify({ response: auth ?? {}, error: auth?.reason || "approval required", finished_at: new Date().toISOString() }) });
      return { id: job.id, state: "waiting-approval" };
    }
    await db(`eu_jobs?id=eq.${job.id}`, { method: "PATCH", body: JSON.stringify({ state: "running" }) });
    let result: any;
    if (job.provider === "internal") result = await handleInternal(job);
    else if (job.provider === "crossref") result = await handleCrossref(job);
    else if (job.provider === "openalex") result = await handleOpenAlex(job);
    else result = await handleExternalStub(job);
    const state = result?.not_configured ? "not-configured" : result?.blocked ? "not-configured" : "succeeded";
    await db(`eu_jobs?id=eq.${job.id}`, { method: "PATCH", body: JSON.stringify({ state, result, lease_owner: null, lease_until: null, last_error: "" }) });
    await db(`eu_job_attempts?job_id=eq.${job.id}&attempt=eq.${attemptNo}`, { method: "PATCH", body: JSON.stringify({ response: result ?? {}, finished_at: new Date().toISOString() }) });
    await emitEvent({ orgId: job.org_id, initiativeId: job.initiative_id, eventType: state === "succeeded" ? "job.succeeded" : "job.not_configured", entityType: "eu_jobs", entityId: job.id, sourceSystem: "eu-worker", data: { provider: job.provider, action: job.action, result } });
    return { id: job.id, state, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const retry = Number(job.attempts) < Number(job.max_attempts);
    const delayMinutes = Math.min(60, Math.pow(2, Math.min(Number(job.attempts), 6)));
    await db(`eu_jobs?id=eq.${job.id}`, { method: "PATCH", body: JSON.stringify({ state: retry ? "retry" : "failed", scheduled_at: retry ? new Date(Date.now() + delayMinutes * 60000).toISOString() : job.scheduled_at, lease_owner: null, lease_until: null, last_error: msg }) });
    await db(`eu_job_attempts?job_id=eq.${job.id}&attempt=eq.${attemptNo}`, { method: "PATCH", body: JSON.stringify({ error: msg, finished_at: new Date().toISOString() }) });
    await emitEvent({ orgId: job.org_id, initiativeId: job.initiative_id, eventType: retry ? "job.retry" : "job.failed", entityType: "eu_jobs", entityId: job.id, sourceSystem: "eu-worker", data: { provider: job.provider, action: job.action, error: msg, attempts: job.attempts } });
    return { id: job.id, state: retry ? "retry" : "failed", error: msg };
  }
}

Deno.serve(async (req) => {
  if (!WORKER_SECRET || req.headers.get("x-eu-worker-secret") !== WORKER_SECRET) return json({ error: "unauthorized" }, 401);
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 50);
    const jobs = await rpc("eu_claim_jobs_service", { p_worker: WORKER, p_limit: limit, p_lease_seconds: 180 });
    const results = [];
    for (const job of jobs ?? []) results.push(await runJob(job));
    return json({ ok: true, worker: WORKER, claimed: jobs?.length ?? 0, results });
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "worker failed" }, 500);
  }
});
