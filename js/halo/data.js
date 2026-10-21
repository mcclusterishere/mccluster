/* HALO DATA: what the Halo view reads, all of it from the canonical Worker `mccluster` with the owner's own session, never a
   provider and never a second backend (docs/control-plane/HALO-ADMIN-GLOBE.md).

     missions   GET /v1/world/halo/missions     every mission, its status, place (a region, never a person), team and evidence
     people     GET /v1/world/halo/people       members on missions and the house team; no one's location (none was shared)
     evidence   GET /v1/intel/evidence          intelligence evidence and its review state
     health     GET /v1/intel/health            the intelligence connector: last run, failures, staleness
     briefs     GET /v1/news-briefs?day=        the daily country briefs
     profile    GET /v1/mnet/bootstrap          the signed-in owner's display name and picture, for the top bar
     tide       GET /v1/world/tides/:station    a NOAA station's observed water level, past 24 h

   Each answer is kept for its own short window and refetched while the view is open; a failed fetch keeps the last good answer
   and says so (`error`), so a panel can tell "nothing yet" from "could not ask". Nothing is written anywhere. */
(function () {
  'use strict';

  const SOURCES = {
    missions: { path: '/v1/world/halo/missions', ttl: 60e3 },
    people: { path: '/v1/world/halo/people', ttl: 60e3 },
    evidence: { path: '/v1/intel/evidence?review_status=all&limit=100', ttl: 120e3 },
    health: { path: '/v1/intel/health', ttl: 300e3 },
    profile: { path: '/v1/mnet/bootstrap?app_key=mccluster-web', ttl: 600e3 }
  };

  function create(G) {
    const slots = {};
    const listeners = new Set();
    let alive = true;

    function emit(key) { listeners.forEach((fn) => { try { fn(key); } catch (e) { /* a panel's paint never stops the others */ } }); }

    async function ask(path) {
      const t = G.token();
      const r = await fetch(G.api + path, { headers: t ? { accept: 'application/json', authorization: 'Bearer ' + t } : { accept: 'application/json' }, cache: 'no-store' });
      if (r.status === 401 || r.status === 403) { const e = new Error('owner only'); e.status = r.status; throw e; }
      if (!r.ok) { const e = new Error('answered ' + r.status); e.status = r.status; throw e; }
      return r.json();
    }

    /* one slot per source: { body, at, error, busy } */
    function slot(key) { return slots[key] || (slots[key] = { body: null, at: 0, error: '', busy: null }); }
    function load(key, path, ttl, force) {
      const s = slot(key);
      if (s.busy) return s.busy;
      if (!force && s.body && Date.now() - s.at < ttl) return Promise.resolve(s.body);
      s.busy = ask(path).then((body) => {
        if (!alive) return null;
        s.body = body; s.at = Date.now(); s.error = '';
        return body;
      }, (e) => {
        if (!alive) return null;
        s.error = e && e.status === 404 ? 'not deployed' : e && (e.status === 401 || e.status === 403) ? 'owner only' : 'could not reach the Worker';
        return s.body;
      }).finally(() => { s.busy = null; if (alive) emit(key); });
      return s.busy;
    }

    const get = (key) => { const src = SOURCES[key]; return load(key, src.path, src.ttl, false); };
    const refresh = (key) => { const src = SOURCES[key]; return load(key, src.path, src.ttl, true); };
    const peek = (key) => { const s = slots[key]; return s ? { body: s.body, at: s.at, error: s.error, loading: !!s.busy } : { body: null, at: 0, error: '', loading: false }; };

    function utcDay(offset) { const d = new Date(Date.now() - offset * 864e5); return d.toISOString().slice(0, 10); }
    /* today's briefs if they exist, else yesterday's (they are written through the day) */
    async function briefs() {
      const today = await load('briefs:' + utcDay(0), '/v1/news-briefs?day=' + utcDay(0), 600e3, false);
      if (today && Array.isArray(today.briefs) && today.briefs.length) { slots.briefs = slots['briefs:' + utcDay(0)]; return today; }
      const before = await load('briefs:' + utcDay(1), '/v1/news-briefs?day=' + utcDay(1), 600e3, false);
      slots.briefs = slots['briefs:' + utcDay(1)];
      return before;
    }
    function tide(station) {
      const id = String(station || '');
      if (!/^\d{7}$/.test(id)) return Promise.resolve(null);
      return load('tide:' + id, '/v1/world/tides/' + id, 360e3, false);
    }

    let timer = setInterval(() => { if (!document.hidden) ['missions', 'people'].forEach((k) => { if (slots[k]) get(k); }); }, 30e3);

    return {
      get, refresh, peek, briefs, tide,
      peekBriefs: () => peek('briefs'),
      peekTide: (id) => peek('tide:' + id),
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      destroy() { alive = false; clearInterval(timer); timer = null; listeners.clear(); }
    };
  }

  window.HaloData = Object.freeze({ create, SOURCES: Object.freeze(Object.keys(SOURCES)) });
})();
