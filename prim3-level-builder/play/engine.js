(function (root, factory) {
  'use strict';
  const Game = factory();
  if (typeof module === 'object' && module.exports) module.exports = Game;
  else root.P3Game = Game;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /* Standalone mission rules, independent of rendering and the canonical Prim3 resolver.
     P3Game(level, seed): all public actions return {ok, reason, message, events}.
     Movement settles immediately. Animate ordered event segments, then draw snapshot().
     Grid layer changes are possible only through level.neighbors' weighted links.
     Overwatch reserves ONE future shot for 1 AP; the reaction never spends a second AP.
     Combat percentages are fictional game rules, not a physical targeting model. */
  const node = p => ({ x: p.x, y: p.y, layer: p.layer == null ? 0 : p.layer });
  const key = p => `${p.x},${p.y},${p.layer == null ? 0 : p.layer}`;
  const same = (a, b) => key(a) === key(b);
  const copy = value => JSON.parse(JSON.stringify(value));
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const unitSort = (a, b) => a.id.localeCompare(b.id);

  class Heap {
    constructor() { this.items = []; this.serial = 0; }
    push(value, priority) {
      const item = { value, priority, order: this.serial++ }, a = this.items;
      a.push(item); let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!this.less(item, a[p])) break;
        a[i] = a[p]; i = p;
      }
      a[i] = item;
    }
    less(a, b) { return a.priority < b.priority || (a.priority === b.priority && a.order < b.order); }
    pop() {
      const a = this.items, first = a[0], last = a.pop();
      if (a.length) {
        let i = 0;
        while (true) {
          let c = i * 2 + 1;
          if (c >= a.length) break;
          if (c + 1 < a.length && this.less(a[c + 1], a[c])) c++;
          if (!this.less(a[c], last)) break;
          a[i] = a[c]; i = c;
        }
        a[i] = last;
      }
      return first && first.value;
    }
    get length() { return this.items.length; }
  }

  class P3Game {
    constructor(level, seed = 123) {
      for (const method of ['canStand', 'neighbors', 'heightAt', 'coverAt', 'blocksSight']) {
        if (!level || typeof level[method] !== 'function') throw new TypeError(`Level needs ${method}().`);
      }
      this.level = level;
      this.seed = Number(seed) >>> 0;
      this._rng = this.seed || 0x6d2b79f5;
      this.turn = 1; this.phase = 'player'; this.status = 'active';
      this.selectedId = 'E'; this.gateOpen = false; this.hackProgress = 0;
      this.medkitUsed = false; this.grade = null; this.logs = [];
      this.units = [
        this._unit('E', 'Arjun', 'player', 'E', -20, -36, 0, 12, 12, 16, 78, 4),
        this._unit('R', 'Rafael', 'player', 'R', -16, -40, 0, 10, 14, 21, 82, 3),
        this._unit('T', 'Aya', 'player', 'T', -24, -40, 0, 10, 10, 14, 74, 3),
        this._unit('H1', 'Patrol 1', 'enemy', 'guard', -9, -2, 0, 7, 14, 15, 64, 3),
        this._unit('H2', 'Patrol 2', 'enemy', 'guard', 9, 4, 0, 7, 14, 15, 64, 3),
        this._unit('H3', 'Patrol 3', 'enemy', 'guard', 22, 0, 0, 8, 14, 16, 66, 3),
        this._unit('H4', 'Roof sentry', 'enemy', 'sentry', -24, 4, 1, 7, 14, 23, 68, 3),
        this._unit('H5', 'Roof sentry', 'enemy', 'sentry', 20, 14, 1, 7, 14, 23, 68, 3),
        this._unit('H6', 'Relay guard', 'enemy', 'guard', 4, 20, 0, 9, 14, 17, 66, 3)
      ];
      if (Array.isArray(level.spawnDefinitions)) {
        const templates = {E:[12,12,16,78,4],R:[10,14,21,82,3],T:[10,10,14,74,3],guard:[7,14,15,64,3],sentry:[7,14,23,68,3]};
        this.units = level.spawnDefinitions.map(s => {
          const stats=templates[s.role];if(!stats)throw new Error('Unsupported spawn role.');
          return this._unit(s.id,s.team==='player'?({E:'Entry',R:'Recon',T:'Technical'}[s.role]):'Hostile '+s.id,s.team,s.role,s.x,s.y,s.layer||0,...stats);
        });
        if(!['E','R','T'].every(id=>this.units.some(u=>u.id===id&&u.team==='player')))throw new Error('Custom levels need Entry, Recon and Technical spawns.');
      }
      const occupied = new Set();
      for (const u of this.units) {
        if (!this._validNode(u) || !level.canStand(node(u), false) || occupied.has(key(u))) {
          throw new Error(`Invalid or occupied mission spawn for ${u.id}: ${key(u)}.`);
        }
        occupied.add(key(u));
      }
      this._log('Cross the canal. Aya must complete two relay hacks, then extract the surviving squad.');
    }

    _unit(id, name, team, role, x, y, layer, hp, range, attackRange, aim, damage) {
      return { id, name, team, faction: team === 'player' ? 'PLAYER' : 'THREAT', role,
        x, y, layer, hp, maxHp: hp, ap: 2, maxAp: 2, range, moveRange: range,
        attackRange, aim, damage, dead: false, extracted: false, overwatch: false,
        hunkered: false, markedUntil: 0, alerted: false };
    }

    _random() { this._rng = (Math.imul(this._rng, 1664525) + 1013904223) >>> 0; return this._rng / 4294967296; }
    _log(message) { this.logs.push(message); if (this.logs.length > 80) this.logs.shift(); }
    _get(id) { return this.units.find(u => u.id === id); }
    _alive(u) { return !!u && !u.dead && !u.extracted && u.hp > 0; }
    _players() { return this.units.filter(u => u.team === 'player' && this._alive(u)); }
    _fail(reason) { return { ok: false, reason, message: reason, events: [] }; }
    _success(message, events = []) { if (message) this._log(message); return { ok: true, reason: null, message, events }; }
    _guard(id, ap = 1) {
      const u = this._get(id);
      if (this.status !== 'active') return 'The mission has ended. Restart to play again.';
      if (!this._alive(u)) return 'That operative is unavailable.';
      if (u.team !== this.phase) return 'That unit cannot act in this phase.';
      if (u.ap < ap) return `This action needs ${ap} AP.`;
      return null;
    }
    _validNode(p) {
      if (!p || !Number.isInteger(p.x) || !Number.isInteger(p.y)) return false;
      const layer = p.layer == null ? 0 : p.layer;
      if (!Number.isInteger(layer) || layer < 0 || layer > 1) return false;
      const b = this.level.bounds || { min: -64, max: 63 };
      return p.x >= (b.minX == null ? b.min : b.minX) && p.x <= (b.maxX == null ? b.max : b.maxX)
        && p.y >= (b.minY == null ? b.min : b.minY) && p.y <= (b.maxY == null ? b.max : b.maxY);
    }
    _occupied(exceptId) { return new Set(this.units.filter(u => u.id !== exceptId && this._alive(u)).map(key)); }
    _neighbors(p, occupied) {
      const out = [];
      for (const n of this.level.neighbors(node(p), this.gateOpen) || []) {
        const cost = Number(n.cost == null ? 1 : n.cost);
        if (!Number.isFinite(cost) || cost < 1 || !this._validNode(n) || occupied.has(key(n))) continue;
        if (!this.level.canStand(node(n), this.gateOpen)) continue;
        out.push({ ...node(n), cost });
      }
      return out;
    }
    _paths(u, budget, target) {
      const start = node(u), startKey = key(start), records = new Map();
      const occupied = this._occupied(u.id), heap = new Heap();
      records.set(startKey, { node: start, cost: 0, previous: null });
      heap.push({ node: start, cost: 0 }, 0);
      while (heap.length) {
        const entry = heap.pop(), currentKey = key(entry.node);
        if (records.get(currentKey).cost !== entry.cost) continue;
        if (target && same(entry.node, target)) break;
        for (const n of this._neighbors(entry.node, occupied)) {
          const total = entry.cost + n.cost, k = key(n), old = records.get(k);
          if (total > budget || (old && old.cost <= total)) continue;
          records.set(k, { node: node(n), cost: total, previous: currentKey });
          heap.push({ node: node(n), cost: total }, total);
        }
      }
      return records;
    }
    _path(records, destination) {
      let k = key(destination); const path = [];
      while (k != null) {
        const rec = records.get(k); if (!rec) return [];
        path.push(node(rec.node)); k = rec.previous;
      }
      return path.reverse();
    }

    snapshot() {
      return copy({ units: this.units, selectedId: this.selectedId, turn: this.turn, phase: this.phase,
        status: this.status, gateOpen: this.gateOpen, hackProgress: this.hackProgress,
        medkitUsed: this.medkitUsed, grade: this.grade, logs: this.logs });
    }
    select(id) {
      const reason = this._guard(id, 0), u = this._get(id);
      if (reason || !u || u.team !== 'player') return this._fail(reason || 'Select a squad operative.');
      this.selectedId = id;
      return { ok: true, reason: null, message: `${u.name} selected.`, events: [] };
    }
    reachable(id, dash = false) {
      if (this._guard(id, dash ? 2 : 1)) return [];
      const u = this._get(id), records = this._paths(u, u.range * (dash ? 2 : 1));
      return [...records.values()].filter(r => r.cost > 0)
        .map(r => ({ ...node(r.node), cost: r.cost }))
        .sort((a, b) => a.cost - b.cost || a.layer - b.layer || a.y - b.y || a.x - b.x);
    }
    previewMove(id, destination, dash = false) {
      const apCost = dash ? 2 : 1, reason = this._guard(id, apCost), u = this._get(id);
      if (reason) return { ...this._fail(reason), path: [], cost: 0, apCost };
      const target = destination && { x: destination.x, y: destination.y,
        layer: destination.layer == null ? u.layer : destination.layer };
      if (!this._validNode(target) || !this.level.canStand(target, this.gateOpen)) {
        return { ...this._fail('That position is not a walkable tile.'), path: [], cost: 0, apCost };
      }
      if (same(u, target)) return { ...this._fail('Choose a different tile.'), path: [], cost: 0, apCost };
      if (this._occupied(id).has(key(target))) return { ...this._fail('Another unit occupies that tile.'), path: [], cost: 0, apCost };
      const records = this._paths(u, u.range * (dash ? 2 : 1), target), record = records.get(key(target));
      if (!record) return { ...this._fail('No legal path reaches that tile within this action.'), path: [], cost: 0, apCost };
      return { ok: true, reason: null, path: this._path(records, target), cost: record.cost, apCost };
    }
    move(id, destination, dash = false) {
      // Recompute from current state; a prior UI preview grants no authority.
      const preview = this.previewMove(id, destination, dash);
      if (!preview.ok) return this._fail(preview.reason);
      const u = this._get(id), events = [];
      u.ap -= preview.apCost; u.hunkered = false; u.overwatch = false;
      let segment = { type: 'move', id, path: [node(u)], dash: !!dash };
      events.push(segment);
      for (let i = 1; i < preview.path.length; i++) {
        const next = preview.path[i];
        Object.assign(u, node(next)); segment.path.push(node(next));
        const reacted = this._reactions(u, events);
        if (!this._alive(u) || this.status !== 'active') break;
        if (reacted && i < preview.path.length - 1) {
          segment = { type: 'move', id, path: [node(u)], dash: !!dash };
          events.push(segment);
        }
      }
      const message = this._alive(u) ? `${u.name} ${dash ? 'dashed' : 'moved'} to (${u.x}, ${u.y})${u.layer ? ' on the roof' : ''}.`
        : `${u.name}'s move was interrupted.`;
      return this._success(message, events);
    }

    _distance(a, b) {
      return Math.hypot(a.x - b.x, a.y - b.y, this.level.heightAt(node(a)) - this.level.heightAt(node(b)));
    }
    _cover(p) {
      const value = this.level.coverAt(node(p));
      if (typeof value === 'number') return clamp(value, 0, 2);
      if (value === true) return 1;
      const type = String(value && (value.type || value.kind) || value || '').toUpperCase();
      return type === 'HIGH' ? 2 : type === 'LOW' || type === 'COVER' ? 1 : 0;
    }
    _shotData(attacker, target, from = attacker) {
      if (!this._alive(attacker) || !this._alive(target)) return this._fail('The target or attacker is unavailable.');
      if (attacker.team === target.team) return this._fail('Choose a hostile target.');
      const distance = this._distance(from, target);
      if (distance > attacker.attackRange) return this._fail('The target is out of range.');
      if (this.level.blocksSight(node(from), node(target), this.gateOpen)) return this._fail('Line of sight is blocked.');
      const cover = this._cover(target), high = this.level.heightAt(node(from)) - this.level.heightAt(node(target));
      const scanned = target.markedUntil >= this.turn && attacker.team === 'player';
      const chance = Math.round(clamp(attacker.aim - cover * 18 - (target.hunkered ? 22 : 0)
        - Math.min(22, Math.max(0, distance - 7) * 1.6) + (high >= 3 ? 10 : 0) + (scanned ? 15 : 0), 10, 95));
      return { ok: true, reason: null, chance, damage: attacker.damage, distance: Math.round(distance * 10) / 10,
        cover, highGround: high >= 3, scanned };
    }
    attackPreview(id, targetId) {
      const reason = this._guard(id, 1);
      return reason ? this._fail(reason) : this._shotData(this._get(id), this._get(targetId));
    }
    attack(id, targetId) {
      const preview = this.attackPreview(id, targetId);
      if (!preview.ok) return this._fail(preview.reason);
      const attacker = this._get(id), target = this._get(targetId), events = [];
      attacker.ap--; attacker.overwatch = false; attacker.hunkered = false;
      const shot = this._resolveShot(attacker, target, preview, events, false);
      return this._success(`${attacker.name}: ${shot.hit ? `${shot.damage} damage to ${target.name}` : `missed ${target.name}`}.`, events);
    }
    _resolveShot(attacker, target, preview, events, reaction) {
      const hit = this._random() * 100 < preview.chance, damage = hit ? Math.min(target.hp, preview.damage) : 0;
      const shot = { type: 'shot', from: node(attacker), to: node(target), hit, damage,
        attackerId: attacker.id, targetId: target.id, chance: preview.chance, reaction: !!reaction };
      events.push(shot); attacker.alerted = true; target.alerted = true;
      if (hit) target.hp = Math.max(0, target.hp - damage);
      if (target.hp === 0) {
        target.dead = true; target.ap = 0; target.overwatch = false; target.hunkered = false;
        events.push({ type: 'death', id: target.id });
        this._log(`${target.name} is down.`);
        if (target.id === this.selectedId) this.selectedId = (this._players()[0] || {}).id || null;
        if (target.id === 'T' || this._players().length === 0) {
          this.status = 'lost'; this.phase = 'ended';
          const message = target.id === 'T' ? 'Aya was lost. The relay mission has failed.' : 'The squad was lost.';
          this._log(message); events.push({ type: 'lost', reason: message });
        }
      }
      return shot;
    }
    _reactions(mover, events) {
      let reacted = false;
      for (const watcher of this.units.slice().sort(unitSort)) {
        if (!this._alive(mover) || this.status !== 'active') break;
        if (!this._alive(watcher) || watcher.team === mover.team || !watcher.overwatch) continue;
        const preview = this._shotData(watcher, mover);
        if (!preview.ok) continue;
        // AP was paid at reservation. One trigger consumes the reservation even on a miss.
        watcher.overwatch = false; reacted = true;
        this._resolveShot(watcher, mover, preview, events, true);
        this._log(`${watcher.name} used overwatch against ${mover.name}.`);
      }
      return reacted;
    }
    overwatch(id) {
      const reason = this._guard(id, 1), u = this._get(id);
      if (reason) return this._fail(reason);
      if (u.overwatch) return this._fail('Overwatch is already reserved.');
      u.ap--; u.overwatch = true; u.hunkered = false;
      return this._success(`${u.name} reserved one reaction shot.`, [{ type: 'overwatch', id }]);
    }
    hunker(id) {
      const reason = this._guard(id, 1), u = this._get(id);
      if (reason) return this._fail(reason);
      if (u.hunkered) return this._fail('That unit is already hunkered.');
      u.ap--; u.hunkered = true; u.overwatch = false;
      return this._success(`${u.name} hunkered until their next turn.`, [{ type: 'hunker', id }]);
    }
    scan(id) {
      const reason = this._guard(id, 1), u = this._get(id);
      if (reason) return this._fail(reason);
      if (u.role !== 'R' || u.team !== 'player') return this._fail('Only Recon can scan.');
      const targets = this.units.filter(t => t.team === 'enemy' && this._alive(t) && this._distance(u, t) <= 26);
      u.ap--; u.overwatch = false; u.hunkered = false;
      for (const t of targets) t.markedUntil = this.turn + 1;
      return this._success(targets.length ? `Recon marked ${targets.length} threats: +15 hit chance through next turn.` : 'Scan complete. No threats within 26 tiles.',
        [{ type: 'scan', id, targets: targets.map(t => t.id), until: this.turn + 1 }]);
    }

    _near(u, p, distance) { return !!p && u.layer === (p.layer || 0) && manhattan(u, p) <= distance; }
    _inEvac(u) {
      const e = this.level.evac;
      return !!e && u.layer === 0 && (u.x - e.x) ** 2 + (u.y - e.y) ** 2 <= e.r ** 2;
    }
    interactionPreview(id, requested) {
      const reason = this._guard(id, 1), u = this._get(id);
      if (reason) return this._fail(reason);
      if (u.team !== 'player') return this._fail('Only the squad can use mission equipment.');
      const relayNear = this._near(u, this.level.relay, 2);
      if ((!requested || requested === 'hack') && relayNear && u.role === 'T' && this.hackProgress < 2) {
        return { ok: true, reason: null, kind: 'hack', label: `Hack relay (${this.hackProgress + 1}/2)`, apCost: 1 };
      }
      if ((!requested || requested === 'gate') && u.role === 'E' && !this.gateOpen && this._near(u, this.level.gate, 3)) {
        return { ok: true, reason: null, kind: 'gate', label: 'Open service gate', apCost: 1 };
      }
      if ((!requested || requested === 'medkit') && !this.medkitUsed && u.hp < u.maxHp && this._near(u, this.level.medkit, 2)) {
        return { ok: true, reason: null, kind: 'medkit', label: 'Use medkit', apCost: 1 };
      }
      if ((!requested || requested === 'extract') && this._inEvac(u)) {
        if (this.hackProgress < 2) return this._fail('Complete both relay hacks before extraction.');
        const outside = this._players().filter(p => !this._inEvac(p));
        if (outside.length) return this._fail(`Bring ${outside.map(p => p.name).join(', ')} into the extraction zone.`);
        return { ok: true, reason: null, kind: 'extract', label: 'Extract squad', apCost: 1 };
      }
      if (relayNear && this.hackProgress < 2 && u.role !== 'T') return this._fail('Only Aya (T) can hack the relay.');
      if (requested === 'hack') return this._fail(this.hackProgress >= 2 ? 'The relay is already secured.' : 'Aya must be within two ground tiles of the relay.');
      if (requested === 'medkit' && this.medkitUsed) return this._fail('The medkit has already been used.');
      return this._fail('No usable mission equipment is in reach.');
    }
    interact(id, requested) {
      const preview = this.interactionPreview(id, requested);
      if (!preview.ok) return this._fail(preview.reason);
      const u = this._get(id), events = [];
      u.ap--; u.overwatch = false; u.hunkered = false;
      let message;
      if (preview.kind === 'hack') {
        this.hackProgress++;
        message = this.hackProgress === 2 ? 'Relay secured. Bring every surviving operative back to extraction.' : 'Relay hack 1/2 complete. Aya needs one more action.';
        events.push({ type: 'hack', id, progress: this.hackProgress });
      } else if (preview.kind === 'gate') {
        this.gateOpen = true; message = 'Service gate opened.';
        events.push({ type: 'gate', id, open: true });
      } else if (preview.kind === 'medkit') {
        const healed = Math.min(6, u.maxHp - u.hp);
        u.hp += healed; this.medkitUsed = true; message = `${u.name} recovered ${healed} HP.`;
        events.push({ type: 'heal', id, amount: healed });
      } else {
        const survivors = this._players();
        this.grade = survivors.length === 3 ? 'A' : survivors.length === 2 ? 'B' : 'C';
        this.status = 'won'; this.phase = 'ended';
        for (const survivor of survivors) survivor.extracted = true;
        message = `Mission complete. ${survivors.length}/3 operatives extracted. Grade ${this.grade}.`;
        events.push({ type: 'won', survivors: survivors.map(p => p.id), grade: this.grade });
      }
      return this._success(message, events);
    }
    extract(id) { return this.interact(id, 'extract'); }

    _bestAttack(u) {
      return this._players().map(p => ({ target: p, preview: this._shotData(u, p) }))
        .filter(p => p.preview.ok).sort((a, b) => (b.preview.chance - a.preview.chance) || a.target.hp - b.target.hp || a.target.id.localeCompare(b.target.id))[0];
    }
    _pursuitPath(u, target) {
      // A* across the level, not a straight-line shortcut through buildings or canals.
      const start = node(u), records = new Map([[key(start), { node: start, cost: 0, previous: null }]]);
      const occupied = this._occupied(u.id), heap = new Heap();
      const heuristic = p => manhattan(p, target); // Stair cost is at least horizontal travel in this level.
      heap.push({ node: start, cost: 0 }, heuristic(start));
      let examined = 0;
      while (heap.length && examined++ < 12000) {
        const current = heap.pop(), k = key(current.node);
        if (records.get(k).cost !== current.cost) continue;
        if (current.node.layer === target.layer && manhattan(current.node, target) <= 1) return this._path(records, current.node);
        for (const n of this._neighbors(current.node, occupied)) {
          const cost = current.cost + n.cost, nk = key(n), old = records.get(nk);
          if (old && old.cost <= cost) continue;
          records.set(nk, { node: node(n), cost, previous: k });
          heap.push({ node: node(n), cost }, cost + heuristic(n));
        }
      }
      return [];
    }
    _enemyAct(u) {
      const events = [];
      const run = result => { if (result.ok) events.push(...result.events); return result.ok; };
      if (!this._alive(u) || this.status !== 'active') return events;
      const targets = this._players().sort((a, b) => this._distance(u, a) - this._distance(u, b) || a.id.localeCompare(b.id));
      if (!targets.length) return events;
      const nearest = targets[0], immediate = this._bestAttack(u);
      if (immediate) {
        run(this.attack(u.id, immediate.target.id));
        if (this.status === 'active' && u.ap) run(this.hunker(u.id));
        return events;
      }
      if (!u.alerted && this._distance(u, nearest) > 30) { run(this.overwatch(u.id)); return events; }
      u.alerted = true;
      const records = this._paths(u, u.range);
      const candidates = [...records.values()].filter(r => r.cost > 0)
        .sort((a, b) => this._distance(a.node, nearest) - this._distance(b.node, nearest) || a.cost - b.cost).slice(0, 80);
      let vantage = null;
      for (const candidate of candidates) {
        const shot = this._shotData(u, nearest, candidate.node);
        if (!shot.ok) continue;
        const score = shot.chance + this._cover(candidate.node) * 8 - candidate.cost * 0.2;
        if (!vantage || score > vantage.score) vantage = { ...candidate, score };
      }
      if (vantage) run(this.move(u.id, vantage.node));
      else {
        const path = this._pursuitPath(u, nearest);
        let endpoint = null, cost = 0;
        for (let i = 1; i < path.length; i++) {
          const edge = this._neighbors(path[i - 1], this._occupied(u.id)).find(n => same(n, path[i]));
          if (!edge || cost + edge.cost > u.range) break;
          cost += edge.cost; endpoint = path[i];
        }
        if (endpoint) run(this.move(u.id, endpoint));
        // A weighted stair can exceed one move. Dash only when its first link requires it.
        else if (path.length > 1 && u.ap === 2) {
          const dashPreview = this.previewMove(u.id, path[1], true);
          if (dashPreview.ok) run(this.move(u.id, path[1], true));
        }
      }
      if (!this._alive(u) || this.status !== 'active' || !u.ap) return events;
      const shot = this._bestAttack(u);
      if (shot) run(this.attack(u.id, shot.target.id));
      else run(this.overwatch(u.id));
      return events;
    }
    endTurn() {
      if (this.status !== 'active' || this.phase !== 'player') return this._fail('A player turn is not active.');
      this.phase = 'enemy'; const events = [{ type: 'phase', phase: 'enemy', turn: this.turn }];
      this._log('Enemy turn.');
      for (const u of this.units.filter(u => u.team === 'enemy' && this._alive(u))) {
        u.ap = u.maxAp; u.overwatch = false; u.hunkered = false;
      }
      for (const u of this.units.filter(u => u.team === 'enemy').sort(unitSort)) {
        events.push(...this._enemyAct(u));
        if (this.status !== 'active') return this._success('Mission failed during the enemy turn.', events);
      }
      this.turn++; this.phase = 'player';
      for (const u of this._players()) { u.ap = u.maxAp; u.overwatch = false; u.hunkered = false; }
      if (!this._alive(this._get(this.selectedId))) this.selectedId = (this._players()[0] || {}).id || null;
      events.push({ type: 'phase', phase: 'player', turn: this.turn });
      return this._success(`Turn ${this.turn}. Every surviving operative has 2 AP.`, events);
    }
    restart(seed = this.seed) {
      const next = new P3Game(this.level, seed);
      Object.assign(this, next);
      return this._success('Mission restarted.', [{ type: 'restart' }]);
    }
  }
  return P3Game;
});
