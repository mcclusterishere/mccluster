/* PRIM3 operatives: articulated procedural mannequins in the Prim3 Field loadouts (LOADOUTS.md).
   Shared by the tactics renderers. Extracted unchanged from board3d.mjs's operative()/pose(); the
   only differences are that the materials, helpers and team colours come in as parameters. */
export function createOperativeKit(THREE, { team, haloTex, reducedMotion = false }) {
  const TEAM = team;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const add = (geo, mat, x, y, z, { cast = true, recv = true, parent } = {}) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = recv; parent.add(m); return m; };
  function limb(len, r0, r1, mat) { // a capsule-ish segment hanging down from its pivot
    const piv = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CapsuleGeometry((r0 + r1) / 2, len - (r0 + r1), 4, 10), mat);
    m.position.y = -len / 2; m.castShadow = true; piv.add(m);
    const end = new THREE.Group(); end.position.y = -len; piv.add(end);
    piv.userData.end = end; return piv;
  }
  // Field operators as the owner's loadout photographs show them (Prim3 phenotypes/operators/LOADOUTS.md):
  // faceless black mannequins, everything they wear and carry in black. The figure faces +Z, so its
  // own right side is −X.
  //   E · FO-E-AE  protective carrier, knee pads, over-ear headset, body camera (its right chest),
  //                belt pouches, right-hip holster, entry tool at the right thigh, compact carbine slung left
  //   R · FO-R-SO  light chest rig, binoculars in a sternum pouch, recorder (its right chest), one-ear
  //                headset, belt radio, right-hip holster, scoped rifle slung left
  //   T · FO-T-STD short sleeves, zip soft vest, centre-chest recorder, radio on the left strap, deck
  //                sling over the right shoulder, open cyberdeck held at the waist, belt pouches, sidearm
  //   H · SOI-01   short sleeves, thin vest, body camera, holstered sidearm, cyberdeck; no helmet
  // No marks are drawn (the canon omits a mark rather than approximating it). Long guns hang on the
  // sling at rest and come to the hands only to shoot.
  function operative(u) {
    const ally = u.faction === 'PLAYER', role = ally ? u.role : 'H';
    const body = std({ color: 0x0a0a0b, roughness: 0.32, metalness: 0.08 });   // mannequin
    const cloth = std({ color: 0x111214, roughness: 0.93 });                    // field fabric
    const gear = std({ color: 0x18191b, roughness: 0.78 });                     // nylon webbing, pouches
    const hard = std({ color: 0x0d0e10, roughness: 0.42, metalness: 0.35 });    // weapons, devices
    const boot = std({ color: 0x080808, roughness: 0.55 });
    const g = new THREE.Group(); g.userData.unitId = u.id;
    const rig = { role };
    const hips = new THREE.Group(); hips.position.y = 0.92; g.add(hips); rig.hips = hips;
    add(new THREE.BoxGeometry(0.31, 0.16, 0.2), cloth, 0, 0, 0, { parent: hips });
    add(new THREE.BoxGeometry(0.33, 0.045, 0.215), gear, 0, 0.065, 0, { parent: hips });                 // belt
    add(new THREE.BoxGeometry(0.05, 0.035, 0.02), hard, 0, 0.065, 0.11, { parent: hips });                // buckle
    const spine = new THREE.Group(); spine.position.y = 0.08; hips.add(spine); rig.spine = spine;
    const chest = new THREE.Group(); spine.add(chest); rig.chest = chest;
    const torso = add(new THREE.CapsuleGeometry(0.16, 0.27, 4, 14), cloth, 0, 0.25, 0, { parent: chest }); torso.scale.set(1.12, 1, 0.76);
    add(new THREE.CylinderGeometry(0.068, 0.08, 0.075, 14), cloth, 0, 0.47, 0, { parent: chest });       // collar / quarter-zip
    const neck = new THREE.Group(); neck.position.y = 0.5; chest.add(neck); rig.neck = neck;
    add(new THREE.CylinderGeometry(0.043, 0.05, 0.08, 12), body, 0, 0.02, 0, { parent: neck });
    const head = add(new THREE.SphereGeometry(0.1, 24, 18), body, 0, 0.145, 0.01, { parent: neck }); head.scale.set(0.9, 1.26, 1.0);
    const camLight = (x, y, z, parent) => add(new THREE.SphereGeometry(0.007, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3344, toneMapped: false }), x, y, z, { parent, cast: false });
    const recorder = (x, y, z) => { add(new THREE.BoxGeometry(0.05, 0.065, 0.028), hard, x, y, z, { parent: chest }); add(new THREE.CircleGeometry(0.013, 14), std({ color: 0x050505, roughness: 0.05, metalness: 0.6 }), x, y + 0.008, z + 0.015, { parent: chest, cast: false }); };
    // torso equipment
    if (role === 'E') { // protective carrier: front and back plates, side cummerbund, shoulder straps
      add(new THREE.BoxGeometry(0.36, 0.3, 0.07), gear, 0, 0.25, 0.115, { parent: chest });
      add(new THREE.BoxGeometry(0.35, 0.3, 0.06), gear, 0, 0.25, -0.115, { parent: chest });
      for (const sx of [-1, 1]) { add(new THREE.BoxGeometry(0.04, 0.16, 0.24), gear, sx * 0.18, 0.2, 0, { parent: chest }); add(new THREE.BoxGeometry(0.07, 0.02, 0.27), gear, sx * 0.1, 0.415, 0, { parent: chest }); }
      add(new THREE.BoxGeometry(0.12, 0.05, 0.005), cloth, 0.05, 0.33, 0.152, { parent: chest, cast: false });      // blank ID panel
      recorder(-0.1, 0.36, 0.16); camLight(-0.085, 0.34, 0.176, chest);
    } else if (role === 'R') { // light chest rig: thin straps, binocular pouch at the sternum, recorder high on its right chest
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.035, 0.36, 0.012), gear, sx * 0.09, 0.3, 0.125, { parent: chest }).rotation.z = sx * 0.12;
      add(new THREE.BoxGeometry(0.17, 0.11, 0.07), gear, 0, 0.17, 0.14, { parent: chest });
      for (const sx of [-1, 1]) { const b = add(new THREE.CylinderGeometry(0.026, 0.026, 0.08, 14), hard, sx * 0.035, 0.24, 0.15, { parent: chest }); void b; }
      add(new THREE.BoxGeometry(0.1, 0.035, 0.005), cloth, 0, 0.34, 0.125, { parent: chest, cast: false });
      recorder(-0.11, 0.37, 0.135);
    } else if (role === 'T') { // zip soft vest, centre recorder, radio on the left strap, deck sling over the right shoulder
      const vest = add(new THREE.CapsuleGeometry(0.168, 0.22, 4, 14), gear, 0, 0.25, 0, { parent: chest }); vest.scale.set(1.14, 1, 0.82);
      add(new THREE.BoxGeometry(0.008, 0.3, 0.005), hard, 0, 0.25, 0.14, { parent: chest, cast: false });           // zip
      recorder(0, 0.37, 0.14);
      add(new THREE.BoxGeometry(0.04, 0.09, 0.025), hard, 0.1, 0.33, 0.135, { parent: chest });                    // radio, its left
      add(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 5), hard, 0.11, 0.4, 0.135, { parent: chest });
      const sling = add(new THREE.BoxGeometry(0.045, 0.62, 0.012), gear, -0.02, 0.22, 0.145, { parent: chest, cast: false }); sling.rotation.z = -0.62;
      // the open field cyberdeck, held at the waist on its sling
      const deck = new THREE.Group(); deck.position.set(0.02, -0.06, 0.27); deck.rotation.x = -0.12; chest.add(deck); rig.deck = deck;
      add(new THREE.BoxGeometry(0.26, 0.022, 0.18), hard, 0, 0, 0, { parent: deck });
      const lid = new THREE.Group(); lid.position.set(0, 0.011, -0.088); lid.rotation.x = -1.85; deck.add(lid);
      add(new THREE.BoxGeometry(0.26, 0.016, 0.18), hard, 0, 0, 0.09, { parent: lid });
      add(new THREE.PlaneGeometry(0.22, 0.14), new THREE.MeshBasicMaterial({ color: 0xd9dee1, toneMapped: false }), 0, -0.009, 0.09, { parent: lid, cast: false }).rotation.x = Math.PI / 2;
    } else { // SOI-01 officer: thin vest, body camera
      const vest = add(new THREE.CapsuleGeometry(0.167, 0.2, 4, 14), gear, 0, 0.27, 0, { parent: chest }); vest.scale.set(1.14, 1, 0.8);
      recorder(-0.08, 0.36, 0.14); camLight(-0.065, 0.34, 0.156, chest);
    }
    // head equipment
    if (role === 'E') { // over-ear headset with a boom
      const band = add(new THREE.TorusGeometry(0.105, 0.012, 6, 20, Math.PI), hard, 0, 0.15, 0, { parent: neck }); band.rotation.y = Math.PI / 2;
      for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.045, 0.045, 0.035, 14), hard, sx * 0.1, 0.13, 0, { parent: neck }).rotation.z = Math.PI / 2;
      add(new THREE.BoxGeometry(0.1, 0.008, 0.008), hard, -0.07, 0.08, 0.07, { parent: neck }).rotation.y = 0.7;
    } else if (role === 'R') { // low-profile single-ear headset
      const band = add(new THREE.TorusGeometry(0.1, 0.006, 6, 20, Math.PI), hard, 0, 0.16, 0, { parent: neck }); band.rotation.y = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.032, 0.032, 0.025, 12), hard, 0.095, 0.13, 0, { parent: neck }).rotation.z = Math.PI / 2;
      add(new THREE.BoxGeometry(0.11, 0.006, 0.006), hard, 0.06, 0.08, 0.07, { parent: neck }).rotation.y = -0.7;
    } else if (role === 'T') { // earpiece
      add(new THREE.SphereGeometry(0.018, 10, 8), hard, 0.093, 0.13, 0.01, { parent: neck });
    }
    // arms: long sleeves for E and R; short sleeves (black mannequin forearms) for T and officers
    const shortSleeve = role === 'T' || role === 'H';
    const armL = limb(0.3, 0.055, 0.047, cloth), armR = limb(0.3, 0.055, 0.047, cloth);
    armL.position.set(0.205, 0.42, 0); armR.position.set(-0.205, 0.42, 0); chest.add(armL, armR);
    if (shortSleeve) for (const a of [armL, armR]) { const lower = a.children[0]; lower.scale.y = 0.55; lower.position.y = -0.09; add(new THREE.CapsuleGeometry(0.04, 0.12, 4, 10), body, 0, -0.22, 0, { parent: a }); }
    const foreL = limb(0.28, 0.043, 0.036, shortSleeve ? body : cloth), foreR = limb(0.28, 0.043, 0.036, shortSleeve ? body : cloth);
    armL.userData.end.add(foreL); armR.userData.end.add(foreR);
    for (const f of [foreL, foreR]) { const h = add(new THREE.SphereGeometry(0.043, 12, 10), gear, 0, -0.3, 0.005, { parent: f }); h.scale.set(0.8, 1.25, 1); } // gloves
    Object.assign(rig, { armL, armR, foreL, foreR });
    // belt kit: right-hip holster and sidearm; pouches by role
    add(new THREE.BoxGeometry(0.05, 0.15, 0.09), gear, -0.19, -0.05, 0.02, { parent: hips });
    add(new THREE.BoxGeometry(0.028, 0.05, 0.07), hard, -0.19, 0.05, 0.03, { parent: hips });
    const pouch = (x, w = 0.07, h = 0.08) => add(new THREE.BoxGeometry(w, h, 0.045), gear, x, 0.0, 0.115, { parent: hips });
    if (role === 'E') { pouch(-0.07); pouch(0.07); add(new THREE.BoxGeometry(0.035, 0.1, 0.03), hard, 0.15, 0.03, 0.06, { parent: hips }); }
    if (role === 'R') { add(new THREE.BoxGeometry(0.04, 0.09, 0.03), hard, -0.13, 0.02, 0.1, { parent: hips }); pouch(0.08, 0.06, 0.07); }
    if (role === 'T') { pouch(-0.06, 0.06, 0.08); pouch(0.02, 0.05, 0.07); pouch(0.13, 0.08, 0.11); }
    // legs: trousers, boots; knee pads and the entry tool on E
    const legL = limb(0.42, 0.072, 0.062, cloth), legR = limb(0.42, 0.072, 0.062, cloth);
    legL.position.set(0.095, -0.04, 0); legR.position.set(-0.095, -0.04, 0); hips.add(legL, legR);
    const shinL = limb(0.42, 0.058, 0.05, cloth), shinR = limb(0.42, 0.058, 0.05, cloth);
    legL.userData.end.add(shinL); legR.userData.end.add(shinR);
    for (const sh of [shinL, shinR]) {
      add(new THREE.BoxGeometry(0.105, 0.1, 0.13), boot, 0, -0.42, 0.025, { parent: sh });
      add(new THREE.BoxGeometry(0.11, 0.03, 0.2), boot, 0, -0.465, 0.04, { parent: sh });
      if (role === 'E') add(new THREE.BoxGeometry(0.1, 0.11, 0.035), gear, 0, -0.02, 0.065, { parent: sh });
    }
    if (role === 'E') { const tool = add(new THREE.BoxGeometry(0.025, 0.3, 0.04), hard, -0.2, -0.22, 0.02, { parent: hips }); tool.rotation.z = 0.05; }
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.03, 0.09, 0.07), gear, sx * 0.08, -0.15, 0.06, { parent: hips }); // cargo pockets
    Object.assign(rig, { legL, legR, shinL, shinR });
    // weapons. held = the gun in the hands when shooting; slung = the same gun on the body at rest
    const longGun = (scale, scoped) => {
      const w = new THREE.Group(); const L = 0.62 * scale;
      add(new THREE.BoxGeometry(0.05, 0.08, L * 0.5), hard, 0, 0, 0, { parent: w });
      add(new THREE.CylinderGeometry(0.014, 0.014, L * 0.55, 8), hard, 0, 0.012, L * 0.5, { parent: w }).rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.04, 0.1, 0.04), hard, 0, -0.07, 0.04, { parent: w });
      add(new THREE.BoxGeometry(0.045, 0.08, 0.18), hard, 0, -0.01, -L * 0.36, { parent: w });
      if (scoped) add(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 10), hard, 0, 0.07, 0.03, { parent: w }).rotation.x = Math.PI / 2;
      else add(new THREE.BoxGeometry(0.03, 0.035, 0.05), hard, 0, 0.055, 0.04, { parent: w });     // red-dot housing
      const mz = new THREE.Group(); mz.position.set(0, 0.012, L * 0.78); w.add(mz); w.userData.muzzle = mz; return w;
    };
    const pistol = () => { const w = new THREE.Group(); add(new THREE.BoxGeometry(0.032, 0.045, 0.16), hard, 0, 0.02, 0.03, { parent: w }); add(new THREE.BoxGeometry(0.03, 0.085, 0.04), hard, 0, -0.035, -0.03, { parent: w }); const mz = new THREE.Group(); mz.position.set(0, 0.02, 0.12); w.add(mz); w.userData.muzzle = mz; return w; };
    let held, slung = null;
    if (role === 'E' || role === 'R') {
      held = longGun(role === 'R' ? 1.45 : 1.0, role === 'R');
      slung = longGun(role === 'R' ? 1.45 : 1.0, role === 'R');
      slung.position.set(0.23, 0.05, 0.02); slung.rotation.set(Math.PI / 2 + 0.12, 0, 0.08); chest.add(slung);   // muzzle down, its left side
      const strap = add(new THREE.BoxGeometry(0.035, 0.6, 0.01), gear, 0.04, 0.24, 0.13, { parent: chest, cast: false }); strap.rotation.z = 0.6;
      held.position.set(-0.05, 0.22, 0.26);
    } else { held = pistol(); held.position.set(-0.12, 0.16, 0.34); }
    chest.add(held); held.visible = false;
    Object.assign(rig, { gun: held, slung, muzzle: held.userData.muzzle, heldBase: held.position.clone() });
    // team identity: small glowing accents on the kit (like the red tabs on T's loadout) and a soft
    // ground glow; both brighten when the unit is selected
    const teamColor = TEAM[u.faction] || TEAM.THREAT;
    const accent = new THREE.MeshStandardMaterial({ color: teamColor, emissive: teamColor, emissiveIntensity: 1.2, roughness: 0.4 });
    accent.userData.keepColor = true;
    for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.012, 0.05, 0.05), accent, sx * 0.19, 0.17, 0.05, { parent: chest, cast: false });   // side tabs
    add(new THREE.BoxGeometry(0.04, 0.012, 0.012), accent, 0.12, 0.43, 0.02, { parent: chest, cast: false });                                 // shoulder
    for (const sh of [shinL, shinR]) add(new THREE.BoxGeometry(0.03, 0.03, 0.012), accent, 0, -0.39, -0.045, { parent: sh, cast: false });  // boot heels
    const halo = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40), new THREE.MeshBasicMaterial({ map: haloTex, color: teamColor, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = 0.015; halo.renderOrder = 3; g.add(halo);
    Object.assign(rig, { accent, halo });
    g.scale.setScalar(1.18);
    return { g, rig };
  }
  function pose(a, t) { // drive the rig from walk / crouch / breath / recoil / flinch / death
    const r = a.rig; if (!r) return;
    const w = a.walkAmt, ph = a.phase, cr = a.crouch;
    const sw = Math.sin(ph) * 0.7 * w;
    r.legL.rotation.x = -sw - cr * 1.15; r.legR.rotation.x = sw - cr * 1.15;
    r.shinL.rotation.x = Math.max(0, Math.sin(ph)) * 1.0 * w + cr * 2.0;
    r.shinR.rotation.x = Math.max(0, -Math.sin(ph)) * 1.0 * w + cr * 2.0;
    r.hips.position.y = 0.92 - cr * 0.4 + Math.abs(Math.cos(ph)) * 0.03 * w;
    const breathe = reducedMotion ? 0 : Math.sin(t * 1.7 + a.seed) * 0.012;
    r.spine.rotation.x = cr * 0.42 + w * 0.1 - a.flinch * 0.5 + breathe;
    r.chest.rotation.y = -0.25 * (1 - w * 0.5) + Math.sin(ph) * 0.08 * w;
    r.neck.rotation.y = 0.22 * (1 - w * 0.5); r.neck.rotation.x = -cr * 0.3;
    // arms: relaxed at the sides (as on the mannequins) and swinging when walking; raised to shoot
    const aim = a.aim, rest = 1 - aim, swing = Math.sin(ph) * 0.45 * w * rest;
    const holdDeck = r.role === 'T' && aim < 0.5;
    r.armR.rotation.set(0.02 - swing + aim * (r.role === 'T' || r.role === 'H' ? -1.45 : -1.15), 0, -0.1 * rest - 0.12 * aim);
    r.foreR.rotation.set(-0.12 * rest + aim * (r.role === 'T' || r.role === 'H' ? -0.1 : -0.85), 0, 0);
    r.armL.rotation.set(holdDeck ? -0.35 : 0.02 + swing + aim * -1.35, 0, holdDeck ? 0.05 : 0.1 * rest + 0.35 * aim);
    r.foreL.rotation.set(holdDeck ? -1.15 : -0.12 * rest - aim * 0.9, 0, 0);
    r.gun.visible = aim > 0.3; if (r.slung) r.slung.visible = !r.gun.visible;
    if (r.deck) r.deck.visible = !(r.role === 'T' && aim > 0.3);
    r.gun.rotation.x = -a.recoil * 0.25; r.gun.position.z = r.heldBase.z - a.recoil * 0.05;
  }
  return { operative, pose };
}
