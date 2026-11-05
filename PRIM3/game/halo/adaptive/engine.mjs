/** Local reference service. Principals must come from a trusted server adapter in production.
 * No network, persistence, operational feeds, curriculum credit or client-auth claims.
 */
export const DAY = 86_400_000;
const copy = x => structuredClone(x);
const require = (ok, message) => { if (!ok) throw new Error(message); };
const id = x => typeof x === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(x);
const templates = Object.freeze({
  'relay-distance-v1': Object.freeze({ title: 'Relay delivery exercise', skill: 'coordinate-distance',
    brief: 'At a fictional training site, calculate distances to deliver relay supplies. No real incident, facility or person is depicted.',
    hint: 'For points on the same row, subtract their x coordinates and take the absolute value.',
    standard: 'CCSS.Math.Content.6.NS.C.8' })
});
export { templates };

export class MissionLab {
  #missions = new Map(); #sessions = new Map(); #dedupe = new Map(); #clock; #seed;
  constructor({ clock = () => Date.now(), seed = 0 } = {}) {
    require(Number.isSafeInteger(seed) && seed >= 0 && seed < 2 ** 31, 'Bounded integer seed required');
    this.#clock = clock; this.#seed = seed;
  }
  #principal(p, owner = false) {
    require(p && id(p.tenant) && id(p.user), 'Authenticated tenant and user required');
    require(!owner || p.role === 'owner', 'Owner required');
  }
  #mission(p, missionId) {
    this.#principal(p);
    const m = this.#missions.get(missionId);
    require(m && m.tenant === p.tenant, 'Mission not found'); return m;
  }
  #session(p, sessionId) {
    this.#principal(p);
    const s = this.#sessions.get(sessionId);
    require(s && s.tenant === p.tenant && s.user === p.user, 'Session not found'); return s;
  }
  draft(p, { templateId = 'relay-distance-v1', source = null, country, region }) {
    this.#principal(p, true);
    require(Object.hasOwn(templates, templateId), 'Unknown approved template');
    require(/^[A-Z]{2}$/.test(country) && typeof region === 'string' && region.trim().length > 0 && region.length <= 100, 'Country and broad region required');
    let provenance = null;
    if (source) {
      require(source.kind === 'reviewed-public-news' && source.verified === true, 'Only reviewed public news snapshots accepted');
      require(id(source.eventId) && id(source.reviewId), 'Source event and review references required');
      const u = new URL(source.url);
      require(u.protocol === 'https:' && !u.username && !u.password, 'Public HTTPS source required');
      const published = Date.parse(source.publishedAt);
      require(Number.isFinite(published) && published <= this.#clock() && this.#clock() - published <= DAY, 'Source must be dated within 24 hours');
      // No headline, real actor, operational incident or generated narrative crosses this boundary.
      provenance = { kind: source.kind, eventId: source.eventId, reviewId: source.reviewId,
        url: u.href, publishedAt: new Date(published).toISOString() };
    }
    const keys = source
      ? [JSON.stringify([p.tenant, templateId, source.eventId]), JSON.stringify([p.tenant, templateId, provenance.url.split(/[?#]/)[0]])]
      : [JSON.stringify([p.tenant, 'offline-practice', templateId, country, region.trim()])];
    require(keys.every(key => !this.#dedupe.has(key)), 'Duplicate mission');
    const missionId = `mission-${this.#missions.size + 1}`;
    const m = { id: missionId, tenant: p.tenant, templateId, country, region: region.trim(),
      source: provenance, mode: source ? 'news-inspired-fiction' : 'offline-practice', status: 'draft',
      canon: 'non-canon-side-operation', createdAt: this.#clock(), reviewedBy: null, releasedAt: null, expiresAt: null };
    this.#missions.set(missionId, m); for (const key of keys) this.#dedupe.set(key, missionId); return copy(m);
  }
  review(p, missionId, { fictionChecked, geographyChecked, sourceChecked }) {
    this.#principal(p, true); const m = this.#mission(p, missionId);
    require(m.status === 'draft', 'Review requires draft');
    require(fictionChecked === true && geographyChecked === true && (m.source === null || sourceChecked === true), 'Complete moderation and provenance review');
    m.status = 'reviewed'; m.reviewedBy = p.user; return copy(m);
  }
  release(p, missionId) {
    this.#principal(p, true); const m = this.#mission(p, missionId);
    require(m.status === 'reviewed', 'Reviewed mission required');
    require(!m.source || this.#clock() - Date.parse(m.source.publishedAt) <= DAY, 'Source is stale; do not release');
    m.status = 'released'; m.releasedAt = this.#clock(); m.expiresAt = m.releasedAt + DAY;
    return copy(m);
  }
  revoke(p, missionId) {
    this.#principal(p, true); const m = this.#mission(p, missionId);
    m.status = 'revoked'; return copy(m);
  }
  list(p) {
    this.#principal(p);
    return [...this.#missions.values()].filter(m => m.tenant === p.tenant &&
      (p.role === 'owner' || this.#available(m))).map(copy);
  }
  #available(m) { return m.status === 'released' && this.#clock() >= m.releasedAt && this.#clock() < m.expiresAt; }
  start(p, missionId) {
    const m = this.#mission(p, missionId); require(this.#available(m), 'Mission unavailable or expired');
    const s = { id: `session-${this.#sessions.size + 1}`, tenant: p.tenant, user: p.user, missionId,
      phase: 'brief', level: 1, streak: 0, ordinal: 0, current: null, events: [], receipts: new Map(), gameOutcome: null, tacticalHandoff: false };
    this.#sessions.set(s.id, s); return this.view(p, s.id);
  }
  #question(s) {
    s.ordinal += 1;
    const n = s.ordinal, span = 3 + s.level * 2 + (n + this.#seed) % 5;
    const x = s.level === 1 ? n + this.#seed % 3 : -n - span - this.#seed % 3, to = n + span + this.#seed % 5;
    s.current = { id: `${s.id}:q${n}`, level: s.level, x, to, y: s.level === 3 ? -n : n, hinted: false };
  }
  /** Replay an ordered offline event queue. Receipt checks precede expiry so a lost ACK is safe.
   * Clock and answers are checked here, never trusted from the event. No remote LMS write.
   */
  submit(p, sessionId, event) {
    const s = this.#session(p, sessionId);
    require(event && id(event.id) && Number.isSafeInteger(event.seq), 'Event identity and sequence required');
    require(['begin', 'handoff', 'hint', 'answer', 'finish'].includes(event.type), 'Unknown event');
    const normalized = { id: event.id, seq: event.seq, type: event.type,
      questionId: event.questionId ?? null, answer: event.answer ?? null, outcome: event.outcome ?? null };
    const fingerprint = JSON.stringify(normalized), receipt = s.receipts.get(event.id);
    if (receipt) { require(receipt.fingerprint === fingerprint, 'Conflicting replay'); return copy(receipt.result); }
    require(event.seq === s.events.length + 1, 'Out of order event');
    require(this.#available(this.#mission(p, s.missionId)), 'Mission unavailable or expired; retain offline evidence for review');
    let result = { accepted: true, seq: event.seq };
    if (event.type === 'begin') {
      require(s.phase === 'brief', 'Brief already acknowledged'); s.phase = 'play'; this.#question(s);
    } else if (event.type === 'handoff') {
      require(s.phase === 'play' && !s.tacticalHandoff, 'Tactical handoff already recorded or unavailable');
      s.tacticalHandoff = true; result.handoff = 'prim3-transit.html';
    } else if (event.type === 'finish') {
      require(s.phase === 'play' && s.events.some(e => e.type === 'answer'), 'Practice before debrief');
      require(['completed', 'abandoned'].includes(event.outcome), 'Invalid game outcome');
      s.phase = 'debrief'; s.gameOutcome = event.outcome; s.current = null;
    } else {
      require(s.phase === 'play' && event.questionId === s.current?.id, 'Current question required');
      if (event.type === 'hint') {
        s.current.hinted = true; result.hint = templates[this.#mission(p, s.missionId).templateId].hint;
      } else {
        require((typeof event.answer === 'string' && /^-?\d{1,8}$/.test(event.answer.trim())) ||
          (typeof event.answer === 'number' && Number.isSafeInteger(event.answer) && Math.abs(event.answer) < 1e8), 'Integer answer required');
        const expected = Math.abs(s.current.to - s.current.x);
        const correct = Number(event.answer) === expected, independent = correct && !s.current.hinted;
        result = { ...result, correct, independent, level: s.current.level, expected,
          feedback: `|${s.current.to} − (${s.current.x})| = ${expected} grid units.`, assessment: 'local-practice-only' };
        s.streak = independent ? s.streak + 1 : 0;
        if (!correct) s.level = Math.max(1, s.level - 1);
        else if (s.streak >= 2) { s.level = Math.min(3, s.level + 1); s.streak = 0; }
        this.#question(s);
      }
    }
    s.events.push({ ...normalized, result: copy(result), receivedAt: this.#clock() });
    s.receipts.set(event.id, { fingerprint, result: copy(result) }); return copy(result);
  }
  view(p, sessionId) {
    const s = this.#session(p, sessionId), m = this.#mission(p, s.missionId), t = templates[m.templateId];
    const answers = s.events.filter(e => e.type === 'answer');
    return { id: s.id, mission: copy(m), title: t.title, brief: t.brief, standard: t.standard,
      phase: s.phase, tacticalHandoff: s.tacticalHandoff, nextSeq: s.events.length + 1, level: s.level,
      question: s.current ? { id: s.current.id, prompt: `Find the distance from (${s.current.x}, ${s.current.y}) to (${s.current.to}, ${s.current.y}).`, hinted: s.current.hinted } : null,
      debrief: { gameOutcome: s.gameOutcome, attempts: answers.length, correct: answers.filter(e => e.result.correct).length,
        independent: answers.filter(e => e.result.independent).length, principlesCredit: false,
        nextStep: answers.some(e => !e.result.independent) ? 'Review absolute value with a worked example, then try a new problem.' : 'Try a delayed practice check with new coordinates.',
        label: 'Local practice evidence; not LMS mastery or certification.' } };
  }
}
