import { rest } from '../supabase.mjs';

export async function leadRescore(job) {
  const orgId = String(job?.org_id || '').trim();
  if (!orgId) throw new Error('lead_rescore requires org_id');

  const { body: recomputed } = await rest('rpc/ops_recompute_lead_scores', {
    method: 'POST',
    body: JSON.stringify({ p_org_id: orgId }),
  });

  const targetId = String(job?.target_id || '').trim();
  let targetScore = null;
  if (job?.target_type === 'company' && /^[0-9a-f-]{36}$/i.test(targetId)) {
    const params = new URLSearchParams({
      org_id: `eq.${orgId}`,
      company_id: `eq.${targetId}`,
      select: 'company_id,score,engagement_score,urgency_score,fit_score,momentum_score,rationale,model_version,computed_at',
      limit: '1',
    });
    const { body: rows = [] } = await rest(`ops_lead_scores?${params.toString()}`);
    targetScore = rows[0] || null;
  }

  return {
    executor: 'lead_rescore:v1',
    summary: targetScore
      ? `Lead score refreshed for company ${targetId}: ${targetScore.score}`
      : `Lead scores refreshed for organization ${orgId}`,
    recomputed_count: Number(recomputed || 0),
    target_score: targetScore,
  };
}
