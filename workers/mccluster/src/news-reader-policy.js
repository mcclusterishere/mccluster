/* Native reading is a publication permission, not an iframe trick.
 * Grants are trusted, reviewed deployment configuration, NEVER feed fields.
 * No production publisher has been approved by this module.
 */
export const APPROVED_READER_GRANTS = Object.freeze([]);
export const READER_POLICY_VERSION = 'native-reader/v1';
export const nativeReaderOnly = env => env?.WORLD_NEWS_READER_ONLY === 'true';
const text = x => typeof x === 'string' && x.trim().length > 0;
function httpsUrl(value) {
  if (!text(value) || value.length > 4096) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && !u.hash ? u : null;
  } catch { return null; }
}
function validGrant(g, now) {
  if (!g || g.status !== 'approved' || !text(g.id) || !text(g.reviewer)) return false;
  const reviewed = Date.parse(g.reviewed_at), expires = Date.parse(g.expires_at);
  return Number.isFinite(now) && Number.isFinite(reviewed) && Number.isFinite(expires) &&
    reviewed <= now && now < expires && httpsUrl(g.terms_url) &&
    ['owned', 'licensed', 'public_domain', 'creative_commons'].includes(g.basis) &&
    g.native_layout === true && g.full_text_display === true && g.storage === true &&
    g.automated_ingestion === true && g.attribution_required === true &&
    Array.isArray(g.adapter_ids) && g.adapter_ids.length > 0;
}
export function readerSourceDecision(url, grants = APPROVED_READER_GRANTS, now = Date.now()) {
  const u = httpsUrl(url);
  if (!u) return { allowed: false, reason: 'invalid_source_url' };
  const grant = (Array.isArray(grants) ? grants : []).find(g => {
    if (!validGrant(g, now)) return false;
    // No implicit wildcard/subdomain or whole-domain rights from one article.
    if (g.scope === 'article') return g.canonical_url === u.href;
    if (g.scope !== 'path' || g.hostname !== u.hostname) return false;
    const prefix = g.path_prefix;
    return typeof prefix === 'string' && prefix.startsWith('/') && prefix.endsWith('/') &&
      !prefix.includes('%') && !prefix.includes('..') && u.pathname.startsWith(prefix);
  });
  return grant ? { allowed: true, grant_id: grant.id, grant } : { allowed: false, reason: 'no_current_native_reader_grant' };
}
export function readerArticleDecision(article, grants = APPROVED_READER_GRANTS, now = Date.now()) {
  const source = readerSourceDecision(article?.canonical_url, grants, now);
  if (!source.allowed) return source;
  const deny = reason => ({ allowed: false, reason, grant_id: source.grant_id });
  if (!source.grant.adapter_ids.includes(article.adapter_id)) return deny('unapproved_content_adapter');
  if (!text(article.title) || !text(article.publisher) || !text(article.byline) || !text(article.attribution)) return deny('missing_original_attribution');
  // No summary masquerading as an article; no untrusted publisher HTML/scripts.
  if (article.body?.complete !== true || article.body?.format !== 'text_blocks') return deny('full_text_not_available');
  const blocks = article.body.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > 2000 ||
      blocks.some(b => !b || !['paragraph', 'heading', 'quote'].includes(b.type) || !text(b.text) || b.text.length > 40000)) return deny('invalid_text_blocks');
  if (blocks.reduce((n, b) => n + b.text.length, 0) > 300000) return deny('article_too_large');
  // Each adapter must record how required credits/links/notices were preserved.
  if (article.requirements_reviewed !== true) return deny('publisher_requirements_unchecked');
  return { allowed: true, grant_id: source.grant_id, policy: READER_POLICY_VERSION,
    attribution: article.attribution, canonical_url: article.canonical_url,
    images_allowed: false, rendered_as: 'text_blocks' };
}
export function filterReaderArticles(articles, grants = APPROVED_READER_GRANTS, now = Date.now()) {
  const accepted = [], rejected = {};
  for (const article of Array.isArray(articles) ? articles : []) {
    const d = readerArticleDecision(article, grants, now);
    if (d.allowed) accepted.push(article);
    else rejected[d.reason] = (rejected[d.reason] || 0) + 1;
  }
  return { accepted, rejected, policy: READER_POLICY_VERSION };
}
