/* ============================================================
   THE KEEPERS — the people, and the errand that moves the record.

   Four check-ins told you a building was important. Nobody told you
   why, and nothing asked anything of you: you walked near a wall and
   a card appeared. This module puts a person on each site and gives
   the walk a reason.

   The errand is the record itself, gathered by hand.

   An earlier version of this file had the institutions couriering
   paper to each other — Bridgeport sending its proclamation to
   Hartford, Hartford sending its citations to Atlanta. That never
   happened. Three separate bodies recognised this work
   independently and none of them corresponded with any other, so a
   relay invented a relationship between real public agencies and
   quietly misstated what the documents are. In a world whose entire
   job is to carry a public record accurately, that is not a
   harmless bit of flavour.

   What is true: the City of Bridgeport issued one proclamation, the
   Connecticut General Assembly issued three citations, and the
   Governor of Georgia issued one proclamation — all of them TO
   Equity Uprise, none of them to each other. The Docket 516 / 516R
   decision was not issued to anybody; it was won. So you collect
   the three honours, in whatever order you like, and carry them to
   Shiloh, where the case they are about was actually fought. Paper
   recognition converging on the ground that earned it.

   There is no timer, no fail state, and nothing to drop —
   wandering off is allowed, because wandering is the game.

   Check-ins are untouched. A landmark still lights the moment you
   are near it, whether or not you are carrying anything, so the
   documents are never behind a quest. An errand is a reason to
   walk, not a second lock on the evidence.

   THE KEEPERS ARE REAL PEOPLE. This replaced an earlier cast of
   invented role-holders at the owner's instruction: the officials who
   actually signed these documents hand them over. Mayor Joseph P.
   Ganim in Bridgeport. The Speaker of the House with the nine
   legislators who introduced the citations and the President Pro
   Tempore who signed them, in Hartford. Governor Brian P. Kemp in
   Atlanta.

   Two rules hold that in place, and they are not stylistic.

   NO INVENTED OPINIONS. Every line a named official speaks stays
   inside the four corners of the document they signed — the honour,
   its date, its subject. They do not endorse the game, the album, a
   candidate or each other, and they do not comment on Docket 516.
   Putting an opinion in a living public figure's mouth is the line,
   and reciting their own paperwork does not cross it.

   NO LIKENESSES. The rig is a stylised low-poly figure and no attempt
   is made to resemble anyone's face, build or colouring. Identity is
   carried by the nameplate and the title. Do not "improve" this by
   sourcing photographs and sculpting faces.

   A site whose name is not confirmed gets no figure at all, rather
   than an anonymous stand-in — see the AWAITING note on the Shiloh
   entry in data/uprise-world.json.

   None of them wears the HM monogram or the Kingdom Steppa crest;
   those are McCluster's, and putting his chest badge on a state
   official would make his clothes mean nothing and misrepresent them
   besides.
   ============================================================ */

const TALK_R = 6.2;        /* world units — a step closer than a check-in */
const LEAVE_R = 9.0;       /* hysteresis, so a card does not strobe on the edge */
const CULL_R  = 90.0;      /* hide a site's people until you are near it */
const STAND_OFF = 7.4;     /* how far off the landmark centre a keeper stands */

const UP = { x: 0, y: 1, z: 0 };

/* Colouring for a standing delegation. Civic-neutral coats and a
   spread of skin values so eleven named people do not render as
   eleven copies of one figure. Deterministic by index, so a given
   delegate looks the same on every load. This is variety only: no
   entry is chosen to resemble any actual person, and nothing here
   should ever be tuned against a photograph. */
