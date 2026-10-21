import { measurementContext } from './measurement.js';

const MAX_DAYS = 31;
const EXPERIENCE_METRIC_VERSION = 'experience-observations/v2';

function pct(n, d) {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : null;
}

function groupBy(rows, keyFn) {
  const out = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    const list = out.get(key) || [];
    list.push(row);
    out.set(key, list);
  }
  return out;
}

export function summarizeExperience(decisions, events, surfaces, policies, experiments) {
  const surfaceMap = new Map(surfaces.map((x) => [String(x.id), x]));
  const policyMap = new Map(policies.map((x) => [String(x.id), x]));
  const experimentMap = new Map(experiments.map((x) => [String(x.id), x]));
  const cohort = new Set(decisions.map((d) => String(d.id)));
  const cohortEvents = events.filter((e) => cohort.has(String(e.decision_id || '')));
  const evByDecision = groupBy(cohortEvents, (e) => String(e.decision_id || ''));
  const exposed = new Set();
  const visible = new Set();
  const interacted = new Set();
  const dismissed = new Set();
  const outcomes = new Set();

  for (const e of cohortEvents) {
    const id = String(e.decision_id || '');
    if (!id) continue;
    if (e.name === 'experience_impression') exposed.add(id);
    if (e.name === 'experience_visible') visible.add(id);
    if (e.name === 'experience_interaction') interacted.add(id);
    if (e.name === 'experience_dismissed') dismissed.add(id);
    if (e.name === 'experience_outcome') outcomes.add(id);
  }

  const bySurface = new Map();
  const byPolicy = new Map();
  const byExperimentArm = new Map();

  function bump(map, key, decision) {
    const v = map.get(key) || { decisions: 0, impressions: 0, visible: 0, interactions: 0, dismissals: 0, outcomes: 0,
      visible_impressions: 0, interacted_visible: 0, outcomes_with_impression: 0 };
    v.decisions++;
    if (exposed.has(decision.id)) v.impressions++;
    if (visible.has(decision.id)) v.visible++;
    if (interacted.has(decision.id)) v.interactions++;
    if (dismissed.has(decision.id)) v.dismissals++;
    if (outcomes.has(decision.id)) v.outcomes++;
    if (visible.has(decision.id) && exposed.has(decision.id)) v.visible_impressions++;
    if (interacted.has(decision.id) && visible.has(decision.id)) v.interacted_visible++;
    if (outcomes.has(decision.id) && exposed.has(decision.id)) v.outcomes_with_impression++;
    map.set(key, v);
  }

  for (const d of decisions) {
    const s = surfaceMap.get(String(d.surface_id));
    const p = policyMap.get(String(d.policy_id));
    bump(bySurface, s?.key || String(d.surface_id), d);
    bump(byPolicy, p ? `${p.key}@${p.version}` : String(d.policy_id), d);
    if (d.experiment_id) {
      const ex = experimentMap.get(String(d.experiment_id));
      bump(byExperimentArm, `${ex?.key || d.experiment_id}:${d.arm_key || 'unknown'}`, d);
    }
  }

  const shape = (map) => [...map.entries()].map(([key, v]) => ({
    key,
    ...v,
    impression_rate_pct: pct(v.impressions, v.decisions),
    visible_rate_pct: pct(v.visible_impressions, v.impressions),
    interaction_rate_pct: pct(v.interacted_visible, v.visible),
    outcome_rate_pct: pct(v.outcomes_with_impression, v.impressions)
  })).sort((a, b) => b.decisions - a.decisions || a.key.localeCompare(b.key));

  const recent = decisions.slice(0, 100).map((d) => {
    const s = surfaceMap.get(String(d.surface_id));
    const p = policyMap.get(String(d.policy_id));
    const ex = d.experiment_id ? experimentMap.get(String(d.experiment_id)) : null;
    const ev = evByDecision.get(String(d.id)) || [];
    return {
      id: d.id,
      created_at: d.created_at,
      surface: s?.key || d.surface_id,
      policy: p ? `${p.key}@${p.version}` : d.policy_id,
      experiment: ex?.key || null,
      arm: d.arm_key || null,
      eligible_count: Array.isArray(d.eligible_candidates) ? d.eligible_candidates.length : 0,
      selected: Array.isArray(d.selected_candidates) ? d.selected_candidates : [],
      propensities: Array.isArray(d.propensities) ? d.propensities : [],
      reason_codes: d.reason_codes || [],
      events: ev.map((x) => ({ name: x.name, at: x.at, path: x.path }))
    };
  });

  return {
    version: EXPERIENCE_METRIC_VERSION,
    methodology: {
      population: 'Decisions created within the requested half-open window; telemetry must reference those decisions and occur within that same window.',
      rates: 'Observed co-occurrence by decision, not an ordered or causal conversion funnel. Rate numerators are intersected with their stated denominator populations.',
      outcome_kind: 'client_reported',
      outcome_window: 'same_as_decision_window',
      outcome_maturity: 'right_censored',
      note: 'Recent decisions have less follow-up. Client outcome events do not verify service delivery, payment or experimental causality.',
      unmatched_event_rows: events.length - cohortEvents.length
    },
    totals: {
      decisions: decisions.length,
      impressions: exposed.size,
      visible: visible.size,
      interactions: interacted.size,
      dismissals: dismissed.size,
      outcomes: outcomes.size,
      impression_rate_pct: pct(exposed.size, decisions.length),
      visible_rate_pct: pct([...visible].filter((id) => exposed.has(id)).length, exposed.size),
      interaction_rate_pct: pct([...interacted].filter((id) => visible.has(id)).length, visible.size),
      outcome_rate_pct: pct([...outcomes].filter((id) => exposed.has(id)).length, exposed.size)
    },
    by_surface: shape(bySurface),
    by_policy: shape(byPolicy),
    by_experiment_arm: shape(byExperimentArm),
    recent
  };
}

