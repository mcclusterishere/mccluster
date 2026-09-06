function headers(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json'
  };
}

async function db(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { headers: headers(env) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error('Media model lookup failed'), { status: res.status, detail: data });
  return data;
}

const tierScore = { premium: 40, high: 32, standard: 22, utility: 12 };

export async function recommendModels(request, env) {
  let body;
  try { body = await request.json(); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
  if (!body.capability) throw Object.assign(new Error('capability is required'), { status: 400 });

  const rows = await db(env, `media_models?enabled=eq.true&capability=eq.${encodeURIComponent(body.capability)}&select=*`);
  const required = body.required || {};
  const topK = Math.min(10, Math.max(1, Number(body.top_k || 3)));

  const ranked = (rows || []).filter((m) => {
    if (required.reference_images && !m.supports_reference_images) return false;
    if (required.first_last_frame && !m.supports_first_last_frame) return false;
    if (required.native_audio && !m.supports_native_audio) return false;
    if (required.commercial_use && m.commercial_use !== true) return false;
    return true;
  }).map((m) => {
    const tier = m.quality_profile?.tier || 'standard';
    let score = tierScore[tier] || 20;
    if (m.health_state === 'healthy') score += 8;
    if (m.health_state === 'degraded') score -= 15;
    if (required.reference_images && m.supports_reference_images) score += 6;
    if (required.first_last_frame && m.supports_first_last_frame) score += 8;
    if (required.native_audio && m.supports_native_audio) score += 6;
    if (body.preference === 'quality' && tier === 'premium') score += 12;
    if (body.preference === 'balanced' && tier === 'high') score += 8;
    return {
      model: m,
      score,
      rationale: {
        tier,
        strength: m.quality_profile?.strength || null,
        matched_requirements: Object.keys(required).filter((key) => Boolean(required[key]))
      }
    };
  }).sort((a, b) => b.score - a.score).slice(0, topK);

  return { capability: body.capability, preference: body.preference || 'balanced', candidates: ranked };
}
