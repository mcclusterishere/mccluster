/* Canonical McCluster server adapter. Not routed until explicitly integrated.
 * Never call this from a public/browser bundle. No send implementation. */
import { createEnvironmentPlanningService } from './environment-mission-planning.js';
import { service, uuid, isHouseOwner } from './world-cctv.js';
import { bearerUser } from './world-layers.js';
const FIELDS = 'id,title,canonical_url,published_at,imported_at,ingestion_provider';
const REVIEW_FIELDS = 'id,org_id,recommendation_type,title,rationale,status,decided_at,proposed_action';
const query = (table, fields, filters) => `${table}?${new URLSearchParams({ select: fields, ...filters })}`;

export const ENVIRONMENT_PLANNING_ERROR_CODES = Object.freeze([
  'owner_only', 'invalid_context', 'invalid_event_id', 'invalid_article_id', 'invalid_company_id',
  'invalid_article', 'unsupported_news_provider', 'missing_news_seen_time', 'bounded_inputs_required',
  'source_event_unavailable', 'invalid_source_event', 'unsupported_source', 'source_not_current', 'source_expired',
  'action_not_available', 'article_unavailable', 'article_changed_reload_required', 'news_not_current',
  'exact_headline_excerpt_required', 'relevance_rationale_required', 'reviewed_news_preview_required',
  'canonical_company_required', 'invalid_company_status', 'company_unavailable', 'company_declined', 'exact_crm_alignment_evidence_required', 'draft_bounds_exceeded',
  'review_persistence_unconfirmed', 'review_persistence_unavailable', 'planning_unavailable'
]);
function typed(operation) {
  return async (...args) => {
    try { return await operation(...args); } catch (error) {
      const code = ENVIRONMENT_PLANNING_ERROR_CODES.includes(error.message) ? error.message : 'planning_unavailable';
      const status = code === 'owner_only' ? 403 : /unavailable|persistence/.test(code) ? 503 :
        /changed|current|expired|action_not_available/.test(code) ? 409 : 400;
      throw Object.assign(new Error(code), { code, status });
    }
  };
}

export function createMcClusterEnvironmentPlanning({ request, env, readEvent, fetchImpl = fetch, now = Date.now }) {
  if (typeof readEvent !== 'function') throw new TypeError('readEvent adapter required');
  const read = path => service(env, path, fetchImpl);
  async function authorizeOwner() {
    const user = await bearerUser(request, env, fetchImpl);
    if (!uuid(user?.id) || !(await isHouseOwner(env, user.id, fetchImpl))) return null;
    const [org] = await read('orgs?slug=eq.mccluster&select=id&limit=1');
    return uuid(org?.id) ? { actorId: user.id, orgId: org.id } : null;
  }
  const repository = {
    readEvent: (_principal, eventId) => readEvent(eventId),
    // A bounded DAILY candidate pool, not a claim of relevant location matching.
    // No Halo pair rows, raw article body or private location enter this adapter.
    readArticles: () => read(query('media_news_articles', FIELDS, {
      ingestion_provider: 'in.(gdelt_gkg_v2,gdelt_doc_v2)',
      published_at: `gte.${new Date(now() - 86400000).toISOString()}`,
      order: 'published_at.desc,id.asc', limit: '100'
    })),
    async readReviews(principal, eventId) {
      const rows = await read(query('ops_recommendations', REVIEW_FIELDS, {
        org_id: `eq.${principal.orgId}`, recommendation_type: 'eq.environment_news_context',
        'proposed_action->>event_id': `eq.${eventId}`, order: 'decided_at.desc', limit: '100'
      }));
      const reviewers = new Map();
      for (const row of rows) {
        const reviewer = row.proposed_action?.reviewer_id;
        if (uuid(reviewer) && !reviewers.has(reviewer)) reviewers.set(reviewer, await isHouseOwner(env, reviewer, fetchImpl));
      }
      return rows.filter(row => reviewers.get(row.proposed_action?.reviewer_id) === true);
    },
    readCompanies: principal => read(query('out_companies', 'id,org_id,name,notes,status', {
      org_id: `eq.${principal.orgId}`, status: 'in.(new,contacted,replied,partner)', order: 'name.asc,id.asc', limit: '50'
    })),
    readCompany: async (principal, companyId) => (await read(query('out_companies', 'id,org_id,name,notes,status', {
      id: `eq.${companyId}`, org_id: `eq.${principal.orgId}`, limit: '1'
    })))[0] || null,
    async saveNewsReview(principal, record) {
      // Recheck immediately before the privileged write. Approval is the explicit
      // owner review action, not a model recommendation or a client-supplied role.
      if (!(await isHouseOwner(env, principal.actorId, fetchImpl))) throw Object.assign(new Error('owner_only'), { status: 403 });
      const response = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/ops_recommendations`, {
        method: 'POST', headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', prefer: 'return=representation' },
        body: JSON.stringify(record)
      });
      if (!response.ok) throw Object.assign(new Error('review_persistence_unavailable'), { status: 503 });
      const rows = await response.json();
      return Array.isArray(rows) ? rows[0] : null;
    }
  };
  const planning = createEnvironmentPlanningService({ authorizeOwner, repository, now });
  return Object.freeze({
    context: typed(async request => {
      const candidates = await planning.listContext(request);
      const preview = await planning.plan(request);
      return { ...candidates, reviewed: preview.news, limit: 100,
        coverage: 'At most 100 latest retained GDELT headlines from the past 24 hours; not comprehensive or automatically matched to this event.' };
    }),
    review: typed(request => planning.reviewContext(request)),
    plan: typed(request => planning.plan(request)),
    companies: typed(request => planning.companies(request)),
    sponsorDraft: typed(request => planning.sponsorDraft(request)),
    async approvedContext({ eventId, reviewId, actionId = 'resource-check' }) {
      if (!uuid(reviewId)) return null;
      let preview;
      try { preview = await planning.plan({ eventId, actionId }); }
      catch (error) {
        if (['source_event_unavailable', 'source_not_current', 'source_expired', 'action_not_available'].includes(error.message)) return null;
        throw error;
      }
      const news = preview.news.find(article => article.review_id === reviewId);
      if (!news) return null;
      // Deliberately omit reviewer identity, rationale, CRM and ops metadata.
      return { schema: 'environment-news-attribution/v1', article_id: news.id, review_id: news.review_id,
        title: news.title, url: news.canonical_url, seen_at: news.seen_at, revision: news.revision,
        attribution: { label: 'GDELT Project', url: 'https://www.gdeltproject.org/' },
        notice: 'Reported headline claim. Review does not verify environmental fact, event geography or publication time.' };
    }
  });
}
