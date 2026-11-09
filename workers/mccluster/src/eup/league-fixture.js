/* Draft campaign catalogue from the owner's Environmental Justice League review
   kit (handoff `environmental-justice-league/campaign-draft.json`, 2026-11-09,
   schema ejl.campaign-draft/v1). A FIXTURE the owner may create missions from
   through the admin routes: unpublished, unpriced, undated, no points, no
   payment, no commission, no broadcast, no endorsements. Never seeded into
   production by code. */
export const CAMPAIGN_FIXTURE = Object.freeze({
  schema: 'ejl.campaign-draft/v1',
  slug: 'environmental-justice-league',
  title: 'Environmental Justice League',
  purpose: 'First gamified campaign running through Equity Uprise inside the existing environmental globe: understand an issue, join a real mission, do useful work, decide separately whether to show it.',
  audience: 'admin_preview',
  points_policy: null, payment_policy: null, agency_commission_policy: null,
  live_broadcast_enabled: false, candidate_endorsements_enabled: false,
  missions: Object.freeze([
    { slug: 'write-a-song', template: 'write-a-song', title: 'Write a song for a healthier world', proof_modes: ['audio', 'video', 'lyrics'],
      requirements: 'Original audio or video, lyrics, contributor credits and a rights declaration (original or licensed). Recording is separate from broadcasting; submission is separate from public release.',
      acceptance: 'A complete playable submission with required credits, usable file, and human rights/moderation review; no ideological conformity or popularity threshold.' },
    { slug: 'explain-a-source', template: 'explain-a-source', title: 'Explain one environmental source', proof_modes: ['text', 'link'],
      requirements: 'Source URL, observation date, retrieval date, geography and a short written or recorded explanation of what the source measures and what it cannot establish. Remote research only.',
      acceptance: 'Correctly distinguishes observation from interpretation and includes the source\'s limitations.' },
    { slug: 'map-a-community-resource', template: 'map-a-community-resource', title: 'Check a public community resource', proof_modes: ['text', 'link'],
      requirements: 'Official listing, check time, public facility location and a clearly identified correction if needed. No resident locations, no filming service users, no automatic contact.',
      acceptance: 'A reviewer can reproduce the check and distinguish current, stale and unavailable information.' },
    { slug: 'understand-a-policy', template: 'understand-a-policy', title: 'Explain a bill and its current stage', proof_modes: ['text', 'link'],
      requirements: 'Official bill ID, jurisdiction, session, exact text version, current action record and explanation of its procedural status. No lobbying, filing, endorsement or election reward.',
      acceptance: 'Separates proposed language from enacted law, attributes interpretations, and includes a reproducible source trail.' },
    { slug: 'community-action-session', template: 'community-action-session', title: 'Document an approved community action', proof_modes: ['text', 'link', 'video'],
      requirements: 'Organizer verification and private documentation after location, permissions, supervision, hazard plan and stop conditions are approved. No trespass, hazardous-material handling or emergency response.',
      acceptance: 'Reviewer confirms the agreed activity and scope, not an unmeasured environmental outcome.' }
  ])
});