const DELEGATE_PALETTE = [
  { coat: 0x2e3a4e, trouser: 0x272a31, skin: 0x8a5b3b },
  { coat: 0x3d3a44, trouser: 0x2b2b30, skin: 0xc09a78 },
  { coat: 0x2b4038, trouser: 0x262a2b, skin: 0x6d4326 },
  { coat: 0x4a3f42, trouser: 0x2f2b2d, skin: 0xa87551 },
  { coat: 0x37455c, trouser: 0x2a2d34, skin: 0x53331f },
  { coat: 0x45412f, trouser: 0x2e2c26, skin: 0xd0aa88 },
  { coat: 0x33384a, trouser: 0x282a30, skin: 0x7a4a2e },
  { coat: 0x4e3c34, trouser: 0x302a27, skin: 0xb8875f },
  { coat: 0x2f4a4a, trouser: 0x272f2f, skin: 0x96634a },
  { coat: 0x3a3550, trouser: 0x2a2833, skin: 0x63401f }
];

/* "#7a4a2e" -> 0x7a4a2e. The design file carries colours as strings
   because JSON has no hex literal, and a bare decimal in a data file
   is unreadable to whoever tunes it next. */
function hex(v, fallback) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^#?[0-9a-f]{6}$/i.test(v.trim())) {
    return parseInt(v.trim().replace(/^#/, ""), 16);
  }
  return fallback;
}

