import { createHash } from 'node:crypto';
import { readerSourceDecision, readerArticleDecision } from './news-reader-policy.mjs';

export const EVIDENCE_VERSION = 'actor-evidence/v1';
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const str = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const url = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null; } catch { return null; } };
export function boundedText(value, maxBytes) {
  let out = '', bytes = 0;
  for (const char of String(value || '')) { bytes += Buffer.byteLength(char); if (bytes > maxBytes) break; out += char; }
  return out;
}

// Only server-supplied grants enter this argument. A feed/source cannot grant itself rights.
export function buildActorEvidence(item, { readerGrants = [], contentGrants = [], now = new Date(), maxBytes = 6000 } = {}) {
  if (!['news', 'song', 'post'].includes(item?.kind) || !str(item.id, 160)) throw new Error('Actor evidence requires a typed canonical item ID');
  if (!Number.isInteger(maxBytes) || maxBytes < 256 || maxBytes > 6000) throw new Error('Invalid evidence budget');
  const revision = str(item.revision || item.updated_at, 160) || null;
  const packet = { schema: EVIDENCE_VERSION, item: { kind: item.kind, id: str(item.id, 160), revision,
    canonical_url: url(item.canonical_url), title: str(item.title, 500),
    // GDELT published_at is discovery time; never relabel it as publisher time.
    discovered_at: date(item.discovered_at || (item.kind === 'news' ? item.published_at : null)),
    published_at: date(item.kind === 'news' ? item.publisher_published_at : item.created_at),
    updated_at: date(item.updated_at) }, access: { level: 'unavailable', reason: 'no_content', full_text_received: false,
      full_text_in_context: false, audio_observed: false }, sources: [], unknowns: [], captured_at: date(now) };
  let remaining = maxBytes;
  const add = (type, text, provenance = {}) => {
    if (!str(text, 1) || remaining <= 0) return false;
    const kept = boundedText(text, remaining); remaining -= Buffer.byteLength(kept);
    const contentHash = digest(text);
    packet.sources.push({ source_id: `${item.kind}:${item.id}:${type}:${contentHash.slice(0, 16)}`, type, text: kept,
      content_sha256: contentHash, context_sha256: digest(kept), truncated: kept !== text, ...provenance });
    return kept === text;
  };
  const meta = type => ({ revision, attribution: str(item.attribution || item.artist_name, 500) || null,
    url: packet.item.canonical_url, observed_at: date(item.observed_at) || packet.captured_at, basis: type });
  if (item.kind === 'post' && (item.visibility !== 'public' || item.deleted_at || item.group_id)) {
    packet.item.title = ''; packet.access.reason = 'not_public'; packet.unknowns.push('private_or_group_context_excluded');
  } else if (item.status === 'archived' || item.deleted_at) {
    packet.access.reason = 'removed';
  } else if (item.expected_revision && item.expected_revision !== revision) {
    packet.access.reason = 'stale_revision'; packet.unknowns.push('source_changed_since_selection');
  } else {
    if (packet.item.title) { add(item.kind === 'news' ? 'headline' : 'title', packet.item.title, meta('public_metadata')); packet.access.level = 'headline'; }
    if (item.kind === 'news') {
      const source = readerSourceDecision(item.canonical_url, readerGrants, now.getTime());
      const full = readerArticleDecision(item, readerGrants, now.getTime());
      const content = item.body;
      if (source.allowed && source.grant.adapter_ids.includes(item.adapter_id) && item.requirements_reviewed === true &&
          str(item.attribution) && str(item.publisher) && str(item.byline) && content?.format === 'text_blocks' &&
          Array.isArray(content.blocks) && content.blocks.length > 0 && content.blocks.length <= 2000 &&
          content.blocks.every(b => ['paragraph', 'heading', 'quote'].includes(b?.type) && typeof b.text === 'string' && b.text.length <= 40000) &&
          content.blocks.reduce((n, b) => n + b.text.length + 2, 0) <= 300000) {
        const text = content.blocks.map(b => b.text).join('\n\n');
        if (text.length <= 300000 && text.trim()) {
          const fits = add('article', text, { ...meta('authorized_publisher_text'), grant_id: source.grant_id });
          packet.access = { ...packet.access, level: full.allowed && fits ? 'full' : 'partial',
            reason: full.allowed && fits ? 'authorized_complete_text' : 'partial_or_budget_limited',
            full_text_received: full.allowed, full_text_in_context: full.allowed && fits };
        }
      }
      if (!packet.sources.some(s => s.type === 'article')) packet.access.reason = source.allowed ? 'article_text_unavailable' : source.reason;
      if (!packet.access.full_text_in_context) packet.unknowns.push('full_article_not_in_context');
      if (!packet.item.published_at) packet.unknowns.push('publisher_date_unknown');
      if (packet.item.published_at && now.getTime() - Date.parse(packet.item.published_at) > 7 * 86400000) packet.unknowns.push('older_article_not_breaking_news');
    } else if (item.kind === 'song') {
      const catalog = [item.artist_name && `Artist: ${str(item.artist_name)}`, item.album_title && `Album: ${str(item.album_title)}`, item.credit_line && `Credit: ${str(item.credit_line)}`].filter(Boolean).join('\n');
      if (catalog) add('catalog', catalog, meta('public_catalog'));
      packet.access.reason = 'catalog_only';
      const grant = contentGrants.find(g => g.status === 'approved' && g.item_id === item.id && g.revision === revision &&
        str(g.id) && str(g.reviewer) && date(g.reviewed_at) && Date.parse(g.reviewed_at) <= now.getTime() &&
        Date.parse(g.expires_at) > now.getTime() && g.automated_analysis === true && g.scope === 'lyrics');
      if (item.lyrics?.revision && item.lyrics.revision !== revision) packet.unknowns.push('stale_lyrics_excluded');
      else if (grant && revision && item.lyrics?.revision === revision && str(item.lyrics.text)) {
        const fits = add('lyrics', item.lyrics.text, { ...meta('authorized_lyrics'), grant_id: grant.id });
        packet.access.level = fits && item.lyrics.complete === true ? 'full' : 'partial'; packet.access.reason = 'lyrics_only';
      }
      // Text-only local Qwen has no audio input, regardless of URLs or source claims.
      packet.unknowns.push('audio_not_observed');
      if (!packet.sources.some(s => s.type === 'lyrics')) packet.unknowns.push('lyrics_not_available');
    } else {
      if (str(item.body)) { const fits = add('post', item.body, { ...meta('public_post_statement'), author_id: str(item.author_m_uid, 160) || null });
        packet.access.level = fits ? 'full' : 'partial'; packet.access.reason = 'public_post'; }
      for (const reply of (Array.isArray(item.replies) ? item.replies : []).slice(-6)) {
        if (reply.visibility !== 'public' || reply.deleted_at || !str(reply.id)) continue;
        add(`reply:${str(reply.id, 160)}`, boundedText(reply.body, 600), { ...meta('public_reply_statement'), author_id: str(reply.author_m_uid, 160) || null });
      }
      packet.unknowns.push('author_statements_not_independently_verified');
    }
  }
  packet.evidence_sha256 = digest({ item: packet.item, access: packet.access, sources: packet.sources.map(({ observed_at, ...s }) => s), unknowns: packet.unknowns });
  return packet;
}

export function evidenceReceipt(packet) {
  return { ...packet, sources: packet.sources.map(({ text, ...source }) => ({ ...source, context_bytes: Buffer.byteLength(text) })) };
}
