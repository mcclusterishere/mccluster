/* Audience Science v1
 *
 * Measurement before inference. This module converts first-party behavioral
 * events into transparent, reproducible features. It does NOT infer protected
 * traits, ideology, mental health, or personality. A play is an implicit signal
 * and can mean preference, curiosity, exposure, autoplay, novelty, or outrage.
 *
 * The music-distribution features are standard concentration/diversity
 * measures:
 *   p_i = starts for track i / all starts
 *   HHI = sum(p_i^2)
 *   Shannon entropy H = -sum(p_i * ln p_i)
 *   effective catalog size = exp(H)
 *   normalized entropy = H / ln(number of observed tracks)
 *
 * These are observations about attention, not diagnoses of motive.
 */

export const AUDIENCE_SCIENCE_VERSION = 'audience-science/v1';
export const MAX_AUDIENCE_WINDOW_DAYS = 31;

export const START_EVENT_NAMES = new Set([
  'album_play', 'song_start', 'track_start', 'music_play'
]);
export const COMPLETE_EVENT_NAMES = new Set([
  'music_complete', 'music_preview_complete'
]);
export const FULL_EVENT_NAMES = new Set(['music_full_play']);
export const SHARE_EVENT_NAMES = new Set([
  'track_share', 'share', 'share_click', 'native_share'
]);
export const ACTION_EVENT_NAMES = new Set([
  'mission_join', 'action_act', 'action_claim', 'action_complete',
  'form_submit', 'site_request'
]);
export const CONVERSION_EVENT_NAMES = new Set([
  'account_created', 'checkout_view', 'checkout_go', 'offer_buy_click'
]);

export const AUDIENCE_EVENT_NAMES = [
  'page_view', 'page_leave', 'acquired',
  ...START_EVENT_NAMES,
  'music_full_play', 'music_preview_play',
  ...COMPLETE_EVENT_NAMES,
  ...SHARE_EVENT_NAMES,
  ...ACTION_EVENT_NAMES,
  ...CONVERSION_EVENT_NAMES
];

const round = (v, places = 3) => {
  const p = 10 ** places;
  return Math.round((Number(v) || 0) * p) / p;
};

function isoDay(value) {
  const n = Date.parse(String(value || ''));
  return Number.isFinite(n) ? new Date(n).toISOString().slice(0, 10) : null;
}

function cleanTrack(value) {
  const s = String(value || '').trim();
  return s || null;
}

function sourceOf(row) {
  const src = String(row?.src || row?.source || '').trim();
  if (src) return src;
  const ref = String(row?.referrer || '').trim();
  if (!ref) return 'direct';
  try { return new URL(ref).hostname || 'direct'; }
  catch { return ref.slice(0, 120); }
}

function distributionMetrics(trackCounts) {
  const entries = [...trackCounts.entries()].filter(([, n]) => n > 0);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (!total) {
    return {
      distinct_tracks: 0,
      dominant_track: null,
      dominant_track_starts: 0,
      dominant_share: 0,
      hhi: 0,
      shannon_entropy: 0,
      normalized_entropy: null,
      effective_catalog_size: 0,
      repeat_ratio: 0,
      track_distribution: []
    };
  }

  const sorted = entries
    .map(([track, starts]) => ({ track, starts, share: starts / total }))
    .sort((a, b) => b.starts - a.starts || a.track.localeCompare(b.track));

  let hhi = 0;
  let entropy = 0;
  for (const x of sorted) {
    hhi += x.share ** 2;
    if (x.share > 0) entropy -= x.share * Math.log(x.share);
  }
  const k = sorted.length;
  const normalized = k > 1 ? entropy / Math.log(k) : 0;

  return {
    distinct_tracks: k,
    dominant_track: sorted[0]?.track || null,
    dominant_track_starts: sorted[0]?.starts || 0,
    dominant_share: round(sorted[0]?.share || 0),
    hhi: round(hhi),
    shannon_entropy: round(entropy),
    normalized_entropy: round(normalized),
    effective_catalog_size: round(Math.exp(entropy), 2),
    repeat_ratio: round(Math.max(0, (total - k) / total)),
    track_distribution: sorted.slice(0, 12).map((x) => ({
      track: x.track,
      starts: x.starts,
      share: round(x.share)
    }))
  };
}

function behaviorSignals(profile) {
  const out = [];
  const enough = profile.music_starts >= 5;
  if (enough && profile.dominant_share >= 0.8) out.push('concentrated_attention');
  if (profile.distinct_tracks >= 4 && profile.normalized_entropy >= 0.65) out.push('broad_exploration');
  if (profile.music_starts >= 4 && profile.repeat_ratio >= 0.5) out.push('repeat_listening');
  if (profile.music_starts >= 2 && profile.completion_rate >= 0.5) out.push('deep_listening');
  if (profile.sessions >= 2 || profile.active_days >= 2) out.push('returning');
  if (profile.action_events > 0) out.push('action_engaged');
  if (profile.conversion_events > 0) out.push('converted');
  return out;
}