export async function buildKeepers(THREE, opts = {}) {
  const { people, marks, groundAt, reduced = false } = opts;
  if (!people || !Array.isArray(people.keepers) || !marks || !marks.length) return null;

  let buildFellow = null;
  try {
    const mod = await import("./uprise-character.js");
    if (mod && typeof mod.buildFellow === "function") buildFellow = mod.buildFellow;
  } catch (e) { buildFellow = null; }
  if (!buildFellow) return null;   /* no rig, no people — the world still runs */

  const _up = new THREE.Vector3(), _fwd = new THREE.Vector3(), _right = new THREE.Vector3();
  const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _d = new THREE.Vector3();
  const LOCAL_UP = new THREE.Vector3(0, 1, 0);

  /* Point an object that lives on a sphere: local +Y along the
     surface normal, local +Z along a tangent bearing. Building the
     basis outright avoids the two-step (orient, then spin) that
     needs a reference vector and blows up at the poles. */
  function orientTangent(obj, n, towards) {
    _up.copy(n).normalize();
    _fwd.copy(towards).addScaledVector(_up, -towards.dot(_up));
    if (_fwd.lengthSq() < 1e-8) _fwd.set(0, 0, 1).addScaledVector(_up, -_up.z);
    _fwd.normalize();
    _right.crossVectors(_up, _fwd).normalize();
    _m.makeBasis(_right, _up, _fwd);
    obj.quaternion.setFromRotationMatrix(_m);
  }

  const list = [];
  const group = new THREE.Group();

  for (const K of people.keepers) {
    const home = marks.find((m) => m.data && m.data.slug === K.at);
    if (!home) continue;   /* a keeper with no landmark is a data typo, not a crash */

    /* Stand them off the centre of the site rather than inside the
       building. The offset runs along the tangent that points back
       toward the middle of the map, which is the side every approach
       comes from. */
    const n = home.n.clone().normalize();
    _d.set(-n.z, 0, n.x);                       /* any tangent will do */
    if (_d.lengthSq() < 1e-8) _d.set(1, 0, 0);
    _d.normalize();
    const stand = n.clone()
      .addScaledVector(_d, STAND_OFF / (groundAt ? groundAt(n) : 100))
      .normalize();

    const root = new THREE.Group();
    root.position.copy(stand).multiplyScalar(groundAt ? groundAt(stand) : 100);
    orientTangent(root, stand, _v.copy(n).negate());
    group.add(root);

    const rigs = [];

    /* A site with no confirmed name gets NO figure. The owner asked
       for real people only, and an anonymous body standing in for one
       is not a real person — it is a guess wearing a coat. The site
       still receives the record; the card names the place instead. */
    const look = K.look || {};
    if (K.name) {
      const api = buildFellow(THREE, {
        reducedMotion: reduced, contactShadow: true,
        beard: false, marks: false,     /* never the protagonist's beard or garment marks */
        tint: {
          hoodie: hex(look.hoodie, 0x5b6470),
          pants: hex(look.pants, 0x34363d),
          skin: hex(look.skin, 0x6b4326),
          cuff: hex(look.cuff, 0x2a2c32)
        }
      });
      if (api && api.group) { root.add(api.group); rigs.push(api); }
    }

    /* The delegation — everyone else printed on the document. Built
       at strands:0 (5,080 tris against 14,440) because eleven full
       rigs at one site is twelve times the whole planet. They stand
       in a shallow arc behind the speaker and do not talk. */
    const del = Array.isArray(K.delegation) ? K.delegation : [];
    del.forEach((person, j) => {
      /* Vary the colouring per delegate. Eleven identical figures read
         as a queue of clones, which is a poor way to represent eleven
         named people. This is variety, NOT likeness: the palette is
         deterministic from the index so it is stable across loads, and
         no value is chosen to resemble any actual person. */
      const v = DELEGATE_PALETTE[j % DELEGATE_PALETTE.length];
      const api = buildFellow(THREE, {
        reducedMotion: reduced, contactShadow: true,
        beard: false, marks: false, strands: 0,
        /* A delegate stands; it never walks. Flattening it to one mesh
           per material trades joint articulation — invisible at the
           distance a delegation is read from — for roughly a sixth of
           the draw calls. Idle moves to the group below. */
        staticPose: true,
        tint: { hoodie: v.coat, pants: v.trouser, skin: v.skin, cuff: v.trouser }
      });
      if (!api || !api.group) return;

      /* A shallow semicircle behind the speaker, opening toward the
         player. Two ranks once past six so the back row is visible
         between the shoulders of the front. */
      const front = Math.min(6, del.length);
      const rank = j < front ? 0 : 1;
      const idx = rank === 0 ? j : j - front;
      const span = rank === 0 ? front : Math.max(1, del.length - front);
      const t = span === 1 ? 0 : (idx / (span - 1)) - 0.5;   /* -0.5 .. +0.5 */
      const arc = t * (rank === 0 ? 2.5 : 2.0);              /* radians across */
      const rad = 3.1 + rank * 1.5;
      api.group.position.set(Math.sin(arc) * rad, 0, -Math.cos(arc) * rad + 0.6);
      api.group.rotation.y = arc * 0.55;                     /* fan inward */
      root.add(api.group);
      rigs.push(api);
      api.__person = person;
    });

    if (!rigs.length && !K.receives) continue;   /* nothing to show, nothing to do */

    list.push({
      data: K, rigs, root, n: stand,
      near: false, spoken: false,
      visible: true,
      /* a little idle variety so a delegation does not breathe in lockstep */
      phase: Math.random()
    });
  }

  if (!list.length) return null;

  /* ---------- the errand state ----------
     `carrying` is a list, not a slot. The three honours were issued
     independently and all go to the same place, so forcing one at a
     time would mean three round trips across the planet to satisfy
     a rule the record does not have. Deliberately tiny and
     inspectable: what you hold, who has handed over, what has
     landed. The HUD reads it, the harness asserts on it. */
  const state = {
    carrying: [],            /* [{ id, label, detail, to, toName, fromName }] */
    handedOver: new Set(),   /* keeper slugs that have given their parcel */
    delivered: new Set(),    /* parcel ids that reached Shiloh */
    holds(id) { return state.carrying.some((c) => c.id === id); },
    get done() { return state.delivered.size; },
    get total() { return people.keepers.filter((k) => k.gives).length; }
  };

  const nameOf = (slug) => {
    const m = marks.find((x) => x.data && x.data.slug === slug);
    return m && m.data ? m.data.name : slug;
  };

  /* What happens when you reach a keeper. One trigger does both
     halves of the exchange — take what you are carrying if it is
     theirs, then hand you theirs if they have one. No button: a
     keypress is a desktop-only affordance and this has to work with
     a thumb. */
  function greet(k) {
    const K = k.data;
    const out = { keeper: K, took: [], gave: null, line: K.lines.greet };

    /* Take anything they are the recipient for. `receives` is a list
       because Shiloh is the destination for all three honours, and
       you may arrive holding any combination of them. */
    const wants = Array.isArray(K.receives) ? K.receives
      : (K.receives ? [K.receives] : []);
    if (wants.length && state.carrying.length) {
      const keep = [];
      for (const c of state.carrying) {
        if (wants.includes(c.id)) { out.took.push(c); state.delivered.add(c.id); }
        else keep.push(c);
      }
      state.carrying = keep;
    }

    /* Hand over theirs. No ordering gate: the three bodies acted
       independently, so requiring one before another would be a rule
       the record does not have. */
    if (K.gives && !state.handedOver.has(K.slug)) {
      state.handedOver.add(K.slug);
      const parcel = {
        id: K.gives.id,
        label: K.gives.label,
        detail: K.gives.detail || "",
        to: K.gives.to,
        toName: nameOf(K.gives.to),
        fromName: K.name
      };
      state.carrying.push(parcel);
      out.gave = parcel;
      out.line = K.lines.give;
      k.spoken = true;
      return out;
    }

    if (out.took.length) out.line = K.lines.give || K.lines.greet;
    else if (k.spoken) out.line = state.carrying.length ? K.lines.waiting : K.lines.thanks;
    k.spoken = true;
    return out;
  }

  /* ---------- per-frame ---------- */
  function update(dt, now, playerPos) {
    for (const k of list) {
      if (!playerPos) continue;
      _v.copy(playerPos).sub(k.root.position);
      const dist = _v.length();

      /* CULL BY SITE. A rig off screen still costs its triangles every
         frame, and the whole cast at once is many times the planet.
         Hiding a site's people until you are near it bounds the cost
         to wherever you are standing rather than to the size of the
         cast, which is what lets Hartford hold eleven of them. */
      const show = dist < CULL_R;
      if (show !== k.visible) { k.visible = show; k.root.visible = show; }
      if (!show) continue;

      /* Idle. An articulated figure breathes through its joints; a
         flattened one has none, so it breathes as a whole — a slow
         rise and a little sway, offset per figure so a delegation
         never moves in lockstep. Cheap enough that ten of them cost
         nothing, and at reading distance it is the only part of an
         idle anyone actually perceives. */
      for (let i = 0; i < k.rigs.length; i++) {
        const rig = k.rigs[i];
        if (rig.frozen) {
          if (reduced) continue;
          const ph = now * 0.0011 + k.phase * 6.283 + i * 0.9;
          rig.group.position.y = Math.sin(ph) * 0.018;
          rig.group.rotation.z = Math.sin(ph * 0.62) * 0.011;
        } else {
          rig.setAnimation("idle");
          rig.update(dt, 0);
          if (!reduced) rig.setPhase((now * 0.00013 + k.phase + i * 0.137) % 1);
        }
      }

      /* turn to face whoever is standing in front of them */
      if (dist < LEAVE_R * 2) orientTangent(k.root, k.n, _v);
      else orientTangent(k.root, k.n, _d.copy(k.n).negate());

      if (!k.near && dist < TALK_R) {
        k.near = true;
        const ev = greet(k);
        if (opts.onTalk) opts.onTalk(ev, state);
      } else if (k.near && dist > LEAVE_R) {
        k.near = false;
        if (opts.onLeave) opts.onLeave(k.data, state);
      }
    }
  }

  function dispose() {
    for (const k of list) for (const r of k.rigs) { try { r.dispose(); } catch (e) { /* already gone */ } }
  }

  return { group, list, state, update, dispose };
}

export default buildKeepers;
