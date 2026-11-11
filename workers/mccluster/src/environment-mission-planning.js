/* Internal, preparation-only McCluster adapter. Inputs must be server-loaded
 * canonical rows after house-owner authorization, never browser assertions.
 * No network, persistence, approvals, recipient selection or send capability. */
import { ENVIRONMENT_ACTIONS } from '../../../vendor/equity-uprise/src/environment/evidence.mjs';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86400000;
const validText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const validProse = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(v);
const timestamp = v => typeof v === 'string' ? Date.parse(v) : NaN;
function publicUrl(v) {
  try { const u = new URL(v); return typeof v === 'string' && v.length <= 2000 && ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}
function requireValue(condition, code) { if (!condition) throw new TypeError(code); }
function articleSnapshot(article) {
  requireValue(UUID.test(article?.id) && validText(article.title, 1000) && publicUrl(article.canonical_url), 'invalid_article');
  requireValue(['gdelt_gkg_v2', 'gdelt_doc_v2'].includes(article.ingestion_provider), 'unsupported_news_provider');
  requireValue(Number.isFinite(timestamp(article.published_at)), 'missing_news_seen_time');
  return { id: article.id, title: article.title, canonical_url: article.canonical_url,
    ingestion_provider: article.ingestion_provider, seen_at: article.published_at,
    imported_at: article.imported_at ?? null };
}
/** Exact revision anchors a canonical ops recommendation to retained metadata.
 * published_at in this ingestion is labelled seen_at, not verified publication. */
export async function environmentNewsRevision(article) {
  const bytes = new TextEncoder().encode(JSON.stringify(articleSnapshot(article)));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('');
}
function currentEvent(event, actionId, now) {
  const action = ENVIRONMENT_ACTIONS.find(a => a.id === actionId);
  requireValue(action && event?.actions?.some(a => a.id === actionId), 'action_not_available');
  requireValue(validText(event.id, 300) && validText(event.title, 180) && publicUrl(event.source?.url), 'invalid_source_event');
  const age = now - timestamp(event.observed_at);
  requireValue(['nws', 'eonet', 'usgs', 'nhc'].includes(event.source?.id) && event.id.startsWith(`${event.source.id}:`), 'unsupported_source');
  requireValue(event.stale === false && Number.isFinite(age) && age >= -60000 && age <= (event.source.id === 'eonet' ? 30 * DAY : DAY), 'source_not_current');
  requireValue(event.expires_at == null || timestamp(event.expires_at) > now, 'source_expired');
  return action;
}
/** Returns a transient preview, never a saved/approved mission. Review records
 * follow the PENDING contract documented in ENVIRONMENT-MISSION-PLANNING.md. */
export async function prepareEnvironmentMission({ orgId, event, actionId, articles = [], reviews = [], now = Date.now() }) {
  requireValue(UUID.test(orgId) && Number.isFinite(now), 'invalid_context');
  requireValue(Array.isArray(articles) && articles.length <= 100 && Array.isArray(reviews) && reviews.length <= 100, 'bounded_inputs_required');
  const action = currentEvent(event, actionId, now);
  const news = [], excluded = [], seen = new Set();
  for (const article of articles) {
    let snapshot, revision;
    try { snapshot = articleSnapshot(article); revision = await environmentNewsRevision(article); }
    catch { excluded.push({ article_id: UUID.test(article?.id) ? article.id : null, reason: 'invalid_article' }); continue; }
    if (seen.has(snapshot.canonical_url)) continue;
    seen.add(snapshot.canonical_url);
    const age = now - timestamp(snapshot.seen_at);
    if (age < 0 || age > DAY) { excluded.push({ article_id: snapshot.id, reason: 'outside_daily_window' }); continue; }
    const review = reviews.find(r => {
      const p = r?.proposed_action;
      return UUID.test(r?.id) && r.org_id === orgId && r.status === 'approved' && r.recommendation_type === 'environment_news_context' &&
        timestamp(r.decided_at) <= now && timestamp(r.decided_at) >= timestamp(snapshot.imported_at) &&
        now - timestamp(r.decided_at) <= DAY && p?.schema === 'environment-news-context/v1' &&
        UUID.test(p.reviewer_id) && p.scope === 'news_context_only_not_mission_or_outreach_approval' &&
        p.event_id === event.id && p.article_id === snapshot.id && p.article_revision === revision &&
        validText(p.headline_excerpt, 1000) && snapshot.title.includes(p.headline_excerpt) && validProse(r.rationale, 2000);
    });
    if (!review) { excluded.push({ article_id: snapshot.id, reason: 'current_canonical_review_required' }); continue; }
    news.push({ ...snapshot, revision, review_id: review.id, reviewed_at: review.decided_at,
      headline_excerpt: review.proposed_action.headline_excerpt, relevance_rationale: review.rationale,
      evidence_kind: 'reported_headline_claim', location_verified: false, publication_time_verified: false });
  }
  return { schema: 'environment-mission-preview/v1', org_id: orgId, preparation_only: true,
    generated_at: new Date(now).toISOString(), event_id: event.id, action_id: action.id,
    title: `${action.title}: ${event.title}`, description: action.description, proof: action.proof, safety: action.safety,
    primary_source: { event_id: event.id, title: event.title, url: event.source.url, provider: event.source.id,
      observed_at: event.observed_at, fetched_at: event.fetched_at ?? null, expires_at: event.expires_at ?? null },
    news, excluded, news_context_ready: news.length > 0,
    attribution: { label: 'GDELT Project', url: 'https://www.gdeltproject.org/' },
    warnings: ['News is a reported claim, not verified environmental fact or proof of injustice.',
      'Headline review does not verify event geography. No article body was retrieved.',
      'Owner must review relevance, safe scope and current official advice before proposing or opening a mission.'],
    required_next_steps: ['Recheck current source through canonical mission proposal endpoint.', 'Use canonical owner mission review; this preview grants no approval.'] };
}
/** Alignment is a hypothesis supported by exact CRM notes, not inferred company
 * facts. No contact/email or consent is selected or fabricated. */
export function prepareEnvironmentSponsorDraft({ preview, company, alignmentExcerpt }) {
  requireValue(preview?.schema === 'environment-mission-preview/v1' && preview.preparation_only === true && preview.news_context_ready === true && preview.news?.length > 0, 'reviewed_news_preview_required');
  requireValue(UUID.test(company?.id) && company.org_id === preview.org_id && validText(company.name, 300), 'canonical_company_required');
  requireValue(['new', 'contacted', 'replied', 'partner', 'declined'].includes(company.status), 'invalid_company_status');
  requireValue(company.status !== 'declined', 'company_declined');
  requireValue(validProse(company.notes, 20000) && validProse(alignmentExcerpt, 1500) && company.notes.includes(alignmentExcerpt), 'exact_crm_alignment_evidence_required');
  const citations = preview.news.slice(0, 3).map(n => ({ article_id: n.id, review_id: n.review_id, revision: n.revision,
    title: n.title, url: n.canonical_url, seen_at: n.seen_at }));
  const total = preview.news.length;
  const fitParagraph = `Owner verification required: internal CRM notes for ${company.name} state “${alignmentExcerpt}”. These notes are not verified public facts. They suggest a possible connection to this remote research mission, but the owner must verify their accuracy, relevance and suitability for sharing before any outreach.`;
  const renderBody = () => `We are exploring a remote environmental research mission: ${preview.title}.\n\n` +
    `The primary source is ${preview.primary_source.url} (observed ${preview.primary_source.observed_at}).\n\n` +
    `News context, discovered via GDELT, reports the following headlines. These are claims, not independent verification. Includes ${citations.length} of ${total} reviewed headlines; limited to at most 3 complete citations and a 12,000-character draft.\n` +
    citations.map(n => `“${n.title}”\n${n.url}\nGDELT seen time: ${n.seen_at}`).join('\n\n') +
    `\n\n${fitParagraph}\n\nWould your team be interested in discussing whether this proposed mission fits your work? No partnership or funding commitment has been made.`;
  while (citations.length && renderBody().length > 12000) citations.pop();
  const body = renderBody();
  requireValue(citations.length > 0 && body.length <= 12000, 'draft_bounds_exceeded');
  return { schema: 'environment-sponsor-draft/v1', preparation_only: true, company_id: company.id,
    org_id: company.org_id, recipient: null, consent: null, partnership_established: false,
    alignment: { kind: 'hypothesis_for_owner_review', source: 'out_companies.notes', excerpt: alignmentExcerpt,
      verification_required: true, public_facts_verified: false },
    subject: `For review: possible support for ${preview.title}`,
    body, citation_total: total, citation_included: citations.length,
    citation_limitation: 'At most 3 complete reviewed headlines; fewer if needed to keep the full draft within 12,000 characters. Omitted headlines are not represented as cited.',
    citations, gates: ['Owner verifies the CRM alignment evidence and proposed mission.',
      'Resolve recipient and consent from canonical out_contacts; do not infer either.',
      'Obtain applicable approval for the exact recipient, message and any commitment.',
      'Any future send must use canonical out_campaigns/out_recipients/out_events and preserve provider linkage.'] };
}

/** Deterministic lexical hints from canonical notes, not a prediction of fit. */
export function prepareEnvironmentSponsorCandidates({ preview, companies }) {
  requireValue(preview?.news_context_ready === true, 'reviewed_news_preview_required');
  requireValue(Array.isArray(companies) && companies.length <= 50, 'bounded_inputs_required');
  const stop = new Set(['about', 'after', 'before', 'their', 'there', 'these', 'those', 'would', 'could', 'should', 'information', 'announced', 'publishes', 'published', 'resource', 'resources', 'verify', 'local', 'support', 'environmental']);
  const tokens = value => [...new Set((value.toLowerCase().match(/[a-z]{5,}/g) || []).filter(term => !stop.has(term)))];
  const terms = new Set(tokens([preview.title, ...preview.news.map(article => article.title)].join(' ')));
  const candidates = [];
  for (const company of companies) {
    if (!UUID.test(company?.id) || company.org_id !== preview.org_id || !validText(company.name, 300) ||
      !['new', 'contacted', 'replied', 'partner'].includes(company.status) || !validProse(company.notes, 20000)) continue;
    const lines = company.notes.split(/[\r\n]+/).map(line => line.trim().slice(0, 1500)).filter(line => validProse(line, 1500));
    const ranked = lines.map(excerpt => ({ excerpt, matched_terms: tokens(excerpt).filter(term => terms.has(term)) }))
      .filter(line => line.matched_terms.length).sort((a, b) => b.matched_terms.length - a.matched_terms.length);
    if (!ranked.length) continue;
    candidates.push({ company_id: company.id, name: company.name, alignmentExcerpt: ranked[0].excerpt,
      matched_terms: ranked[0].matched_terms, basis: 'exact_word_overlap_in_canonical_company_notes',
      fit: 'unverified_hypothesis' });
  }
  candidates.sort((a, b) => b.matched_terms.length - a.matched_terms.length || a.name.localeCompare(b.name) || a.company_id.localeCompare(b.company_id));
  return { schema: 'environment-sponsor-candidates/v1', preparation_only: true, candidates, limit: 50,
    warning: 'Word overlap is only a candidate hint, not established alignment or a partnership. No contacts or recipients were selected.' };
}

/** Host-owned service. authorizeOwner MUST authenticate and check the canonical
 * house owner on every invocation; an admin label/client flag is insufficient.
 * All repository methods are injected authenticated server adapters. */
export function createEnvironmentPlanningService({ authorizeOwner, repository, now = Date.now }) {
  requireValue(typeof authorizeOwner === 'function' && repository && typeof now === 'function', 'server_adapters_required');
  async function context() {
    const principal = await authorizeOwner();
    if (!principal || !UUID.test(principal.orgId) || !UUID.test(principal.actorId)) {
      throw Object.assign(new Error('owner_only'), { status: 403 });
    }
    return principal;
  }
  async function inputs(principal, { eventId, actionId }) {
    requireValue(validText(eventId, 300), 'invalid_event_id');
    const event = await repository.readEvent(principal, eventId);
    requireValue(event?.id === eventId, 'source_event_unavailable');
    currentEvent(event, actionId, now());
    const articles = await repository.readArticles(principal, eventId);
    requireValue(Array.isArray(articles) && articles.length <= 100, 'bounded_inputs_required');
    return { event, actionId, articles, orgId: principal.orgId };
  }
  async function planFor(principal, request) {
    const input = await inputs(principal, request);
    const reviews = await repository.readReviews(principal, request.eventId);
    return prepareEnvironmentMission({ ...input, reviews, now: now() });
  }
  return Object.freeze({
    async listContext(request) {
      const principal = await context(), input = await inputs(principal, request);
      const articles = [], excluded = [];
      for (const article of input.articles) {
        try {
          const snapshot = articleSnapshot(article);
          articles.push({ ...snapshot, revision: await environmentNewsRevision(article),
            within_daily_window: now() >= timestamp(snapshot.seen_at) && now() - timestamp(snapshot.seen_at) <= DAY,
            state: 'candidate_only', evidence_kind: 'reported_headline_claim' });
        } catch { excluded.push({ article_id: UUID.test(article?.id) ? article.id : null, reason: 'invalid_article' }); }
      }
      return { schema: 'environment-news-candidates/v1', event_id: input.event.id, articles, excluded,
        warning: 'Candidates are not verified event matches. Select an exact headline excerpt and explain relevance before approving context.' };
    },
    async reviewContext(request) {
      const principal = await context(), input = await inputs(principal, request);
      requireValue(UUID.test(request.articleId), 'invalid_article_id');
      const article = input.articles.find(a => a.id === request.articleId);
      requireValue(article, 'article_unavailable');
      const snapshot = articleSnapshot(article), revision = await environmentNewsRevision(article), clock = now();
      requireValue(request.revision === revision, 'article_changed_reload_required');
      requireValue(clock >= timestamp(snapshot.seen_at) && clock - timestamp(snapshot.seen_at) <= DAY &&
        timestamp(snapshot.imported_at) <= clock, 'news_not_current');
      requireValue(validText(request.headlineExcerpt, 1000) && snapshot.title.includes(request.headlineExcerpt), 'exact_headline_excerpt_required');
      requireValue(validProse(request.rationale, 2000), 'relevance_rationale_required');
      const record = { org_id: principal.orgId, recommendation_type: 'environment_news_context',
        title: `Environmental news context: ${snapshot.title}`, rationale: request.rationale,
        status: 'approved', decided_at: new Date(clock).toISOString(),
        proposed_action: { schema: 'environment-news-context/v1', event_id: input.event.id,
          article_id: snapshot.id, article_revision: revision, headline_excerpt: request.headlineExcerpt,
          reviewer_id: principal.actorId, article_snapshot: snapshot,
          confidence_basis: 'canonical_database_default_not_a_model_score',
          scope: 'news_context_only_not_mission_or_outreach_approval' } };
      const saved = await repository.saveNewsReview(principal, record);
      requireValue(UUID.test(saved?.id) && saved.org_id === principal.orgId && saved.status === 'approved' &&
        saved.proposed_action?.article_revision === revision, 'review_persistence_unconfirmed');
      return { ok: true, review_id: saved.id, article_id: snapshot.id, revision,
        scope: 'news_context_only_not_mission_or_outreach_approval' };
    },
    async plan(request) { return planFor(await context(), request); },
    async companies(request) {
      const principal = await context();
      const preview = await planFor(principal, request);
      const companies = await repository.readCompanies(principal);
      return prepareEnvironmentSponsorCandidates({ preview, companies });
    },
    async sponsorDraft(request) {
      const principal = await context();
      requireValue(UUID.test(request.companyId), 'invalid_company_id');
      const preview = await planFor(principal, request);
      const company = await repository.readCompany(principal, request.companyId);
      requireValue(company?.id === request.companyId, 'company_unavailable');
      return prepareEnvironmentSponsorDraft({ preview, company, alignmentExcerpt: request.alignmentExcerpt });
    }
  });
}
