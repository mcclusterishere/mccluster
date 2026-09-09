// Durable Policy OS worker. It consumes eu_jobs leases, validates high-risk
// jobs against the central control plane, runs an adapter, records attempts,
// and converts every receipt/failure back into canonical state/events.
import { SB, SRV, db, emitEvent, json, rpc, safeText, sha256Hex } from "../_shared/eu-policy-os.ts";

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

function renderHtml(b: any, pdfUrl = "", publicationDate = "") {
  const p = b.publication;
  const authors = b.contributors.filter((c: any) => c.is_author).map((c: any) => c.display_name);
  const citationMeta = [
    `<meta name="citation_title" content="${h(p.title)}">`,
    ...authors.map((a: string) => `<meta name="citation_author" content="${h(a)}">`),
    publicationDate ? `<meta name="citation_publication_date" content="${h(publicationDate.slice(0, 10))}">` : "",
    p.doi ? `<meta name="citation_doi" content="${h(p.doi)}">` : "",
    pdfUrl ? `<meta name="citation_pdf_url" content="${h(pdfUrl)}">` : "",
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
  const csl = { id: p.stable_id, type: "report", title: p.title, abstract: p.abstract, author: authors.map((a: string) => { const q = a.trim().split(/\s+/); return { family: q.pop(), given: q.join(" ") }; }), issued: { "date-parts": [[year]] }, publisher: "Equity Uprise / McCluster Corp", DOI: p.doi || undefined, URL: p.canonical_url || undefined };
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
  if (!job.payload?.content_hash || job.payload.content_hash !== v.content_hash) throw new Error("publication content hash changed after approval");
  const expectedRequestHash = await sha256Hex(JSON.stringify({
    action: "publication.publish",
    publication_id: p.id,
    stable_id: p.stable_id,
    version: v.version_label,
    content_hash: v.content_hash,
  }));
  if (job.payload?.request_hash !== expectedRequestHash) throw new Error("publication approval hash does not match current version");

  const base = `publications/${String(p.stable_id).toLowerCase()}/${v.version_label}`;
  const publishedAt = new Date().toISOString();
  let html = renderHtml(b, "", publishedAt);
  const jats = renderJats(b), c = citationExports(b);
  const pdfUrl = await renderPdfIfConfigured(html, `${base}/${p.stable_id}.pdf`);
  if (pdfUrl) html = renderHtml(b, pdfUrl, publishedAt);
  const htmlUrl = await storagePut("equity-uprise-public", `${base}/index.html`, html, "text/html; charset=utf-8");
  const jatsUrl = await storagePut("equity-uprise-public", `${base}/${p.stable_id}.xml`, jats, "application/vnd.jats+xml");
  const bibUrl = await storagePut("equity-uprise-public", `${base}/${p.stable_id}.bib`, c.bibtex, "application/x-bibtex");
  const risUrl = await storagePut("equity-uprise-public", `${base}/${p.stable_id}.ris`, c.ris, "application/x-research-info-systems");
  const cslUrl = await storagePut("equity-uprise-public", `${base}/${p.stable_id}.json`, JSON.stringify(c.csl, null, 2), "application/json");
  await db(`eu_publication_versions?id=eq.${v.id}`, { method: "PATCH", body: JSON.stringify({ html_ref: { url: htmlUrl }, jats_ref: { url: jatsUrl }, pdf_ref: pdfUrl ? { url: pdfUrl } : {}, bibtex: c.bibtex, ris: c.ris, csl_json: c.csl, published_at: publishedAt }) });
  const canonical = p.canonical_url || htmlUrl;
  await db(`eu_publications?id=eq.${p.id}`, { method: "PATCH", body: JSON.stringify({ status: "published", canonical_url: canonical, published_at: publishedAt }) });
  if (p.artifact_id) await db(`eu_artifacts?id=eq.${p.artifact_id}`, { method: "PATCH", body: JSON.stringify({ status: "published", canonical_url: canonical, storage_ref: { html: htmlUrl, pdf: pdfUrl, jats: jatsUrl, bibtex: bibUrl, ris: risUrl, csl: cslUrl } }) });
  await emitEvent({ orgId: job.org_id, initiativeId: p.initiative_id, eventType: "publication.published", entityType: "eu_publications", entityId: p.id, sourceSystem: "eu-worker", data: { stable_id: p.stable_id, version: v.version_label, canonical_url: canonical, pdf: pdfUrl }, idempotencyKey: `publication:${p.id}:published:${v.content_hash}` });
  return { canonical_url: canonical, html: htmlUrl, pdf: pdfUrl, jats: jatsUrl, bibtex: bibUrl, ris: risUrl, csl: cslUrl };
}

function crossrefTimestamp() {
  const d = new Date();
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

async function crossrefRecord(orgId: string, publicationId: string, doi: string) {
  const rows = await db(`eu_external_records?org_id=eq.${orgId}&publication_id=eq.${publicationId}&provider=eq.crossref&record_type=eq.doi-registration&external_id=eq.${encodeURIComponent(doi)}&select=*&limit=1`);
  return rows?.[0] ?? null;
}

async function saveCrossrefRecord(job: any, publicationId: string, doi: string, patch: Record<string, unknown>) {
  const existing = await crossrefRecord(job.org_id, publicationId, doi);
  if (existing) {
    const rows = await db(`eu_external_records?id=eq.${existing.id}`, { method: "PATCH", body: JSON.stringify({ ...patch, last_synced_at: new Date().toISOString() }) });
    return rows?.[0] ?? existing;
  }
  const rows = await db("eu_external_records", { method: "POST", body: JSON.stringify({
    org_id: job.org_id,
    publication_id: publicationId,
    provider: "crossref",
    record_type: "doi-registration",
    external_id: doi,
    state: "submitted",
    ...patch,
    last_synced_at: new Date().toISOString(),
  }) });
  return rows?.[0] ?? null;
}

async function handleCrossrefDeposit(job: any) {
  const user = Deno.env.get("CROSSREF_LOGIN_ID") ?? "", pass = Deno.env.get("CROSSREF_PASSWORD") ?? "", prefix = Deno.env.get("CROSSREF_PREFIX") ?? "";
  if (!user || !pass || !prefix) return { not_configured: true, requires: ["CROSSREF_LOGIN_ID", "CROSSREF_PASSWORD", "CROSSREF_PREFIX"] };
  const b = await publicationBundle(job.payload.publication_id, job.payload.version_label);
  const p = b.publication;
  if (!p.canonical_url) throw new Error("canonical publication must be live before Crossref deposit");
  if (job.payload?.content_hash && job.payload.content_hash !== b.version.content_hash) throw new Error("distribution content hash changed before Crossref deposit");

  const doi = p.doi || `${prefix}/${String(p.stable_id).toLowerCase()}`;
  const ts = crossrefTimestamp();
  const batchId = `${String(p.stable_id).replace(/[^A-Za-z0-9._-]/g, "-")}-${ts}`;
  const fileName = `${batchId}.xml`;
  const names = b.contributors.filter((c: any) => c.is_author).map((c: any, i: number) => {
    const q = String(c.display_name).trim().split(/\s+/); const sur = q.pop() || "";
    return `<person_name contributor_role="author" sequence="${i === 0 ? "first" : "additional"}"><given_name>${x(q.join(" "))}</given_name><surname>${x(sur)}</surname>${c.orcid ? `<ORCID>${x(c.orcid.replace(/^https?:\/\/orcid.org\//, ""))}</ORCID>` : ""}</person_name>`;
  }).join("");
  const year = new Date().getUTCFullYear();
  const xml = `<?xml version="1.0" encoding="UTF-8"?><doi_batch xmlns="http://www.crossref.org/schema/5.3.1" version="5.3.1"><head><doi_batch_id>${x(batchId)}</doi_batch_id><timestamp>${ts}</timestamp><depositor><depositor_name>Equity Uprise</depositor_name><email_address>${x(Deno.env.get("CROSSREF_DEPOSITOR_EMAIL") || "matthew@mccluster.org")}</email_address></depositor><registrant>McCluster Corp / Equity Uprise</registrant></head><body><report-paper publication_type="full_text"><report-paper_metadata language="en"><contributors>${names}</contributors><titles><title>${x(p.title)}</title></titles><publication_date media_type="online"><year>${year}</year></publication_date><publisher><publisher_name>Equity Uprise / McCluster Corp</publisher_name></publisher><doi_data><doi>${x(doi)}</doi><resource>${x(p.canonical_url)}</resource></doi_data></report-paper_metadata></report-paper></body></doi_batch>`;
  const form = new FormData();
  form.set("operation", "doMDUpload");
  form.set("login_id", user);
  form.set("login_passwd", pass);
  form.set("fname", new File([xml], fileName, { type: "application/xml" }));
  const base = Deno.env.get("CROSSREF_DEPOSIT_URL") || "https://doi.crossref.org/servlet/deposit";
  const r = await fetch(base, { method: "POST", body: form });
  const text = await r.text();
  if (!r.ok) throw new Error(`crossref ${r.status}: ${text.slice(0, 800)}`);

  const record = await saveCrossrefRecord(job, p.id, doi, {
    state: "submitted",
    metadata: { doi, doi_batch_id: batchId, file_name: fileName, version_label: b.version.version_label, content_hash: b.version.content_hash },
    receipt: { deposit_http_status: r.status, deposit_response: text.slice(0, 4000), accepted_at: new Date().toISOString() },
  });
  if (job.payload?.delivery_id) {
    await db(`eu_deliveries?id=eq.${job.payload.delivery_id}`, { method: "PATCH", body: JSON.stringify({ state: "submitted", external_id: doi, receipt: { doi, doi_batch_id: batchId, file_name: fileName, queue_response: text.slice(0, 2000) }, submitted_at: new Date().toISOString() }) });
  }

  const verifyRows = await db("eu_jobs", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      org_id: job.org_id,
      initiative_id: job.initiative_id,
      job_type: "publication.crossref.verify",
      provider: "crossref",
      action: "verify-deposit",
      capability: "policy.read",
      resource_type: "eu_publications",
      resource_id: p.id,
      payload: {
        publication_id: p.id,
        version_label: b.version.version_label,
        delivery_id: job.payload?.delivery_id ?? null,
        external_record_id: record?.id ?? null,
        doi,
        doi_batch_id: batchId,
        file_name: fileName,
        content_hash: b.version.content_hash,
      },
      state: "queued",
      scheduled_at: new Date(Date.now() + 2 * 60_000).toISOString(),
      max_attempts: 48,
      idempotency_key: `crossref:${job.payload?.delivery_id || p.id}:verify:${fileName}`,
    }),
  });
  return { submitted: true, doi_candidate: doi, doi_batch_id: batchId, file_name: fileName, verification_job_id: verifyRows?.[0]?.id ?? null, note: "Deposit accepted into Crossref queue; DOI is not marked live until the submission log reports success." };
}

function xmlNumber(xml: string, tag: string) {
  const m = xml.match(new RegExp(`<${tag}>\\s*(\\d+)\\s*</${tag}>`, "i"));
  return m ? Number(m[1]) : null;
}

async function handleCrossrefVerify(job: any) {
  const user = Deno.env.get("CROSSREF_LOGIN_ID") ?? "", pass = Deno.env.get("CROSSREF_PASSWORD") ?? "";
  if (!user || !pass) return { not_configured: true, requires: ["CROSSREF_LOGIN_ID", "CROSSREF_PASSWORD"] };
  const doi = safeText(job.payload?.doi, 300);
  const fileName = safeText(job.payload?.file_name, 500);
  if (!doi || !fileName) return { terminal_failure: true, reason: "Crossref verification job is missing DOI or file name" };

  const endpoint = new URL(Deno.env.get("CROSSREF_LOG_URL") || "https://doi.crossref.org/servlet/submissionDownload");
  endpoint.searchParams.set("usr", user);
  endpoint.searchParams.set("pwd", pass);
  endpoint.searchParams.set("file_name", fileName);
  endpoint.searchParams.set("type", "result");
  const r = await fetch(endpoint);
  const text = await r.text();
  if (r.status === 404 || r.status === 202 || !text.includes("doi_batch_diagnostic")) {
    return { retry: true, retry_after_ms: 5 * 60_000, reason: "Crossref submission log not available yet", http_status: r.status };
  }
  if (!r.ok) throw new Error(`crossref log ${r.status}: ${text.slice(0, 800)}`);

  const failureCount = xmlNumber(text, "failure_count");
  const successCount = xmlNumber(text, "success_count");
  const records = [...text.matchAll(/<record_diagnostic[^>]*status=["']([^"']+)["'][^>]*>[\s\S]*?<doi>\s*([^<]*)\s*<\/doi>[\s\S]*?<\/record_diagnostic>/gi)]
    .map((m) => ({ status: m[1].toLowerCase(), doi: m[2].trim() }));
  const target = records.find((v) => v.doi.toLowerCase() === doi.toLowerCase());
  const success = target?.status === "success" && (failureCount === null || failureCount === 0) && (successCount === null || successCount >= 1);
  const failed = target?.status === "failure" || (failureCount !== null && failureCount > 0 && !success);
  const existing = await crossrefRecord(job.org_id, job.payload.publication_id, doi);
  const receipt = { ...(existing?.receipt ?? {}), submission_log: text.slice(0, 12000), verified_at: new Date().toISOString(), failure_count: failureCount, success_count: successCount };

  if (success) {
    const doiUrl = `https://doi.org/${doi}`;
    if (existing?.id) await db(`eu_external_records?id=eq.${existing.id}`, { method: "PATCH", body: JSON.stringify({ state: "published", external_url: doiUrl, receipt, last_synced_at: new Date().toISOString() }) });
    await db(`eu_publications?id=eq.${job.payload.publication_id}`, { method: "PATCH", body: JSON.stringify({ doi }) });
    if (job.payload?.delivery_id) await db(`eu_deliveries?id=eq.${job.payload.delivery_id}`, { method: "PATCH", body: JSON.stringify({ state: "published", external_id: doi, external_url: doiUrl, receipt, completed_at: new Date().toISOString() }) });
    await emitEvent({ orgId: job.org_id, initiativeId: job.initiative_id, eventType: "publication.crossref_registered", entityType: "eu_publications", entityId: job.payload.publication_id, sourceSystem: "eu-worker", data: { doi, doi_url: doiUrl, file_name: fileName }, idempotencyKey: `crossref:${job.payload.publication_id}:registered:${doi}` });
    return { registered: true, doi, doi_url: doiUrl };
  }
  if (failed) {
    if (existing?.id) await db(`eu_external_records?id=eq.${existing.id}`, { method: "PATCH", body: JSON.stringify({ state: "error", receipt, last_synced_at: new Date().toISOString() }) });
    if (job.payload?.delivery_id) await db(`eu_deliveries?id=eq.${job.payload.delivery_id}`, { method: "PATCH", body: JSON.stringify({ state: "failed", error: "Crossref submission log reported failure", receipt, completed_at: new Date().toISOString() }) });
    return { terminal_failure: true, reason: "Crossref submission log reported failure", doi, log: text.slice(0, 4000) };
  }
  return { retry: true, retry_after_ms: 5 * 60_000, reason: "Crossref submission is still processing" };
}

async function handleCrossref(job: any) {
  if (job.action === "verify-deposit") return handleCrossrefVerify(job);
  if (job.action !== "deliver") throw new Error(`unknown Crossref action ${job.action}`);
  return handleCrossrefDeposit(job);
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
    zenodo: ["ZENODO_TOKEN"], osf: ["OSF_TOKEN"], orcid: ["ORCID_CLIENT_ID", "ORCID_CLIENT_SECRET"],
    "regulations-gov": ["REGULATIONS_GOV_API_KEY"], linkedin: ["LINKEDIN_TOKEN"], tiktok: ["TIKTOK_ACCESS_TOKEN"], youtube: ["GOOGLE_REFRESH_TOKEN"], ddex: ["DDEX_DPID"],
  };
  const requires = envMap[job.provider] ?? [];
  const missing = requires.filter((k) => !Deno.env.get(k));
  if (missing.length) return { not_configured: true, provider: job.provider, requires: missing };
  return { adapter_scaffolded: true, provider: job.provider, blocked: true, reason: "credential is present but provider-specific contract/validation is not enabled in this first scaffold" };
}

async function authorized(job: any) {
  const caps = await db(`control_capabilities?capability=eq.${encodeURIComponent(job.capability || "")}&select=risk&limit=1`);
  if (!caps?.length) return { allowed: false, reason: "unknown_capability" };
  const risk = caps[0].risk;
  if (risk !== "high") return { allowed: true, risk };
  if (!job.approval_id || !job.payload?.request_hash) return { allowed: false, reason: "approval_required", risk };
  const approvals = await db(`control_approvals?id=eq.${job.approval_id}&select=requested_by,state,request_hash,expires_at&limit=1`);
  if (!approvals?.length) return { allowed: false, reason: "approval_missing", risk };
  const a = approvals[0];
  const decision = await rpc("control_authorize_service", { p_actor: a.requested_by, p_org: job.org_id, p_capability: job.capability, p_resource_type: job.resource_type, p_resource_id: job.resource_id, p_request_hash: job.payload.request_hash, p_approval_id: job.approval_id });
  return Array.isArray(decision) ? decision[0] : decision;
}

async function finishAttempt(job: any, attemptNo: number, response: Record<string, unknown>, error = "") {
  await db(`eu_job_attempts?job_id=eq.${job.id}&attempt=eq.${attemptNo}`, { method: "PATCH", body: JSON.stringify({ response, error, finished_at: new Date().toISOString() }) });
}

async function runJob(job: any) {
  const started = new Date().toISOString();
  const attemptNo = Number(job.attempts || 1);
  await db("eu_job_attempts", { method: "POST", body: JSON.stringify({ job_id: job.id, attempt: attemptNo, worker: WORKER, request: { provider: job.provider, action: job.action, payload: job.payload }, started_at: started }) });
  try {
    const auth = await authorized(job);
    if (!auth?.allowed) {
      await db(`eu_jobs?id=eq.${job.id}`, { method: "PATCH", body: JSON.stringify({ state: "waiting-approval", lease_owner: null, lease_until: null, last_error: auth?.reason || "approval required" }) });
      await finishAttempt(job, attemptNo, auth ?? {}, auth?.reason || "approval required");
      return { id: job.id, state: "waiting-approval" };
    }
    await db(`eu_jobs?id=eq.${job.id}`, { method: "PATCH", body: JSON.stringify({ state: "running" }) });
    let result: any;
    if (job.provider === "internal") result = await handleInternal(job);
    else if (job.provider === "crossref") result = await handleCrossref(job);
    else if (job.provider === "openalex") result = await handleOpenAlex(job);
    else result = await handleExternalStub(job);

    if (result?.retry) {
      const canRetry = Number(job.attempts) < Number(job.max_attempts);
      const state = canRetry ? "retry" : "failed";
      const reason = canRetry ? safeText(result.reason, 1000) : `verification retry budget exhausted: ${safeText(result.reason, 900)}`;
      await db(`eu_jobs?id=eq.${job.id}`, { method: "PATCH", body: JSON.stringify({ state, result, scheduled_at: canRetry ? new Date(Date.now() + Math.max(60_000, Number(result.retry_after_ms) || 300_000)).toISOString() : job.scheduled_at, lease_owner: null, lease_until: null, last_error: state === "failed" ? reason : "" }) });
      await finishAttempt(job, attemptNo, result, state === "failed" ? reason : "");
      await emitEvent({ orgId: job.org_id, initiativeId: job.initiative_id, eventType: state === "retry" ? "job.retry" : "job.failed", entityType: "eu_jobs", entityId: job.id, sourceSystem: "eu-worker", data: { provider: job.provider, action: job.action, reason } });
      return { id: job.id, state, result };
    }
    if (result?.terminal_failure) {
      const reason = safeText(result.reason, 1000) || "provider reported terminal failure";
      await db(`eu_jobs?id=eq.${job.id}`, { method: "PATCH", body: JSON.stringify({ state: "failed", result, lease_owner: null, lease_until: null, last_error: reason }) });
      await finishAttempt(job, attemptNo, result, reason);
      await emitEvent({ orgId: job.org_id, initiativeId: job.initiative_id, eventType: "job.failed", entityType: "eu_jobs", entityId: job.id, sourceSystem: "eu-worker", data: { provider: job.provider, action: job.action, reason } });
      return { id: job.id, state: "failed", result };
    }

    const state = result?.not_configured || result?.blocked ? "not-configured" : "succeeded";
    await db(`eu_jobs?id=eq.${job.id}`, { method: "PATCH", body: JSON.stringify({ state, result, lease_owner: null, lease_until: null, last_error: "" }) });
    await finishAttempt(job, attemptNo, result ?? {});
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
