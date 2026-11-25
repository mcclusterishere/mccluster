/* Procedural 3D presentation for the PRIM3 courtyard prototype.
 * This is deliberately separate from rules.js. No external models or services.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const loading = $('loading');
  function showFailure(message) {
    loading.hidden = false; loading.innerHTML = '';
    document.querySelectorAll('button,input').forEach(control => { control.disabled = true; });
    $('board').setAttribute('tabindex', '-1');
    $('feedback').textContent = '3D graphics are unavailable in this browser.';
    $('preview-label').textContent = 'SCENE UNAVAILABLE';
    $('origin-coordinates').textContent = '—'; $('target-coordinates').textContent = '—';
    $('route-detail').textContent = 'WebGL is required to play';
    const text = document.createElement('span'); text.textContent = message; loading.appendChild(text);
    const reload = document.createElement('button'); reload.type = 'button'; reload.textContent = 'Reload game';
    reload.addEventListener('click', () => window.location.reload()); loading.appendChild(reload);
  }
  if (!window.pc || !window.PRIM3Rules) { showFailure('The game could not load. Reload this page to try again.'); return; }
  const rules = window.PRIM3Rules;
  let app;
  try { app = new pc.Application($('board'), { graphicsDeviceOptions: { antialias: true, alpha: false, preferWebGl2: true } }); }
  catch (error) { console.error(error); showFailure('This browser could not start 3D graphics. Try a browser with WebGL enabled.'); return; }
  const scene = $('scene'), canvas = $('board');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let state = rules.createState(), selectedId = 'E', target = { x: 3, y: 3 }, route = [], legal = new Map();
  let animation = null, cameraMode = '3d', angle = .42, panel = 'move', elapsed = 0;
  const views = new Map(), tiles = [], axisLabels = [];
  app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
  app.setCanvasFillMode(pc.FILLMODE_NONE);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  app.autoRender = false;
  app.scene.ambientLight = new pc.Color(.52, .58, .59);
  app.scene.exposure = 1.1;
  const camera = new pc.Entity('Tactical camera');
  camera.addComponent('camera', { clearColor: new pc.Color(.16, .22, .23), projection: pc.PROJECTION_ORTHOGRAPHIC, nearClip: .1, farClip: 70, orthoHeight: 7 });
  app.root.addChild(camera);
  const sun = new pc.Entity('Warm courtyard light');
  sun.addComponent('light', { type: 'directional', color: new pc.Color(1, .91, .75), intensity: 1.3, castShadows: true, shadowDistance: 27, shadowResolution: 1024, shadowBias: .2, normalOffsetBias: .04 });
  sun.setEulerAngles(48, -25, 0); app.root.addChild(sun);
  const rim = new pc.Entity('Cool fill');
  rim.addComponent('light', { type: 'directional', color: new pc.Color(.61, .79, .88), intensity: .55, castShadows: false });
  rim.setEulerAngles(30, 145, 0); app.root.addChild(rim);
  function material(name, color, gloss = 8) {
    const m = new pc.StandardMaterial(); m.name = name; m.diffuse = new pc.Color(...color); m.metalness = 0; m.gloss = gloss; m.update(); return m;
  }
  const mat = {
    floor: material('Courtyard limestone', [.37, .43, .43]), floorAlt: material('Paver variation', [.40, .46, .45]),
    reach: material('Reachable paver', [.28, .49, .49]), target: material('Amber destination', [.76, .58, .30]),
    concrete: material('Weathered concrete', [.51, .55, .51]), edge: material('Concrete edge', [.68, .69, .61]),
    dark: material('Charcoal technical fabric', [.075, .095, .097]), armor: material('Graphite soft carrier', [.16, .19, .18]),
    black: material('Featureless matte black mannequin', [.018, .022, .024], 3), bone: material('Muted bone fabric', [.59, .60, .52]),
    olive: material('Grey field shell', [.26, .30, .27]), trim: material('Blank identification panel', [.62, .63, .54]),
    cyan: material('Cyan route marker', [.38, .78, .74]), amber: material('Amber route marker', [.95, .69, .32]),
    green: material('Planter foliage', [.22, .34, .23]), greenDark: material('Planter foliage shade', [.15, .25, .17]),
    dirt: material('Planter earth', [.12, .14, .11]), slab: material('Courtyard foundation', [.11, .16, .17]),
    window: material('Smoked architectural glass', [.12, .21, .23], 35), metal: material('Brushed hardware', [.29, .34, .32], 25),
    screen: material('Equipment display', [.22, .60, .56]), success: material('Connected relay light', [.43, .78, .55])
  };
  mat.screen.emissive = new pc.Color(.06, .18, .16); mat.screen.update();
  mat.cyan.emissive = new pc.Color(.04, .13, .12); mat.cyan.update();
  mat.amber.emissive = new pc.Color(.2, .11, .025); mat.amber.update();
  function part(name, x, y, z, sx, sy, sz, material, parent = app.root, type = 'box', shadow = true) {
    const entity = new pc.Entity(name);
    entity.addComponent('render', { type, material, castShadows: shadow, receiveShadows: true });
    entity.setLocalPosition(x, y, z); entity.setLocalScale(sx, sy, sz); parent.addChild(entity); return entity;
  }
  function group(name, parent = app.root) { const e = new pc.Entity(name); parent.addChild(e); return e; }
  part('Raised courtyard slab', 0, -.23, 0, 10.7, .42, 10.7, mat.slab);
  for (let y = 0; y < 10; y++) {
    tiles[y] = [];
    for (let x = 0; x < 10; x++) tiles[y][x] = part(`Paver ${x},${y}`, x - 4.5, -.035, y - 4.5, .966, .15, .966, (x + y * 3) % 5 === 0 ? mat.floorAlt : mat.floor, app.root, 'box', false);
  }
  // Low courtyard edges preserve a clear board silhouette at every camera angle.
  part('North curb', 0, .08, -5.15, 10.5, .24, .25, mat.concrete);
  part('West curb', -5.15, .08, 0, .25, .24, 10.5, mat.concrete);
  part('South slab edge', 0, -.03, 5.15, 10.5, .09, .14, mat.edge);
  part('East slab edge', 5.15, -.03, 0, .14, .09, 10.5, mat.edge);
  // City frontage: low, modular architecture, no large wall that hides the team.
  part('Courtyard facade', -.65, .58, -5.3, 8.7, 1.18, .36, mat.concrete);
  for (let i = 0; i < 4; i++) {
    const x = -3.9 + i * 2.15;
    part('Facade inset', x, .71, -5.08, 1.45, .61, .045, mat.window);
    part('Window divider', x, .71, -5.045, .04, .61, .035, mat.metal);
    part('Window sill', x, .37, -5.02, 1.56, .07, .12, mat.edge);
  }
  part('Facade coping', -.65, 1.21, -5.3, 8.8, .1, .46, mat.edge);
  for (const [x, y] of [[4, 2], [4, 3], [5, 4], [5, 5]]) {
    part(`Concrete cover ${x},${y}`, x - 4.5, .34, y - 4.5, .82, .68, .88, mat.concrete);
    part('Cover cap', x - 4.5, .7, y - 4.5, .87, .07, .93, mat.edge);
    part('Cover inset', x - 4.5, .31, y - 4.5 + .45, .58, .29, .02, mat.armor);
  }
  for (const [x, y] of [[8, 8], [8, 9], [9, 8]]) {
    part(`Planter ${x},${y}`, x - 4.5, .23, y - 4.5, .91, .46, .91, mat.concrete);
    part('Planter bed', x - 4.5, .48, y - 4.5, .78, .05, .78, mat.dirt);
    for (let i = 0; i < 3; i++) part('Low foliage', x - 4.7 + i * .2, .64 + (i % 2) * .1, y - 4.5 + (i % 2) * .16, .42, .39, .43, i % 2 ? mat.green : mat.greenDark, app.root, 'sphere');
  }
  // A small floor vent and drain are cosmetic; only the blocked grid cells affect paths.
  for (let i = 0; i < 5; i++) part('Courtyard drain', 4.77, .048, -3.25 + i * .2, .25, .012, .04, mat.slab, app.root, 'box', false);
  const relay = group('Relay objective'); relay.setPosition(2.5, 0, 1.5);
  part('Relay plinth', 0, .11, 0, .78, .22, .76, mat.concrete, relay);
  part('Relay cabinet', 0, .65, 0, .56, 1.05, .42, mat.armor, relay);
  part('Relay cap', 0, 1.2, 0, .66, .08, .5, mat.bone, relay);
  const relayScreen = part('Relay status screen', 0, .88, .23, .39, .32, .025, mat.screen, relay);
  for (let i = 0; i < 3; i++) part('Relay vent', 0, .35 + i * .075, .225, .33, .018, .025, mat.slab, relay);
  part('Objective ground marker', 0, .056, 0, .95, .025, .95, mat.amber, relay, 'cylinder', false);

  function makeOperative(unit) {
    const entity = group(unit.name); entity.setPosition(unit.x - 4.5, .085, unit.y - 4.5);
    const body = group('Articulated body', entity);
    const isE = unit.id === 'E', isR = unit.id === 'R', width = isE ? .48 : .39;
    const cloth = unit.id === 'T' ? mat.bone : isR ? mat.olive : mat.dark;
    part('Field torso', 0, .98, 0, .39, .53, .26, cloth, body);
    part('Low-profile vest', 0, 1.05, .035, width, isE ? .49 : .36, isE ? .32 : .285, mat.armor, body);
    part('Blank chest identification panel', 0, 1.16, .207, .17, .055, .016, mat.trim, body);
    for (const sign of [-1, 1]) part('Vest shoulder strap', sign * .15, 1.29, .025, .06, .055, .29, mat.armor, body);
    part('Collar', 0, 1.29, 0, .17, .13, .17, mat.dark, body, 'cylinder');
    part('Featureless black head', 0, 1.5, .015, .245, .33, .255, mat.black, body, 'sphere');
    // No facial geometry, hair, Prime helmet or brand marks.
    part('Low-profile earpiece', -.13, 1.48, -.02, .035, .085, .08, mat.armor, body);
    part('Waist belt', 0, .75, 0, .41, .09, .29, mat.dark, body);
    part('Left belt pouch', -.22, .74, .02, .12, .18, .17, mat.armor, body);
    const arms = [], legs = [], knees = [];
    [-1, 1].forEach(sign => {
      const arm = group(sign < 0 ? 'Left arm' : 'Right arm', body); arm.setLocalPosition(sign * (width / 2 + .055), 1.22, 0);
      part('Sleeve', 0, -.16, 0, .14, .31, .16, cloth, arm);
      if (isE) part('Shoulder protection', 0, -.035, -.01, .185, .15, .21, mat.armor, arm);
      part('Elbow', 0, -.34, .012, .135, .13, .14, mat.black, arm, 'sphere');
      part('Forearm', 0, -.47, .04, .115, .23, .14, unit.id === 'T' ? mat.black : cloth, arm);
      part('Black hand', 0, -.625, .06, .125, .15, .13, mat.black, arm, 'sphere');
      arms.push(arm);
      const thigh = group(sign < 0 ? 'Left leg' : 'Right leg', body); thigh.setLocalPosition(sign * .112, .72, 0);
      part('Trouser thigh', 0, -.18, 0, .165, .37, .19, mat.dark, thigh);
      const knee = group('Knee articulation', thigh); knee.setLocalPosition(0, -.36, 0);
      part('Lower leg', 0, -.15, 0, .145, .3, .17, mat.dark, knee);
      part('Field boot', 0, -.3, .055, .18, .15, .29, mat.armor, knee);
      if (isE) part('Low knee protection', 0, -.01, .105, .16, .17, .055, mat.armor, knee);
      legs.push(thigh); knees.push(knee);
    });
    if (isE) {
      part('Compact entry tool shaft', .265, .67, -.14, .055, .57, .055, mat.metal, body);
      part('Compact entry tool head', .265, .97, -.14, .2, .065, .075, mat.metal, body);
      part('Vest lower module', 0, .87, .215, .29, .1, .075, mat.dark, body);
    } else if (isR) {
      const optics = group('Handheld optics', body); optics.setLocalPosition(.19, 1.025, .24);
      for (const sign of [-1, 1]) { const barrel = part('Optic barrel', sign * .063, 0, .035, .08, .19, .08, mat.dark, optics, 'cylinder'); barrel.setLocalEulerAngles(90, 0, 0); }
      part('Optics bridge', 0, 0, 0, .19, .06, .08, mat.armor, optics);
      part('Sensor pouch', -.23, .82, -.075, .11, .22, .16, mat.armor, body);
      part('Short sensor antenna', -.24, 1.02, -.08, .022, .19, .022, mat.metal, body);
    } else {
      const deck = group('Cyberdeck', body); deck.setLocalPosition(-.27, .89, .29); deck.setLocalEulerAngles(25, 0, 0);
      part('Cyberdeck shell', 0, 0, 0, .3, .35, .06, mat.armor, deck);
      part('Cyberdeck display', 0, .025, .035, .245, .235, .014, mat.screen, deck);
      for (let i = 0; i < 3; i++) part('Deck port', -.155, -.08 + i * .045, 0, .015, .021, .024, mat.metal, deck);
      part('Wrist interface', 0, -.46, .13, .14, .16, .05, mat.screen, arms[1]);
    }
    const label = document.querySelector(`[data-unit="${unit.id}"]`);
    return { entity, body, arms, legs, knees, label };
  }
  state.units.forEach(unit => views.set(unit.id, makeOperative(unit)));
  const selection = group('Selected tile corners');
  for (const [x, z] of [[-.43, -.43], [.43, -.43], [-.43, .43], [.43, .43]]) {
    part('Selection corner horizontal', x - Math.sign(x) * .08, .065, z, .23, .025, .035, mat.cyan, selection, 'box', false);
    part('Selection corner vertical', x, .065, z - Math.sign(z) * .08, .035, .025, .23, mat.cyan, selection, 'box', false);
  }
  const pathRoot = group('Movement preview route');
  const labels = $('labels');
  for (const axis of ['x', 'y']) for (let i = 0; i < 10; i++) {
    const label = document.createElement('span'); label.className = 'axis-label'; label.textContent = String(i);
    Object.assign(label.style, { position: 'absolute', color: '#c0ccc5', fontSize: '8px', fontFamily: 'ui-monospace,monospace', transform: 'translate(-50%,-50%)', textShadow: '0 1px 3px #1d2a2b' });
    labels.appendChild(label); axisLabels.push({ axis, i, label });
  }
  function selected() { return state.units.find(u => u.id === selectedId); }
  function setFeedback(message) { $('feedback').textContent = message; }
  function coords(point) { return `(${point.x}, ${point.y})`; }
  function renderRoute() {
    while (pathRoot.children.length) pathRoot.children[0].destroy();
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      part('Amber route segment', (a.x + b.x) / 2 - 4.5, .075, (a.y + b.y) / 2 - 4.5, a.x === b.x ? .055 : 1.055, .027, a.y === b.y ? .055 : 1.055, mat.amber, pathRoot, 'box', false);
    }
  }
  function refresh() {
    const unit = selected(); legal = rules.reachable(state, unit.id);
    if (animation) {
      route = animation.path;
      const endpoint = route[route.length - 1]; target = { x: endpoint.x, y: endpoint.y };
    } else {
      route = target ? (legal.get(rules.key(target.x, target.y)) || []) : [];
      if (route.length < 2) { target = null; route = []; }
    }
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      let tileMat = (x + y * 3) % 5 === 0 ? mat.floorAlt : mat.floor;
      if (legal.has(rules.key(x, y)) && !state.blocked.has(rules.key(x, y))) tileMat = mat.reach;
      if (target && x === target.x && y === target.y) tileMat = mat.target;
      tiles[y][x].render.material = tileMat;
    }
    renderRoute();
    state.units.forEach(u => {
      const view = views.get(u.id), isSelected = u.id === selectedId;
      view.label.setAttribute('aria-pressed', String(isSelected));
      view.label.setAttribute('aria-label', `Select ${u.name}, ${u.role}, ${u.ap} AP at ${coords(u)}`);
      document.querySelector(`[data-select="${u.id}"]`).setAttribute('aria-pressed', String(isSelected));
      document.querySelector(`[data-ap="${u.id}"]`).textContent = u.ap === 2 ? '●●' : u.ap === 1 ? '●○' : '○○';
    });
    $('role-monogram').textContent = unit.id; $('selected-role').textContent = `FIELD ${unit.id} / ${unit.role.toUpperCase()}`;
    $('selected-name').textContent = unit.name; $('selected-country').textContent = `${unit.code} · ${unit.country}`;
    $('selected-ap').textContent = String(unit.ap); $('turn-number').textContent = String(state.turn).padStart(2, '0');
    $('turn-summary').textContent = `${state.units.reduce((sum, u) => sum + u.ap, 0)} squad AP available`;
    $('origin-coordinates').textContent = coords(unit); $('target-coordinates').textContent = target ? coords(target) : '—';
    $('route-detail').textContent = target ? `${route.length - 1} grid steps · clear route` : `${unit.range} tiles per move`;
    $('preview-label').textContent = animation ? 'MOVING TO DESTINATION' : target ? 'MOVEMENT PREVIEW' : 'CHOOSE A DESTINATION';
    $('move-cost').textContent = '1 AP';
    $('confirm-move').disabled = !!animation || !target || unit.ap < 1;
    $('end-turn').disabled = !!animation; $('reset').disabled = !!animation;
    $('action-move').disabled = !!animation; $('action-inspect').disabled = !!animation; $('action-hint').disabled = !!animation;
    $('connect-relay').hidden = !rules.canConnect(state, unit.id);
    $('destination-label').hidden = !target || !!animation;
    if (target) $('destination-label').textContent = coords(target);
    $('inspect-title').textContent = `${unit.role} operator`; $('inspect-description').textContent = unit.kit;
    $('inspect-range').textContent = `${unit.range} tiles / 1 AP`; $('inspect-position').textContent = coords(unit);
    const p = views.get(selectedId).entity.getPosition(); selection.setPosition(p.x, 0, p.z);
    updateHintQuestion(); placeLabels(); app.renderNextFrame = true;
  }
  function updateHintQuestion() {
    $('hint-question').textContent = target ? `Ignoring cover, what is the minimum distance from ${coords(selected())} to ${coords(target)} along rows and columns?` : 'Choose a cyan destination tile to practice its coordinates.';
    $('hint-answer').disabled = !target || !!animation; $('hint-form').querySelector('button').disabled = !target || !!animation;
  }
  function clearHintAnswer() { $('hint-answer').value = ''; $('hint-feedback').textContent = 'Practice is optional. You can move at any time.'; $('hint-feedback').classList.remove('correct'); }
  function preview(x, y) {
    if (animation) return false;
    const path = legal.get(rules.key(x, y));
    if (!path || path.length < 2) {
      if (state.blocked.has(rules.key(x, y))) setFeedback('That tile contains cover or the relay. Choose a cyan tile.');
      else if (!selected().ap) setFeedback('No AP left for this operative. Choose a teammate or end the turn.');
      else setFeedback('That destination is occupied or outside this move’s range.');
      return false;
    }
    target = { x, y }; clearHintAnswer(); setFeedback('Route ready. Confirm when you want to move.'); refresh(); return true;
  }
  function selectUnit(id) {
    if (animation || !views.has(id)) return false;
    selectedId = id; target = null; clearHintAnswer();
    setFeedback(rules.canConnect(state, id) ? 'Aya is in range. Connect the relay to complete the exercise.' : selected().ap ? 'Choose a cyan tile to plan a move.' : 'No AP left. Select a teammate or end the turn.');
    refresh(); return true;
  }
  function setPanel(mode) {
    panel = panel === mode && mode !== 'move' ? 'move' : mode;
    $('hint-card').hidden = panel !== 'hint'; $('inspect-card').hidden = panel !== 'inspect';
    for (const action of ['move', 'inspect', 'hint']) $(`action-${action}`).setAttribute('aria-pressed', String(panel === action));
  }
  function pose(view, time) {
    const phase = Math.sin(time * 13), other = -phase;
    view.legs[0].setLocalEulerAngles(phase * 32, 0, 0); view.legs[1].setLocalEulerAngles(other * 32, 0, 0);
    view.knees[0].setLocalEulerAngles(Math.max(0, -phase) * 36, 0, 0); view.knees[1].setLocalEulerAngles(Math.max(0, phase) * 36, 0, 0);
    view.arms[0].setLocalEulerAngles(-phase * 26 - 9, 0, -3); view.arms[1].setLocalEulerAngles(phase * 26 - 9, 0, 3);
    view.body.setLocalPosition(0, Math.abs(phase) * .035, 0);
  }
  function rest(view) { for (const limb of [...view.arms, ...view.legs, ...view.knees]) limb.setLocalEulerAngles(0, 0, 0); view.body.setLocalPosition(0, 0, 0); }
  function finishAnimation() {
    const view = views.get(animation.id); rules.finishMove(state); const unit = state.units.find(u => u.id === animation.id);
    view.entity.setPosition(unit.x - 4.5, .085, unit.y - 4.5); rest(view); animation = null; target = null; clearHintAnswer();
    setFeedback(rules.canConnect(state, selectedId) ? 'Aya is in range. Connect the relay to complete the exercise.' : `${unit.short} reached ${coords(unit)}. ${unit.ap} AP remaining.`);
    refresh();
  }
  function confirmMove() {
    if (animation || !target) return false;
    const path = rules.beginMove(state, selectedId, target.x, target.y); if (!path) return false;
    animation = { id: selectedId, path, index: 1, stepTime: 0, time: 0 };
    setFeedback(`${selected().short} moving · ${path.length - 1} steps`); refresh();
    if (reducedMotion) finishAnimation(); return true;
  }
  function endTurn() {
    if (!rules.endTurn(state)) return false;
    target = null; clearHintAnswer(); refresh(); setFeedback('New turn. Each operative has 2 AP.'); return true;
  }
  function connectRelay() {
    if (!rules.connect(state, selectedId)) return false;
    relayScreen.render.material = mat.success;
    $('mission-title').textContent = 'Relay linked'; $('mission-detail').textContent = 'Exercise complete. Your team established the connection.';
    $('relay-label').innerHTML = '◇ <span>LINKED</span>';
    target = null; clearHintAnswer(); refresh(); setFeedback('Connection established. Restart to run the exercise again.'); return true;
  }
  function reset() {
    if (animation) return false;
    state = rules.createState(); selectedId = 'E'; target = { x: 3, y: 3 }; angle = .42; cameraMode = '3d'; panel = 'move';
    state.units.forEach(u => { const view = views.get(u.id); view.entity.setPosition(u.x - 4.5, .085, u.y - 4.5); view.entity.setEulerAngles(0, 0, 0); rest(view); });
    relayScreen.render.material = mat.screen; $('mission-title').textContent = 'Establish the link'; $('mission-detail').innerHTML = 'Move Aya beside the relay at <b>(7, 6)</b>.';
    $('relay-label').innerHTML = '◇ <span>RELAY</span>'; clearHintAnswer(); setPanel('move'); setView('3d'); refresh(); setFeedback('Choose a cyan tile to plan a move.'); return true;
  }
  function project(position) { const p = camera.camera.worldToScreen(position); return { x: p.x, y: p.y, z: p.z }; }
  function placeLabels() {
    const w = scene.clientWidth, h = scene.clientHeight;
    if (!w || !h) return;
    const anchors = state.units.map(u => { const p = views.get(u.id).entity.getPosition(); return { id: u.id, ...project(new pc.Vec3(p.x, 1.86, p.z)) }; });
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) {
      const a = anchors[i], b = anchors[j]; if (Math.abs(a.x - b.x) < 42 && Math.abs(a.y - b.y) < 44) { const d = (44 - Math.abs(a.y - b.y)) / 2 + 1; if (a.y <= b.y) { a.y -= d; b.y += d; } else { a.y += d; b.y -= d; } }
    }
    for (const anchor of anchors) { const label = views.get(anchor.id).label; label.style.left = `${Math.max(24, Math.min(w - 24, anchor.x))}px`; label.style.top = `${Math.max(46, Math.min(h - 35, anchor.y))}px`; }
    if (target) { const p = project(new pc.Vec3(target.x - 4.5, .2, target.y - 4.5)); $('destination-label').style.left = `${p.x}px`; $('destination-label').style.top = `${p.y}px`; }
    const relayPoint = project(new pc.Vec3(2.5, 1.46, 1.5)); $('relay-label').style.left = `${relayPoint.x}px`; $('relay-label').style.top = `${relayPoint.y}px`;
    for (const item of axisLabels) { const p = project(new pc.Vec3(item.axis === 'x' ? item.i - 4.5 : -5.38, .03, item.axis === 'y' ? item.i - 4.5 : 5.38)); item.label.style.left = `${p.x}px`; item.label.style.top = `${p.y}px`; }
  }
  function updateCamera() {
    const aspect = scene.clientWidth / scene.clientHeight;
    if (cameraMode === 'overhead') { camera.setPosition(0, 18, .001); camera.setEulerAngles(-90, 0, 0); camera.camera.orthoHeight = Math.max(6.2, 5.95 / aspect); }
    else { const span = Math.abs(Math.sin(angle)) + Math.abs(Math.cos(angle)); camera.setPosition(Math.sin(angle) * 16, 17, Math.cos(angle) * 16); camera.lookAt(0, .3, 0); camera.camera.orthoHeight = Math.max(span * 4.15 + 1.1, (span * 5.45 + .35) / aspect); }
    placeLabels(); app.renderNextFrame = true;
  }
  function setView(mode) { cameraMode = mode; document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === mode))); $('scene-help').textContent = mode === '3d' ? 'TAP AN OPERATIVE · DRAG TO ROTATE' : 'TAP AN OPERATIVE · SAME COORDINATES'; updateCamera(); }
  function resize() { const width = scene.clientWidth, height = scene.clientHeight; if (width && height) { app.resizeCanvas(width, height); updateCamera(); } }
  function pick(event) {
    if (animation) return;
    const rect = canvas.getBoundingClientRect(), sx = event.clientX - rect.left, sy = event.clientY - rect.top;
    let nearest = null, distance = 22;
    for (const u of state.units) { const p = views.get(u.id).entity.getPosition(), q = project(new pc.Vec3(p.x, .9, p.z)), d = Math.hypot(sx - q.x, sy - q.y); if (d < distance) { nearest = u; distance = d; } }
    if (nearest) { selectUnit(nearest.id); return; }
    const start = camera.camera.screenToWorld(sx, sy, camera.camera.nearClip), end = camera.camera.screenToWorld(sx, sy, camera.camera.farClip), direction = end.clone().sub(start);
    if (Math.abs(direction.y) < .00001) return;
    const t = (.04 - start.y) / direction.y, x = Math.floor(start.x + direction.x * t + 5), y = Math.floor(start.z + direction.z * t + 5);
    if (x >= 0 && x < 10 && y >= 0 && y < 10) preview(x, y);
  }
  let pointer = null;
  canvas.addEventListener('pointerdown', event => { pointer = { x: event.clientX, y: event.clientY, angle, id: event.pointerId, dragged: false }; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', event => { if (!pointer || event.pointerId !== pointer.id) return; const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y; if (Math.hypot(dx, dy) > 8) pointer.dragged = true; if (pointer.dragged && cameraMode === '3d') { angle = pointer.angle - dx * .007; updateCamera(); } });
  canvas.addEventListener('pointerup', event => { if (pointer && !pointer.dragged) pick(event); pointer = null; });
  canvas.addEventListener('pointercancel', () => { pointer = null; });
  canvas.addEventListener('keydown', event => {
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }, direction = directions[event.key];
    if (direction) { event.preventDefault(); const point = target || selected(); preview(point.x + direction[0], point.y + direction[1]); }
    if (event.key === 'Enter') { event.preventDefault(); confirmMove(); }
  });
  document.querySelectorAll('[data-unit]').forEach(button => button.addEventListener('click', () => selectUnit(button.dataset.unit)));
  document.querySelectorAll('[data-select]').forEach(button => button.addEventListener('click', () => selectUnit(button.dataset.select)));
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  for (const mode of ['move', 'inspect', 'hint']) $(`action-${mode}`).addEventListener('click', () => setPanel(mode));
  $('hint-close').addEventListener('click', () => setPanel('move'));
  $('confirm-move').addEventListener('click', confirmMove); $('end-turn').addEventListener('click', endTurn); $('connect-relay').addEventListener('click', connectRelay); $('reset').addEventListener('click', reset);
  $('camera-home').addEventListener('click', () => { angle = .42; setView('3d'); });
  $('how-to').addEventListener('click', () => { const opening = $('controls-note').hidden; $('controls-note').hidden = !opening; $('how-to').setAttribute('aria-expanded', String(opening)); });
  $('hint-form').addEventListener('submit', event => {
    event.preventDefault(); if (!target || route.length < 2) return;
    const answer = $('hint-answer').value.trim(), output = $('hint-feedback'); output.classList.remove('correct');
    if (answer === '') { output.textContent = 'Enter the number of grid steps to check your answer.'; return; }
    const unit = selected(), horizontal = Math.abs(target.x - unit.x), vertical = Math.abs(target.y - unit.y), distance = horizontal + vertical;
    if (Number(answer) === distance) {
      output.textContent = `Correct. x: |${target.x} − ${unit.x}| = ${horizontal}; y: |${target.y} − ${unit.y}| = ${vertical}. Add them: ${horizontal} + ${vertical} = ${distance}. ` + (route.length - 1 > distance ? `Cover makes the highlighted route longer: ${route.length - 1} steps.` : `The highlighted route also takes ${distance} steps.`);
      output.classList.add('correct');
    } else output.textContent = `Compare x first: ${unit.x} to ${target.x} is ${horizontal} steps. Then y: ${unit.y} to ${target.y} is ${vertical} steps. Add those two changes. This question ignores cover; the amber route takes ${route.length - 1} steps.`;
  });
  app.on('update', dt => {
    if (!animation) return;
    dt = Math.min(dt, .05); elapsed += dt; animation.time += dt; animation.stepTime += dt;
    const a = animation.path[animation.index - 1], b = animation.path[animation.index], view = views.get(animation.id), fraction = Math.min(animation.stepTime / .29, 1);
    view.entity.setPosition(a.x - 4.5 + (b.x - a.x) * fraction, .085, a.y - 4.5 + (b.y - a.y) * fraction);
    view.entity.setEulerAngles(0, Math.atan2(b.x - a.x, b.y - a.y) * 180 / Math.PI, 0); pose(view, animation.time);
    const p = view.entity.getPosition(); selection.setPosition(p.x, 0, p.z); placeLabels(); app.renderNextFrame = true;
    if (fraction === 1) { animation.index++; animation.stepTime = 0; if (animation.index >= animation.path.length) finishAnimation(); }
  });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); showFailure('3D graphics paused. Reload the page to continue.'); });
  // Small inspection API for integration and reproducible QA; no privileged operations.
  window.__PRIM3 = {
    snapshot: () => ({ selected: selectedId, target: target && { ...target }, route: route.map(p => ({ ...p })), turn: state.turn, complete: state.complete, moving: !!animation, cameraMode, units: state.units.map(({ id, x, y, ap }) => ({ id, x, y, ap })), legal: [...legal.keys()] }),
    preview, selectUnit, confirmMove, endTurn, connectRelay, reset, setView,
    projectTile: (x, y) => project(new pc.Vec3(x - 4.5, .04, y - 4.5)),
    projectUnit: id => { const p = views.get(id).entity.getPosition(); return project(new pc.Vec3(p.x, .9, p.z)); }
  };
  new ResizeObserver(resize).observe(scene); app.start(); resize(); refresh(); loading.hidden = true;
})();