export function createExperienceAnalyticsRoutes({ json, sbRows, sbRowsPaged, finiteDate, requireHouseOwner }) {
  return {
    async route(request, env, user, url, path) {
      if (path !== '/v1/analytics/experience') return null;
      await requireHouseOwner(env, user);
      if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);

      const until = finiteDate(url.searchParams.get('until'), new Date());
      let since = finiteDate(url.searchParams.get('since'), new Date(until.getTime() - 7 * 86400000));
      if (!(since < until)) return json({ ok: false, error: 'Invalid analytics range' }, 400);
      const floor = new Date(until.getTime() - MAX_DAYS * 86400000);
      const clamped = since < floor;
      if (since < floor) since = floor;

      const [decisions, events, surfaces, policies, experiments, projects, artifacts] = await Promise.all([
        sbRowsPaged(env,
          'experience_decisions?' +
          `created_at=gte.${encodeURIComponent(since.toISOString())}&created_at=lt.${encodeURIComponent(until.toISOString())}` +
          '&select=id,surface_id,policy_id,experiment_id,arm_key,eligible_candidates,selected_candidates,propensities,reason_codes,created_at' +
          '&order=created_at.desc,id.desc',
          50000
        ),
        sbRowsPaged(env,
          'events_lean?' +
          `site_id=is.null&at=gte.${encodeURIComponent(since.toISOString())}&at=lt.${encodeURIComponent(until.toISOString())}` +
          '&decision_id=not.is.null&name=in.(experience_impression,experience_visible,experience_interaction,experience_dismissed,experience_outcome)' +
          '&select=id,at,name,path,decision_id,experience_surface,experience_policy,experience_experiment,experience_arm&order=at.asc,id.asc',
          100000
        ),
        sbRows(env, 'experience_surfaces?select=id,key,risk_tier,enabled&order=key.asc'),
        sbRows(env, 'experience_policies?select=id,key,version,plane,mode,algorithm,enabled,source_commit_sha&order=created_at.desc'),
        sbRows(env, 'experience_experiments?select=id,key,surface_id,hypothesis,primary_metric,guardrail_metrics,allocation,intent,research_review,consent_mode,publication_eligible,status,started_at,ended_at,created_at&order=created_at.desc'),
        sbRows(env, 'research_projects?select=id,key,title,status,lead_name,lead_orcid,canonical_url,human_subjects_status,protocol_ref,updated_at&order=updated_at.desc'),
        sbRows(env, 'research_artifacts?select=id,key,title,kind,status,canonical_url,doi,concept_doi,git_commit_sha,released_at,created_at&order=created_at.desc&limit=100')
      ]);

      return json({
        ok: true,
        range: { since: since.toISOString(), until: until.toISOString(), max_days: MAX_DAYS },
        measurement: measurementContext({ metricVersion: EXPERIENCE_METRIC_VERSION,
          since: since.toISOString(), until: until.toISOString(), clamped,
          datasets: { decisions, events }, unit: 'decisions', identityBasis: 'decision_id' }),
        ...summarizeExperience(decisions, events, surfaces, policies, experiments),
        registry: { surfaces, policies, experiments, research_projects: projects, artifacts }
      });
    }
  };
}
