import { rest, resolveHouseOrgId } from '../supabase.mjs';
import { localAiChat } from '../compute/local-ai-client.mjs';
import { previewActorComment, validateCommentFormat } from '../actors/generate.mjs';
import { personaConfigFromActors } from '../actors/persona.mjs';
import { buildActorEvidence } from '../actors/evidence.mjs';

export function isNewsCandidate(article) {
  const title = String(article?.title || '').trim();
  if (title.split(/\s+/).length < 5 || title.length < 25) return false;
  try {
    const url = new URL(article.canonical_url);
    if (!['https:', 'http:'].includes(url.protocol)) return false;
    if (/\/(?:people|authors?|staff|profiles?|marketplace|jobs|careers|tags?|category|obituaries)(?:\/|$)/i.test(url.pathname)) return false;
  } catch { return false; }
  return true;
}

export const validateActorComment = validateCommentFormat;

export async function actorNewsComment(job, { query = rest, chat = localAiChat, resolveOrg = resolveHouseOrgId, now = new Date(), thinContextMode = 'abstain' } = {}) {
  const orgId = await resolveOrg();
  if (job.org_id !== orgId || !/^[a-z0-9][a-z0-9._-]{2,39}$/.test(job.target_id || '')) throw new Error('Actor job outside Core authority');
  const actorKey = job.target_id;
  const base = { executor: 'actor_news_comment:v2', actor_key: actorKey };
  const { body: prior } = await query(`ops_actor_publications?job_id=eq.${job.id}&select=id,comment_id,article_id,actor_key&limit=1`);
  if (prior?.length) {
    if(prior[0].actor_key!==actorKey) throw new Error('Actor receipt mismatch');
    return {...base,published:true,publication_id:prior[0].id,comment_id:prior[0].comment_id,article_id:prior[0].article_id,replayed:true};
  }
  const {body:actors} = await query(`ops_platform_actors?actor_key=eq.${actorKey}&org_id=eq.${orgId}&select=actor_key,enabled,daily_limit,persona&limit=1`);
  const actor=actors?.[0];
  if (!actor?.enabled) return {...base,published:false,reason:'actor_paused'};
  const personaConfig = personaConfigFromActors([{ ...actor, actor_key: actorKey }]);
  if (personaConfig && !personaConfig.selected_cast.includes(actorKey)) return { ...base, published: false, reason: 'actor_paused' };
  const since=new Date(now.getTime()-86400000).toISOString();
  const {body:recent=[]} = await query(`ops_actor_publications?actor_key=eq.${actorKey}&created_at=gte.${encodeURIComponent(since)}&select=article_id,body&order=created_at.desc&limit=3`);
  if (recent.length>=actor.daily_limit) return {...base,published:false,reason:'daily_limit'};
  const {body:articles=[]} = await query(`media_news_articles?published_at=gte.${encodeURIComponent(since)}&select=id,title,canonical_url,published_at&order=published_at.desc,id.desc&limit=20`);
  const article=articles.find(a=>isNewsCandidate(a)&&!recent.some(p=>p.article_id===a.id));
  if (!article) return {...base,published:false,reason:'no_recent_article'};
  const preview = await previewActorComment({
    item: { ...article, kind: 'news' }, actor: { ...actor, actor_key: actorKey },
    previous: recent.map(r => r.body), jobId: job.id, evidenceOptions: { now }, personaConfig, thinContextMode,
  }, { chat });
  const audit = { provenance: preview.provenance, persona: preview.persona, disclosure: preview.disclosure,
    prompt_version: preview.prompt_version, prompt_sha256: preview.prompt_sha256, metrics: preview.metrics, review: preview.review,
    publication_eligible: false, semantic_gate: preview.semantic_gate,
    ...(preview.comment ? { candidate: { comment: preview.comment, evidence: preview.evidence, claim_audit: preview.claim_audit } } : preview.candidate ? { candidate: preview.candidate } : {}) };
  if (preview.status !== 'needs_owner_review') return { ...base, ...audit, published: false, reason: 'review_withheld', withheld_reason: preview.reason };
  const model = preview.metrics.generation.model;
  if (!model) return { ...base, ...audit, published: false, reason: 'review_withheld', withheld_reason: 'model_identity_missing' };
  const { body: current = [] } = await query(`media_news_articles?id=eq.${encodeURIComponent(article.id)}&select=id,title,canonical_url,published_at&limit=1`);
  if (!current[0] || buildActorEvidence({ ...current[0], kind: 'news' }, { now }).evidence_sha256 !== buildActorEvidence({ ...article, kind: 'news' }, { now }).evidence_sha256) {
    return { ...base, ...audit, published: false, reason: 'review_withheld', withheld_reason: 'source_changed_before_publish' };
  }
  // Current calibration does not establish a trusted semantic gate. A matching
  // quote or local-model approval is NEVER owner approval. v3 deliberately cannot
  // reach the existing publisher; no job input can override this release gate.
  if (preview.publication_eligible !== true || preview.review?.approved !== true) {
    return { ...base, ...audit, published: false, reason: 'review_withheld', withheld_reason: 'semantic_review_not_validated' };
  }
  const {body:receipt}=await query('rpc/ops_actor_publish_comment',{method:'POST',body:JSON.stringify({p_org_id:orgId,p_actor_key:actorKey,p_article_id:article.id,p_job_id:job.id,p_body:preview.comment,p_model:model})});
  return {...base,...receipt,...audit,model,usage:preview.metrics.generation.usage};
}