function modelReadiness(profiles) {
  const listeners = profiles.filter((p) => p.music_starts > 0);
  const longitudinal = listeners.filter((p) => p.active_days >= 2 && p.sessions >= 2);
  const distribution = listeners.filter((p) => p.music_starts >= 5);
  return {
    stage: 'measurement',
    latent_class_enabled: false,
    state_transition_enabled: false,
    listeners: listeners.length,
    distribution_eligible: distribution.length,
    longitudinal_eligible: longitudinal.length,
    reason: 'LCA/HMM fitting stays disabled until model selection, stability, holdout validation and minimum-support criteria are implemented. V1 reports observed features only.'
  };
}

export function summarizeAudienceScience(leanRows = [], identityRows = []) {
  const identityByDevice = new Map();
  [...identityRows]
    .filter((r) => r?.device_id && r?.uid)
    .sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0))
    .forEach((r) => identityByDevice.set(String(r.device_id), String(r.uid)));

  const buckets = new Map();
  const deviceToBucket = new Map();

  function getBucket(row) {
    const device = String(row?.device_id || '').trim();
    if (!device) return null;
    const uid = identityByDevice.get(device) || null;
    const key = uid ? 'u:' + uid : 'd:' + device;
    let b = buckets.get(key);
    if (!b) {
      b = {
        visitor_key: key,
        uid,
        devices: new Set(),
        sessions: new Set(),
        days: new Set(),
        sources: new Map(),
        trackCounts: new Map(),
        events: 0,
        page_views: 0,
        music_starts: 0,
        full_plays: 0,
        completions: 0,
        shares: 0,
        action_events: 0,
        conversion_events: 0,
        engaged_seconds: 0,
        first_seen: null,
        last_seen: null
      };
      buckets.set(key, b);
    }
    b.devices.add(device);
    deviceToBucket.set(device, key);
    return b;
  }

  for (const row of leanRows) {
    if (!row || row.is_bot) continue;
    const b = getBucket(row);
    if (!b) continue;
    b.events++;
    if (row.session_id) b.sessions.add(String(row.session_id));
    const day = isoDay(row.at);
    if (day) b.days.add(day);
    const at = Date.parse(String(row.at || ''));
    if (Number.isFinite(at)) {
      if (!b.first_seen || at < Date.parse(b.first_seen)) b.first_seen = new Date(at).toISOString();
      if (!b.last_seen || at > Date.parse(b.last_seen)) b.last_seen = new Date(at).toISOString();
    }

    const name = String(row.name || '');
    if (name === 'page_view') b.page_views++;
    if (name === 'page_leave') b.engaged_seconds += Math.max(0, Number(row.visible_s || row.dwell_s || 0));
    if (name === 'acquired') {
      const src = sourceOf(row);
      b.sources.set(src, (b.sources.get(src) || 0) + 1);
    }
    if (START_EVENT_NAMES.has(name)) {
      const track = cleanTrack(row.track);
      if (track) {
        b.music_starts++;
        b.trackCounts.set(track, (b.trackCounts.get(track) || 0) + 1);
      }
    }
    if (FULL_EVENT_NAMES.has(name)) b.full_plays++;
    if (COMPLETE_EVENT_NAMES.has(name)) b.completions++;
    if (SHARE_EVENT_NAMES.has(name)) b.shares++;
    if (ACTION_EVENT_NAMES.has(name)) b.action_events++;
    if (CONVERSION_EVENT_NAMES.has(name)) b.conversion_events++;
  }

  const profiles = [...buckets.values()].map((b) => {
    const dist = distributionMetrics(b.trackCounts);
    const starts = b.music_starts;
    const source = [...b.sources.entries()].sort((a, c) => c[1] - a[1] || a[0].localeCompare(c[0]))[0]?.[0] || 'direct';
    const first = b.first_seen ? Date.parse(b.first_seen) : NaN;
    const last = b.last_seen ? Date.parse(b.last_seen) : NaN;
    const profile = {
      visitor_key: b.visitor_key,
      uid: b.uid,
      device_count: b.devices.size,
      sessions: b.sessions.size,
      active_days: b.days.size,
      first_seen: b.first_seen,
      last_seen: b.last_seen,
      span_days: Number.isFinite(first) && Number.isFinite(last) ? round(Math.max(0, (last - first) / 86400000), 1) : 0,
      first_party_events: b.events,
      page_views: b.page_views,
      engaged_seconds: Math.round(b.engaged_seconds),
      source,
      music_starts: starts,
      full_plays: b.full_plays,
      completions: b.completions,
      completion_rate: starts ? round(Math.min(1, b.completions / starts)) : 0,
      shares: b.shares,
      action_events: b.action_events,
      conversion_events: b.conversion_events,
      ...dist
    };
    profile.behavior_signals = behaviorSignals(profile);
    profile.evidence = {
      distribution_observations: starts,
      enough_for_distribution_signal: starts >= 5,
      sessions: profile.sessions,
      active_days: profile.active_days
    };
    return profile;
  }).sort((a, b) => b.music_starts - a.music_starts || b.sessions - a.sessions || String(a.visitor_key).localeCompare(String(b.visitor_key)));

  const signalCounts = new Map();
  const tracks = new Map();
  for (const p of profiles) {
    for (const signal of p.behavior_signals) signalCounts.set(signal, (signalCounts.get(signal) || 0) + 1);
    for (const item of p.track_distribution) {
      let t = tracks.get(item.track);
      if (!t) t = { track: item.track, listeners: 0, starts: 0, concentrated_listeners: 0, total_listener_share: 0 };
      t.listeners++;
      t.starts += item.starts;
      t.total_listener_share += item.share;
      if (item.share >= 0.8 && p.music_starts >= 5) t.concentrated_listeners++;
      tracks.set(item.track, t);
    }
  }

  const trackAffinity = [...tracks.values()].map((t) => ({
    track: t.track,
    listeners: t.listeners,
    starts: t.starts,
    concentrated_listeners: t.concentrated_listeners,
    avg_listener_share: round(t.total_listener_share / Math.max(1, t.listeners))
  })).sort((a, b) => b.listeners - a.listeners || b.starts - a.starts || a.track.localeCompare(b.track));

  const listeners = profiles.filter((p) => p.music_starts > 0);
  return {
    version: AUDIENCE_SCIENCE_VERSION,
    methodology: {
      inference_policy: 'behavior_only',
      note: 'These metrics describe observed first-party behavior. They do not infer ideology, race, religion, health, personality or motive.',
      formulas: {
        dominant_share: 'max(track_starts) / total_music_starts',
        hhi: 'sum(p_i^2)',
        shannon_entropy: '-sum(p_i * ln(p_i))',
        normalized_entropy: 'H / ln(k), for k observed tracks',
        effective_catalog_size: 'exp(H)',
        repeat_ratio: '(music_starts - distinct_tracks) / music_starts'
      },
      exposure_warning: 'Observed attention is not the same as preference. The current event schema does not fully record every track a visitor was shown, so exposure-adjusted preference is not claimed.'
    },
    totals: {
      profiled_visitors: profiles.length,
      music_listeners: listeners.length,
      identified_listeners: listeners.filter((p) => p.uid).length,
      distribution_eligible: listeners.filter((p) => p.music_starts >= 5).length,
      returning_listeners: listeners.filter((p) => p.sessions >= 2 || p.active_days >= 2).length,
      action_engaged_listeners: listeners.filter((p) => p.action_events > 0).length
    },
    signals: [...signalCounts.entries()].map(([signal, visitors]) => ({ signal, visitors }))
      .sort((a, b) => b.visitors - a.visitors || a.signal.localeCompare(b.signal)),
    track_affinity: trackAffinity,
    profiles,
    model_readiness: modelReadiness(profiles)
  };
}

