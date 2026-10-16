/* LIVE MISSIONS: the continuity rules, the coverage rule, the city cell.

   The database is the authority (supabase/pending/live_missions_v1.sql:
   action_live_eval, action_live_window_covered). This file mirrors the same
   rules so the Worker can tell a streamer, live, where they stand, and so
   the rules have fast unit tests. Change both together.

   "Remain live the whole time" (owner, 2026-10-15), as data per mission
   (action_mission_live_policies; defaults below):
     1. any gap longer than the resume window                      -> broken
     2. long gaps (> max_single_gap) are "resumes"; more than max_resumes -> broken
     3. short gaps: total > max_total_gap, or more gaps than max_reconnects -> broken
     4. otherwise 'resumed' if there was a long gap, else 'continuous'
     while running: no open segment and silence beyond the resume window -> broken
   Completion also needs duration >= min_duration. */

export const DEFAULT_LIVE_POLICY = Object.freeze({
  live_mode: 'required',
  min_duration_seconds: 300,
  max_duration_minutes: 240,
  max_single_gap_seconds: 60,
  max_total_gap_seconds: 180,
  max_reconnects: 5,
  max_resumes: 1,
  resume_window_minutes: 10,
  pin_delay_seconds: 120,
  third_party_rule: 'consent_on_camera_or_keep_off'
});

const ms = (t) => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t));

/* segments: [{ connected_at, disconnected_at|null }] in any order */
export function evaluateContinuity(segments, policy = {}, { now = Date.now(), finished = false } = {}) {
  const p = { ...DEFAULT_LIVE_POLICY, ...policy };
  const segs = (segments || [])
    .map((s) => ({ c: ms(s.connected_at), d: s.disconnected_at == null ? null : ms(s.disconnected_at) }))
    .filter((s) => Number.isFinite(s.c))
    .sort((a, b) => a.c - b.c);
  const nowMs = ms(now);
  if (!segs.length) {
    return { state: 'not_started', reason: null, duration_seconds: 0, connected_seconds: 0, gaps: 0, resumes: 0, short_gap_seconds: 0, longest_gap_seconds: 0, open: false };
  }
  let prev = null, connected = 0, shortTotal = 0, long = 0, gaps = 0, maxGap = 0, open = false;
  for (const s of segs) {
    const end = s.d == null ? nowMs : s.d;
    if (prev != null) {
      const gap = Math.max(0, (s.c - prev) / 1000);
      gaps += 1;
      maxGap = Math.max(maxGap, gap);
      if (gap > p.max_single_gap_seconds) long += 1; else shortTotal += gap;
    }
    open = s.d == null;
    prev = prev == null ? end : Math.max(prev, end);
    connected += Math.max(0, (end - s.c) / 1000);
  }
  const first = segs[0].c;
  let state = 'continuous', reason = null;
  if (maxGap > p.resume_window_minutes * 60) { state = 'broken'; reason = 'gap_longer_than_resume_window'; }
  else if (long > p.max_resumes) { state = 'broken'; reason = 'too_many_resumes'; }
  else if (shortTotal > p.max_total_gap_seconds) { state = 'broken'; reason = 'total_gap_over_tolerance'; }
  else if (gaps > p.max_reconnects) { state = 'broken'; reason = 'too_many_reconnects'; }
  else if (!finished && !open && (nowMs - prev) / 1000 > p.resume_window_minutes * 60) { state = 'broken'; reason = 'not_resumed_in_time'; }
  else if (long > 0) state = 'resumed';
  const duration = Math.round((prev - first) / 1000);
  return {
    state, reason, open,
    duration_seconds: duration,
    connected_seconds: Math.round(connected),
    gaps, resumes: long,
    short_gap_seconds: Math.round(shortTotal),
    longest_gap_seconds: Math.round(maxGap),
    min_duration_seconds: p.min_duration_seconds,
    can_complete: (state === 'continuous' || state === 'resumed') && duration >= p.min_duration_seconds,
    seconds_until_broken: !open && state !== 'broken' && !finished ? Math.max(0, Math.round(p.resume_window_minutes * 60 - (nowMs - prev) / 1000)) : null
  };
}

/* Strict coverage of an event window (live coverage bounties). Resumes do
   not count: every gap inside the window must be within the bounty's own
   tolerance, the run must start by start+grace and last to end-grace. */
export function windowCovered(segments, { from, to, start_grace_seconds = 120, end_grace_seconds = 0, max_single_gap_seconds = 30, max_total_gap_seconds = 60 }) {
  const f = ms(from), t = ms(to);
  const segs = (segments || [])
    .filter((s) => s.disconnected_at != null)
    .map((s) => ({ c: Math.max(ms(s.connected_at), f), d: Math.min(ms(s.disconnected_at), t) }))
    .filter((s) => s.d > f && s.c < t)
    .sort((a, b) => a.c - b.c);
  if (!segs.length) return false;
  let prev = null, total = 0;
  for (const s of segs) {
    if (prev != null && s.c > prev) {
      const gap = (s.c - prev) / 1000;
      if (gap > max_single_gap_seconds) return false;
      total += gap;
    }
    prev = prev == null ? s.d : Math.max(prev, s.d);
  }
  if (segs[0].c > f + start_grace_seconds * 1000) return false;
  if (prev < t - end_grace_seconds * 1000) return false;
  return total <= max_total_gap_seconds;
}

/* The city cell (owner, 2026-10-15: city-level pins). From the request's
   Cloudflare geolocation (IP-derived, approximate, already disclosed in the
   privacy notice), snapped to a 0.1-degree cell centre. Browser GPS is never
   asked for and never accepted here. No city and no point = no pin. */
export function cityCell(cf) {
  const c = cf && typeof cf === 'object' ? cf : {};
  const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' ? NaN : Number(v)); // never 0 from nothing
  const lat = num(c.latitude), lng = num(c.longitude);
  const snap = (v) => Math.round(v * 10) / 10;
  const okPoint = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const country = typeof c.country === 'string' && /^[A-Z]{2}$/.test(c.country) ? c.country : null;
  const city = typeof c.city === 'string' ? c.city.trim().slice(0, 120) : '';
  return {
    city: city || null,
    region: typeof c.region === 'string' ? c.region.trim().slice(0, 120) || null : null,
    country,
    lat: okPoint && city ? snap(lat) : null,
    lng: okPoint && city ? snap(lng) : null
  };
}
