import { rest, resolveHouseOrgId } from '../supabase.mjs';
import { previewActorComment, PROMPT_VERSION } from '../actors/generate.mjs';
import { digest } from '../actors/evidence.mjs';
import { personaConfigFromActors } from '../actors/persona.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Canonical records only; never fetch an arbitrary publisher/audio/lyrics URL.
// Future authorized reader adapters can supply richer snapshots to the pure
// preview function, using the same evidence/permission contract.
export async function loadPreviewItem(kind, id, query = rest, { actorMuid } = {}) {
  if (!UUID.test(id || '') || !['news', 'post', 'song'].includes(kind)) throw new Error('Invalid actor preview source');
  const paths = {
    news: `media_news_articles?id=eq.${id}&select=id,title,canonical_url,published_at&limit=1`,
    post: `network_posts?id=eq.${id}&visibility=eq.public&group_id=is.null&deleted_at=is.null&select=id,body,visibility,group_id,author_m_uid,created_at,updated_at&limit=1`,
    song: `music_catalog_objects?id=eq.${id}&status=eq.active&select=id,track_title,artist_name,album_title,credit_line,canonical_url,updated_at,status&limit=1`,
  };
  const { body: rows = [] } = await query(paths[kind]);
  if (!rows[0]) return null;
  const item = { ...rows[0], kind, title: rows[0].title || rows[0].track_title || '', revision: rows[0].updated_at || null };
  if (kind === 'post') {
    if (!UUID.test(actorMuid || '') || !UUID.test(item.author_m_uid || '') || item.visibility !== 'public' || item.group_id || item.deleted_at) return null;
    const { body: replies = [] } = await query(`network_post_comments?post_id=eq.${id}&deleted_at=is.null&select=id,author_m_uid,body,created_at&order=created_at.desc,id.desc&limit=6`);
    const candidates = replies.filter(r => UUID.test(r.id || '') && UUID.test(r.author_m_uid || ''));
    const authors = [...new Set([item.author_m_uid, ...candidates.map(r => r.author_m_uid)])].filter(a => a !== actorMuid);
    const blocked = new Set();
    if (authors.length) {
      const list = authors.join(',');
      const { body: blocks = [] } = await query(`network_blocks?or=(and(blocker_m_uid.eq.${actorMuid},blocked_m_uid.in.(${list})),and(blocked_m_uid.eq.${actorMuid},blocker_m_uid.in.(${list})))&select=blocker_m_uid,blocked_m_uid`);
      for (const b of blocks) blocked.add(b.blocker_m_uid === actorMuid ? b.blocked_m_uid : b.blocker_m_uid);
    }
    if (blocked.has(item.author_m_uid)) return null;
    item.replies = candidates.filter(r => !blocked.has(r.author_m_uid)).reverse().map(r => ({ ...r, visibility: 'public' }));
  }
  return item;
}

export async function actorCommentPreview(job, { query = rest, resolveOrg = resolveHouseOrgId, chat, now = new Date(), personaConfig } = {}) {
  const org = await resolveOrg();
  if (job.org_id !== org || !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(job.target_id || '')) throw new Error('Actor preview outside Core authority');
  const { kind, item_id: itemId, expected_revision: revision } = job.input || {};
  if (!UUID.test(itemId || '') || !['news', 'song', 'post'].includes(kind)) throw new Error('Invalid actor preview source');
  const thinContextMode = job.input?.thin_context_mode ?? 'abstain';
  if (!['abstain', 'question_preview'].includes(thinContextMode)) throw new Error('Invalid thin-context mode');
  const base = { executor: 'actor_comment_preview:v1', published: false, preview: true, actor_key: job.target_id, source_item_id: itemId, kind,
    publication_eligible: false, semantic_gate: 'not_validated', prompt_version: PROMPT_VERSION, expected_prompt_version: job.input?.prompt_version ?? null };
  if (Object.hasOwn(job.input, 'prompt_version') && job.input.prompt_version !== PROMPT_VERSION) {
    return { ...base, status: 'withheld', reason: 'prompt_version_mismatch', review: { approved: false, issues: [] } };
  }
  const { body: actors = [] } = await query(`ops_platform_actors?actor_key=eq.${job.target_id}&org_id=eq.${org}&select=actor_key,m_uid,persona,enabled&limit=1`);
  const item = actors[0] ? await loadPreviewItem(kind, itemId, query, { actorMuid: actors[0].m_uid }) : null;
  if (!actors[0] || !item) return { ...base, status: 'withheld', reason: !actors[0] ? 'actor_unavailable' : 'source_unavailable', review: { approved: false, issues: [] } };
  personaConfig ||= personaConfigFromActors(actors);
  if (personaConfig && !personaConfig.selected_cast.includes(job.target_id)) return { ...base, status: 'withheld', reason: 'actor_outside_selected_cast', review: { approved: false, issues: [] } };
  if (job.input?.persona_config_version && (!personaConfig || personaConfig.version !== job.input.persona_config_version ||
      digest(personaConfig.characters?.find(p => p.actor_key === job.target_id) || null) !== job.input.persona_digest)) {
    return { ...base, status: 'withheld', reason: 'persona_config_changed_or_unavailable', review: { approved: false, issues: [] } };
  }
  // No source text, grants, persona, model override or publish flag is accepted
  // from job.input. Production policy/config is a server dependency.
  const output = await previewActorComment({ item: { ...item, expected_revision: revision }, actor: actors[0],
    personaConfig, evidenceOptions: { now }, jobId: job.id, thinContextMode }, { chat });
  return { ...output, expected_prompt_version: base.expected_prompt_version };
}