export function createAudienceScienceRoutes({ json, sbRowsPaged, finiteDate, requireHouseOwner }) {
  return {
    async route(request, env, user, url, path) {
      if (path !== '/v1/analytics/audience-science') return null;
      await requireHouseOwner(env, user);
      if (request.method !== 'GET') return json({ ok: false, error: 'GET only' }, 405);

      const until = finiteDate(url.searchParams.get('until'), new Date());
      const fallbackSince = new Date(until.getTime() - 7 * 86400000);
      let since = finiteDate(url.searchParams.get('since'), fallbackSince);
      if (!(since < until)) return json({ ok: false, error: 'Invalid analytics range' }, 400);
      const floor = new Date(until.getTime() - MAX_AUDIENCE_WINDOW_DAYS * 86400000);
      if (since < floor) since = floor;

      const names = AUDIENCE_EVENT_NAMES.join(',');
      const qs = 'site_id=is.null&is_bot=is.false' +
        '&at=gte.' + encodeURIComponent(since.toISOString()) +
        '&at=lt.' + encodeURIComponent(until.toISOString()) +
        '&name=in.(' + names + ')' +
        '&device_id=not.is.null' +
        '&select=at,name,path,device_id,session_id,track,src,source,referrer,is_bot,listened_seconds,dwell_s,visible_s' +
        '&order=at.asc';
      const identQs = 'site_id=is.null&uid=not.is.null&device_id=not.is.null' +
        '&at=gte.' + encodeURIComponent(since.toISOString()) +
        '&at=lt.' + encodeURIComponent(until.toISOString()) +
        '&select=at,uid,device_id,session_id&order=at.asc';

      const [lean, identity] = await Promise.all([
        sbRowsPaged(env, 'events_lean?' + qs, 100000),
        sbRowsPaged(env, 'events?' + identQs, 50000)
      ]);
      return json({
        ok: true,
        range: { since: since.toISOString(), until: until.toISOString(), max_days: MAX_AUDIENCE_WINDOW_DAYS },
        ...summarizeAudienceScience(lean, identity)
      });
    }
  };
}
