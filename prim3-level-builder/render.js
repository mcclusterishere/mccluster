/* PRIM3 transit renderer. PlayCanvas WebGL plus a complete projected Canvas2D
 * renderer; both use the same world, articulated figures, picking and events.
 * No external models, textures, network requests or privileged browser flags.
 */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2, RAD = 180 / Math.PI;
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const mix = (a, b, t) => a + (b - a) * t;
  const colorCache = new Map();
  function rgb(hex) {
    if (colorCache.has(hex)) return colorCache.get(hex);
    let s = String(hex || '#71817d').replace('#', ''); if (s.length === 3) s = s.split('').map(c => c + c).join('');
    const value = [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
    colorCache.set(hex, value); return value;
  }
  function shade(hex, value, alpha = 1) {
    const c = rgb(hex).map(n => Math.round(clamp(n * value, 0, 255)));
    return alpha < 1 ? `rgba(${c.join(',')},${alpha})` : `rgb(${c.join(',')})`;
  }
  function rotated(p, r = [0, 0, 0]) {
    let [x, y, z] = p;
    if (r[0]) { const c = Math.cos(r[0]), s = Math.sin(r[0]), a = y * c - z * s; z = y * s + z * c; y = a; }
    if (r[1]) { const c = Math.cos(r[1]), s = Math.sin(r[1]), a = x * c + z * s; z = -x * s + z * c; x = a; }
    if (r[2]) { const c = Math.cos(r[2]), s = Math.sin(r[2]), a = x * c - y * s; y = x * s + y * c; x = a; }
    return [x, y, z];
  }
  function polygon(ctx, points) { ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); }
  function insideRect(x, z, r) { return x >= r.x && x < r.x + r.w && z >= r.y && z < r.y + r.d; }
  const FACE_DEFS = [
    { i: [0, 3, 2, 1], n: [0, 0, -1] }, { i: [4, 5, 6, 7], n: [0, 0, 1] },
    { i: [0, 4, 7, 3], n: [-1, 0, 0] }, { i: [1, 2, 6, 5], n: [1, 0, 0] },
    { i: [3, 7, 6, 2], n: [0, 1, 0] }
  ];
  class P3Renderer {
    constructor(canvas, level, options = {}) {
      this.canvas = canvas; this.level = level; this.onPick = options.onPick || (() => {});
      this.editor = !!options.editor;
      this.mode = 'canvas2d'; this.view = '3d'; this.w = 1; this.h = 1; this.dpr = 1;
      this.camera = { x: -20, z: -32, h: 1, yaw: 2.4, pitch: .91, span: 30 };
      this.state = { units: [], gateOpen: false }; this.overlay = { reachable: [], path: [] };
      this.positions = new Map(); this.killed = new Set(); this.effects = []; this.tweens = new Set();
      this._firstState = true; this._disposed = false; this._lastFrame = 0; this._time = 0;
      this._reduced = !!root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      this._parts = []; this._glUnits = new Map(); this._materials = new Map(); this._gateParts = [];
      this._createWorld(); this._initGraphics(); this._bindControls();
      this._resizeObserver = new ResizeObserver(() => this.resize()); this._resizeObserver.observe(this.canvas.parentElement || this.canvas);
      this.resize(); this._frame = this._frame.bind(this); this._raf = requestAnimationFrame(this._frame);
    }
    _part(id, x, h, z, w, height, d, color, extra = {}) {
      const p = { id, x, y: h, z, w, h: height, d, color, r: [0, 0, 0], shape: 'box', ...extra };
      this._parts.push(p); return p;
    }
    _beam(id, a, b, width, color, extra = {}) {
      const dx = b.x - a.x, dy = b.h - a.h, dz = b.z - a.z, length = Math.hypot(dx, dy, dz);
      return this._part(id, (a.x + b.x) / 2, (a.h + b.h) / 2, (a.z + b.z) / 2, width, width, length, color, { r: [-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0], ...extra });
    }
    _createWorld() {
      const L = this.level;
      if (Array.isArray(L.worldParts)) {
        const b=L.bounds,w=b.maxX-b.minX+1,d=b.maxY-b.minY+1;
        this._part('forge-foundation',b.minX+w/2,-.2,b.minY+d/2,w,.35,d,'#e4e9e5',{ground:true});
        for(const p of L.worldParts)this._parts.push({...p,r:p.r||[0,0,0],shape:p.shape||'box'});
        this._staticGeometry=this._parts.map(p=>({p,faces:this._boxFaces(p)}));
        return;
      }
      this._part('compound-foundation', 0, -.24, 0, 128, .4, 128, '#737f79', { ground: true });
      // Broad architectural surfaces, not thousands of ground-tile meshes.
      this._part('service-road', 0, -.025, -3, 14, .035, 116, '#697674', { ground: true });
      this._part('cross-road', -1, -.022, -36, 112, .04, 10, '#707b75', { ground: true });
      for (const b of L.buildings || []) {
        const cx = b.x + b.w / 2, cz = b.y + b.d / 2, wall = b.h >= 12 ? '#7c8c8b' : '#a4aaa0';
        this._part(`${b.id}-mass`, cx, b.h / 2, cz, b.w, b.h, b.d, wall, { building: b.id });
        this._part(`${b.id}-roof`, cx, b.h - .055, cz, b.w + .14, .11, b.d + .14, '#727f7c', { building: b.id });
        for (const zz of [b.y + .12, b.y + b.d - .12]) this._part(`${b.id}-parapet-z-${zz}`, cx, b.h + .27, zz, b.w, .4, .2, '#b3b6a6');
        for (const xx of [b.x + .12, b.x + b.w - .12]) this._part(`${b.id}-parapet-x-${xx}`, xx, b.h + .27, cz, .2, .4, b.d, '#b3b6a6');
        const floors = Math.max(1, Math.floor(b.h / 4));
        for (let f = 0; f < floors; f++) {
          const height = 2 + f * 3.8;
          for (let j = 2; j < b.w - 1; j += 3.7) for (const side of [-1, 1]) {
            const z = side < 0 ? b.y - .035 : b.y + b.d + .035;
            this._part(`${b.id}-window-${f}-${j}-${side}`, b.x + j, height, z, 2.05, 1.35, .045, (Math.floor(j) + f) % 4 ? '#304c55' : '#a59566', { window: true });
            this._part(`${b.id}-sill-${f}-${j}-${side}`, b.x + j, height - .72, z, 2.25, .12, .18, '#b3b6a6');
          }
          for (let j = 2; j < b.d - 1; j += 4) for (const side of [-1, 1]) {
            const x = side < 0 ? b.x - .035 : b.x + b.w + .035;
            this._part(`${b.id}-side-window-${f}-${j}-${side}`, x, height, b.y + j, .045, 1.35, 2.2, '#35515a', { window: true });
          }
        }
        this._part(`${b.id}-door`, cx, 1.45, b.y - .07, 2.1, 2.9, .12, '#2b4248');
        this._part(`${b.id}-door-line`, cx, 1.45, b.y - .145, .045, 2.6, .02, '#657d7d');
        this._part(`${b.id}-utility-light`, cx, 3.15, b.y - .14, 1.65, .16, .15, '#e5bb70', { emissive: true });
        // Flush roof ventilation details preserve the world's navigable roof cells.
        for (let v = 0; v < 3; v++) {
          const vx = b.x + 2.2 + v * 2.5, vz = b.y + b.d - 3;
          this._part(`${b.id}-hvac-plate-${v}`, vx, b.h + .025, vz, 1.8, .035, 2, '#526766');
          for (let slat = 0; slat < 5; slat++) this._part(`${b.id}-vent-${v}-${slat}`, vx - .65 + slat * .32, b.h + .05, vz, .11, .025, 1.65, '#a3ada1');
        }
      }
      for (const b of L.boxes || []) {
        const h = (b.z || 0), cx = b.x + b.w / 2, cz = b.y + b.d / 2;
        if (b.type === 'fence') {
          this._part(`${b.id}-low`, cx, h + .36, cz, b.w, .65, b.d, '#586c6d');
          for (let x = b.x + .2; x < b.x + b.w; x += 1.35) this._part(`${b.id}-post-${x}`, x, h + b.h / 2, cz, .1, b.h, .13, '#738985');
          for (const y of [1.05, b.h]) this._part(`${b.id}-rail-${y}`, cx, h + y, cz, b.w, .08, .1, '#8b9a8d');
        } else {
          const color = b.color || (b.type === 'cover' ? '#b0b2a4' : '#687b72');
          this._part(b.id, cx, h + b.h / 2, cz, b.w, b.h, b.d, color);
          if (b.type === 'cover') {
            this._part(`${b.id}-cap`, cx, h + b.h + .05, cz, b.w + .12, .1, b.d + .12, '#c5c5b2');
            for (let x = b.x + .6; x < b.x + b.w; x += 1.1) this._part(`${b.id}-reflector-${x}`, x, h + .86, b.y - .02, .34, .16, .04, '#d8af6a');
          } else if (b.type === 'container') {
            for (let x = b.x + .3; x < b.x + b.w; x += .6) for (const z of [b.y - .02, b.y + b.d + .02]) this._part(`${b.id}-rib-${x}-${z}`, x, h + b.h / 2, z, .06, b.h - .12, .07, shade(color, .82));
            this._part(`${b.id}-top`, cx, h + b.h + .04, cz, b.w, .08, b.d, color);
          } else {
            this._part(`${b.id}-strap-a`, cx - b.w * .27, h + b.h + .025, cz, .13, .035, b.d, '#b8b9a0');
            this._part(`${b.id}-strap-b`, cx + b.w * .27, h + b.h + .025, cz, .13, .035, b.d, '#b8b9a0');
          }
        }
      }
      if (L.canal) {
        const c = L.canal;
        this._part('canal-water', c.x + c.w / 2, .008, c.y + c.d / 2, c.w, .035, c.d, '#28565c', { water: true, ground: true });
        for (const z of [c.y, c.y + c.d]) this._part(`canal-bank-${z}`, c.x + c.w / 2, .06, z, c.w, .12, .23, '#b1b3a1');
      }
      for (const [i, b] of (L.groundBridges || []).entries()) {
        const x = b.x + b.w / 2, z = b.y + b.d / 2;
        this._part(`canal-bridge-${i}`, x, .025, z, b.w, .08, b.d, '#9caa9a');
        for (const xx of [b.x + .15, b.x + b.w - .15]) {
          this._part(`bridge-rail-${i}-${xx}`, xx, 1.03, z, .12, .12, b.d, '#899b95');
          for (let zz = b.y + .3; zz < b.y + b.d; zz += 1.8) this._part(`bridge-post-${i}-${xx}-${zz}`, xx, .58, zz, .1, .94, .1, '#768b86');
        }
      }
      for (const b of L.bridges || []) {
        this._part(`${b.id}-deck`, b.x + b.w / 2, b.h - .25, b.y + b.d / 2, b.w, .5, b.d, '#81928e');
        for (const z of [b.y + .12, b.y + b.d - .12]) {
          this._part(`${b.id}-rail-${z}`, b.x + b.w / 2, b.h + .93, z, b.w, .11, .12, '#b8c0b0');
          for (let x = b.x + .5; x < b.x + b.w; x += 2) this._part(`${b.id}-post-${x}-${z}`, x, b.h + .46, z, .1, .92, .1, '#829b96');
        }
        for (let x = b.x + 5; x < b.x + b.w - 2; x += 10) this._part(`${b.id}-support-${x}`, x, b.h / 2, b.y + b.d / 2, .6, b.h, .65, '#667f7d');
      }
      for (const s of L.stairs || []) {
        const dx = s.to.x - s.from.x, dz = s.to.y - s.from.y, length = Math.hypot(dx, dz), height = this._height(s.to), n = Math.max(10, Math.ceil(length * 1.7));
        for (let i = 0; i < n; i++) {
          const t = (i + .5) / n, rise = height * (i + 1) / n;
          this._part(`${s.id}-step-${i}`, s.from.x + .5 + dx * t, rise / 2, s.from.y + .5 + dz * t, s.width, rise, length / n + .045, i % 2 ? '#9ca99b' : '#a9b3a4', { r: [0, Math.atan2(dx, dz), 0] });
        }
        const nx = dz / length * s.width / 2, nz = -dx / length * s.width / 2;
        for (const sign of [-1, 1]) this._beam(`${s.id}-handrail-${sign}`, { x: s.from.x + .5 + nx * sign, z: s.from.y + .5 + nz * sign, h: 1 }, { x: s.to.x + .5 + nx * sign, z: s.to.y + .5 + nz * sign, h: height + 1 }, .12, '#b2c0af');
      }
      const r = L.relay || { x: 0, y: 0 }, rx = r.x + .5, rz = r.y + .5;
      this._part('relay-plinth', rx, .13, rz, 1.05, .26, 1.05, '#b6b8a6');
      this._part('relay-cabinet', rx, 1.02, rz, .7, 1.7, .6, '#243f46');
      this._part('relay-cap', rx, 1.91, rz, .85, .13, .74, '#91aaa0');
      this._part('relay-display', rx, 1.34, rz + .32, .48, .55, .025, '#66bfb3', { emissive: true });
      this._part('relay-antenna', rx + .2, 2.4, rz - .15, .045, 1, .045, '#b9c4ad');
      if (L.medkit) {
        const m = L.medkit; this._part('medical-case', m.x + .5, .27, m.y + .5, .68, .5, .51, '#c6c6af');
        this._part('medical-stripe', m.x + .5, .53, m.y + .5, .12, .025, .4, '#a6614f');
        this._part('medical-stripe-cross', m.x + .5, .545, m.y + .5, .4, .025, .12, '#a6614f');
      }
      if (L.gate) {
        const g = L.gate, p = this._part('service-gate', g.x + .5, g.h / 2, g.y + .5, g.w, g.h, .2, '#ba9862', { gate: true }); this._gateParts.push(p);
        for (const x of [g.x - 1.15, g.x + 2.15]) this._part(`gate-pillar-${x}`, x, g.h / 2 + .12, g.y + .5, .25, g.h + .24, .5, '#9fae9f');
      }
      // Painted lane marks and loading-bay details sit flush with navigable ground.
      for (let y = -55; y <= 55; y += 5) if (!(y >= -29 && y < -20)) this._part(`road-mark-${y}`, -1, .032, y, .11, .015, 1.8, '#bcbb9f', { ground: true });
      this._staticGeometry = this._parts.map(p => ({ p, faces: this._boxFaces(p) }));
    }
    _height(node) { try { return Number(this.level.heightAt(node)) || 0; } catch (_) { return 0; } }
    _batchStaticWorld() {
      if(!this.app?.batcher)return;
      if(this._staticBatch)this.app.batcher.removeGroup(this._staticBatch.id);
      this._staticBatch=this.app.batcher.addGroup('PRIM3 white industrial kit',false,32);
      for(const p of this._parts)if(p.entity?.render)p.entity.render.batchGroupId=this._staticBatch.id;
      this.app.batcher.generate([this._staticBatch.id]);
    }
    setLevel(level) {
      if(this._staticBatch&&this.app?.batcher){this.app.batcher.removeGroup(this._staticBatch.id);this._staticBatch=null;}
      for(const p of this._parts)p.entity?.destroy();
      this.level=level;this._parts=[];this._gateParts=[];this.effects=[];this.overlay={reachable:[],path:[]};
      this._createWorld();
      if(this.mode==='webgl'){for(const p of this._parts)p.entity=this._newPcPart(p);if(level.worldParts)this._batchStaticWorld();}
      this._dirty=true;
    }
    _initGraphics() {
      if (root.pc) {
        try {
          this.app = new pc.Application(this.canvas, { graphicsDeviceOptions: { antialias: true, alpha: false, preferWebGl2: true } });
          this.app.graphicsDevice.maxPixelRatio = Math.min(root.devicePixelRatio || 1, this.canvas.getBoundingClientRect().width < 600 ? 1.5 : 1.75);
          this.app.setCanvasFillMode(pc.FILLMODE_NONE); this.app.setCanvasResolution(pc.RESOLUTION_AUTO); this.app.autoRender = false;
          this.app.scene.ambientLight = new pc.Color(.58, .65, .65);
          this.pcCamera = new pc.Entity('Transit tactical camera'); this.pcCamera.addComponent('camera', { projection: pc.PROJECTION_ORTHOGRAPHIC, clearColor: new pc.Color(.09, .15, .17), nearClip: .1, farClip: 350 }); this.app.root.addChild(this.pcCamera);
          const light = new pc.Entity('Courtyard daylight'); light.addComponent('light', { type: 'directional', color: new pc.Color(1, .91, .74), intensity: 1.2, castShadows: true, shadowResolution: 1024, shadowDistance: 70, shadowBias: .1, normalOffsetBias: .05 }); light.setEulerAngles(48, -25, 0); this.app.root.addChild(light);
          const fill = new pc.Entity('Cool ambient fill'); fill.addComponent('light', { type: 'directional', color: new pc.Color(.59, .8, .9), intensity: .45 }); fill.setEulerAngles(24, 145, 0); this.app.root.addChild(fill);
          this._parts.forEach(p => { p.entity = this._newPcPart(p); });
          if(this.level.worldParts)this._batchStaticWorld();
          if(this.level.theme==='white-industrial')this.pcCamera.camera.clearColor=new pc.Color(.89,.92,.9);
          this.mode = 'webgl'; this.app.start();
          this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this._switchToCanvas(); });
          return;
        } catch (error) {
          try { this.app?.destroy(); } catch (_) {} this.app = null;
          console.info('PRIM3: WebGL unavailable; using the interactive projected 3D renderer.');
        }
      }
      this._initCanvas();
    }
    _initCanvas() {
      let ctx = null; try { ctx = this.canvas.getContext('2d', { alpha: false }); } catch (_) {}
      if (!ctx) { const replacement = this.canvas.cloneNode(false); this.canvas.replaceWith(replacement); this.canvas = replacement; ctx = replacement.getContext('2d', { alpha: false }); }
      if (!ctx) throw new Error('PRIM3 requires Canvas2D or WebGL support.');
      this.ctx = ctx; this.mode = 'canvas2d';
    }
    _switchToCanvas() {
      if (this.mode !== 'webgl' || this._disposed) return;
      this._unbindControls(); try { this.app.destroy(); } catch (_) {} this.app = null; this._initCanvas(); this._bindControls(); this.resize();
    }
    _pcMaterial(color, emissive = false) {
      const key = color + emissive; if (this._materials.has(key)) return this._materials.get(key);
      const c = this._readColor(color), m = new pc.StandardMaterial(); m.diffuse = new pc.Color(c[0] / 255, c[1] / 255, c[2] / 255); m.metalness = .03; m.gloss = color === '#101719' ? 6 : 13;
      if (emissive) m.emissive = new pc.Color(c[0] / 700, c[1] / 700, c[2] / 700);
      m.update(); this._materials.set(key, m); return m;
    }
    _readColor(color) { if (color.startsWith('rgb')) return color.match(/[\d.]+/g).slice(0, 3).map(Number); return rgb(color); }
    _newPcPart(p) {
      const entity = new pc.Entity(p.id); entity.addComponent('render', { type: p.shape || 'box', material: this._pcMaterial(p.color, p.emissive), castShadows: !p.ground && !p.window, receiveShadows: true }); this.app.root.addChild(entity); this._setPcPart(entity, p); return entity;
    }
    _setPcPart(entity, p) {
      entity.setPosition(p.x, p.y, p.z); entity.setLocalScale(p.w, p.h, p.d); entity.setEulerAngles((p.r?.[0] || 0) * RAD, (p.r?.[1] || 0) * RAD, (p.r?.[2] || 0) * RAD);
    }
    _basis() {
      const c = this.camera, pitch = this.view === 'top' ? Math.PI / 2 : c.pitch;
      this._sin = Math.sin(c.yaw); this._cos = Math.cos(c.yaw); this._sp = Math.sin(pitch); this._cp = Math.cos(pitch);
      this.ppu = Math.min(this.w, this.h) / c.span;
    }
    _projectWorld(x, h, z) {
      const c = this.camera, dx = x - c.x, dz = z - c.z, dy = h - c.h;
      return { x: this.w / 2 + (dx * this._cos - dz * this._sin) * this.ppu, y: this.h / 2 + (dx * this._sin * this._sp + dz * this._cos * this._sp - dy * this._cp) * this.ppu, depth: dx * this._sin * this._cp + dy * this._sp + dz * this._cos * this._cp };
    }
    project(node) {
      const p = this._projectWorld(node.x + .5, this._height(node) + (Number(node.height) || 0), node.y + .5);
      return { x: p.x, y: p.y, visible: p.x > -30 && p.x < this.w + 30 && p.y > -50 && p.y < this.h + 40, depth: p.depth };
    }
    _unproject(sx, sy, height) {
      const a = (sx - this.w / 2) / this.ppu, b = ((sy - this.h / 2) / this.ppu + (height - this.camera.h) * this._cp) / Math.max(.001, this._sp);
      return { x: this.camera.x + a * this._cos + b * this._sin, z: this.camera.z - a * this._sin + b * this._cos };
    }
    _boxFaces(p) {
      const corners = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(c => {
        const v = rotated([c[0] * p.w / 2, c[1] * p.h / 2, c[2] * p.d / 2], p.r); return { x: p.x + v[0], y: p.y + v[1], z: p.z + v[2] };
      });
      return FACE_DEFS.map(face => {
        const normal = rotated(face.n, p.r), points = face.i.map(i => corners[i]);
        const brightness = clamp(.67 + Math.max(0, normal[0] * -.35 + normal[1] * .83 + normal[2] * -.43) * .44, .53, 1.13);
        const base = this._readColor(p.color); const fill = `rgb(${base.map(n => Math.round(clamp(n * brightness, 0, 255))).join(',')})`;
        return { points, normal, fill, part: p, cx: points.reduce((s,v) => s + v.x,0) / 4, cy: points.reduce((s,v) => s + v.y,0) / 4, cz: points.reduce((s,v) => s + v.z,0) / 4 };
      });
    }
    _unitParts(unit, position, time) {
      const parts = [], role = unit.role || 'H', enemy = unit.team === 'enemy', walk = position.walk || 0, stride = Math.sin(time * 15) * walk;
      const crouch = unit.hunkered || unit.hunker ? .24 : 0, bob = Math.abs(stride) * .035 - crouch;
      const yaw = position.yaw || 0, fall = (position.fall || 0) * 1.4, base = [position.x, position.h + bob, position.z];
      const black = '#101719', armor = enemy ? '#3c3b3c' : '#30383b', cloth = role === 'T' ? '#292f31' : role === 'R' ? '#343b3e' : '#252b2d', bone = '#757c7e';
      const width = role === 'E' ? .55 : .43;
      const add = (id, x, y, z, w, h, d, color, shape = 'box', pitch = 0) => {
        const v = rotated([x, y, z], [fall, yaw, 0]);
        parts.push({ id: `${unit.id}/${id}`, x: base[0] + v[0], y: base[1] + v[1], z: base[2] + v[2], w, h, d, color, shape, r: [pitch + fall, yaw, 0], unit: unit.id });
      };
      add('trousers', 0, .76, 0, .39, .15, .28, '#232a2c'); add('shirt', 0, 1.05, 0, .43, .55, .29, cloth);
      add('carrier', 0, 1.09, .035, width, role === 'E' ? .46 : .34, .34, armor);
      add('blank-id-panel', 0, 1.2, .214, .2, .055, .018, bone);
      for (const sign of [-1,1]) add(`strap${sign}`, sign * .16, 1.34, .035, .06, .05, .3, armor);
      add('neck', 0, 1.39, 0, .15, .14, .16, black, 'sphere');
      add('featureless-head', 0, 1.63, .01, .285, .35, .29, black, 'sphere');
      add('earpiece', -.15, 1.62, -.015, .035, .08, .075, armor);
      add('belt', 0, .79, 0, .43, .085, .3, armor); add('pouch', -.24, .77, -.015, .14, .2, .17, armor);
      const limb = (id, pivot, center, angle, size, color) => { const v = rotated(center, [angle,0,0]); add(id, pivot[0]+v[0], pivot[1]+v[1], pivot[2]+v[2], ...size, color, 'box', angle); };
      for (const sign of [-1,1]) {
        const holdsDeck = role === 'T' && sign === -1;
        const armPitch = holdsDeck ? -.65 + stride * .08 : -sign * stride * .48 - .08, shoulder = [sign * (width / 2 + .075), 1.32, 0];
        if(role==='T') {
          limb(`short-sleeve${sign}`, shoulder, [0,-.11,0], armPitch, [.15,.23,.18], cloth);
          limb(`exposed-upper-arm${sign}`, shoulder, [0,-.285,0], armPitch, [.12,.13,.145], black);
        } else limb(`upper-arm${sign}`, shoulder, [0,-.17,0], armPitch, [.14,.33,.17], cloth);
        const elbowDelta = rotated([0,-.35,0], [armPitch,0,0]), elbow = shoulder.map((v,i) => v + elbowDelta[i]);
        const forearmPitch = holdsDeck ? -1.25 + stride * .06 : armPitch-.17;
        limb(`forearm${sign}`, elbow, [0,-.14,.015], forearmPitch, [.12,.25,.145], role === 'T' ? black : cloth);
        const hand = rotated([0,-.31,.025], [forearmPitch,0,0]); add(`hand${sign}`, elbow[0]+hand[0],elbow[1]+hand[1],elbow[2]+hand[2],.13,.15,.14,black,'sphere');
        if (role === 'E') limb(`shoulder${sign}`, shoulder,[0,-.035,0],armPitch,[.19,.17,.23],armor);
        if (enemy && sign === -1) limb('muted-threat-band',shoulder,[0,-.17,.092],armPitch,[.15,.07,.022],'#ae725f');
        const legPitch = sign * stride * .49 - (crouch ? .32 : 0), kneePitch = legPitch + Math.max(0,-sign*stride)*.6 + (crouch ? .65 : 0), hip = [sign*.12,.75,0];
        limb(`thigh${sign}`,hip,[0,-.17,0],legPitch,[.175,.35,.21],'#252c2e');
        const kd=rotated([0,-.35,0],[legPitch,0,0]),knee=hip.map((v,i)=>v+kd[i]);
        limb(`shin${sign}`,knee,[0,-.16,0],kneePitch,[.15,.31,.18],'#242c2e');
        limb(`boot${sign}`,knee,[0,-.31,.075],kneePitch,[.19,.16,.32],'#20282a');
        if(role==='E')limb(`kneepad${sign}`,knee,[0,-.02,.12],kneePitch,[.17,.16,.05],armor);
      }
      if(role==='E') { add('entry-tool',.3,.76,-.17,.06,.64,.065,'#879194'); add('entry-tool-head',.3,1.09,-.17,.22,.06,.08,'#99a1a1'); }
      else if(role==='R') { for(const s of[-1,1])add(`optic${s}`,.21+s*.06,1.07,.28,.09,.1,.25,'#20282c');add('optic-bridge',.21,1.07,.22,.22,.055,.07,armor);add('sensor',-.27,.86,-.06,.13,.2,.17,armor);add('antenna',-.27,1.1,-.08,.025,.26,.025,'#8d999d'); }
      else if(role==='T') {
        add('open-deck-base',-.3,.95,.33,.42,.06,.3,'#242e32');
        add('open-deck-keyboard',-.3,.986,.34,.35,.012,.23,'#4b5758');
        for(let row=0;row<3;row++)add(`keyboard-row-${row}`,-.3,.997,.28+row*.065,.3,.012,.025,'#242e31');
        add('open-deck-hinged-screen',-.3,1.12,.18,.42,.29,.04,'#253036','box',-.18);
        add('deck-display',-.3,1.125,.207,.35,.23,.012,'#63958e','box',-.18);
        add('interface',.32,.9,.15,.14,.17,.045,'#6a9894');
      }
      if(enemy) { add('compact-tool',.17,1.05,.38,.1,.12,.6,'#232b2e');add('tool-stock',.18,1.03,.08,.12,.15,.21,'#3c4448'); }
      if(this.level.theme==='white-industrial')for(const p of parts){
        // Natural/featureless exposed surfaces retain their existing identity.
        if(!/featureless-head|neck|hand|exposed-upper-arm|forearm/.test(p.id))p.color=/display|interface/.test(p.id)?'#71a9a1':/#(101719|20282a|232a2c|252c2e|242c2e)/.test(p.color)?'#d8deda':'#edf0e9';
      }
      return parts;
    }
    setState(snapshot) {
      this.state = snapshot || { units: [] };
      for (const unit of this.state.units || []) {
        let p = this.positions.get(unit.id); if (!p) p = { yaw: unit.team === 'enemy' ? Math.PI : 0 };
        Object.assign(p,{ x:unit.x+.5,z:unit.y+.5,h:this._height(unit),walk:0,fall:0 }); this.positions.set(unit.id,p);
        if(unit.dead||unit.hp<=0)this.killed.add(unit.id);else this.killed.delete(unit.id);
      }
      if(this._firstState && this.state.units?.length){this._firstState=false;this._startAtSquad();}
      this._dirty=true;
    }
    setOverlay(overlay) { this.overlay={reachable:[],path:[],...overlay};this._dirty=true; }
    _alive(unit) { return unit.hp > 0 && !unit.dead && !unit.extracted && !this.killed.has(unit.id) && unit.visible !== false; }
    focus(idOrNode) {
      const node=typeof idOrNode==='string'?(this.state.units||[]).find(u=>u.id===idOrNode):idOrNode;if(!node)return;
      this.camera.x=node.x+.5;this.camera.z=node.y+.5;this.camera.h=this._height(node)+1.05;this._basis();this._dirty=true;
    }
    // HUD squad taps focus an operative without changing yaw or camera view.
    focusOperative(id) {
      const unit=(this.state.units||[]).find(u=>u.id===id&&this._alive(u));if(!unit)return false;
      const p=this.positions.get(id);
      this.camera.x=p?p.x:unit.x+.5;this.camera.z=p?p.z:unit.y+.5;
      this.camera.h=(p?p.h:this._height(unit))+1;
      this.camera.span=26;this._basis();this._dirty=true;return true;
    }
    _startAtSquad() {
      const unit=(this.state.units||[]).find(u=>u.id===this.state.selectedId&&this._alive(u))||(this.state.units||[]).find(u=>u.team==='player'&&this._alive(u));
      if(!unit)return;
      this.camera.x=unit.x+.5;this.camera.z=unit.y+.5+4;
      this.camera.h=this._height(unit)+1;this.camera.yaw=2.4;this.camera.span=this.w<600?30:32;
      this.view='3d';this._basis();this._dirty=true;
    }
    home() {
      const units=(this.state.units||[]).filter(u=>u.team==='player'&&this._alive(u));if(!units.length)return;
      const selected=units.find(u=>u.id===this.state.selectedId)||units[0];
      this.focusOperative(selected.id);this.camera.span=24;this._basis();this._dirty=true;
    }
    overview() {
      if(this.level.worldParts){this.view='3d';const b=this.level.bounds;this.camera.x=(b.minX+b.maxX+1)/2;this.camera.z=(b.minY+b.maxY+1)/2;this.camera.h=2;this.camera.yaw=this.editor ? .66 : 2.4;this.camera.span=this.editor?Math.max(b.maxX-b.minX,b.maxY-b.minY)*1.08:90;this._basis();this._dirty=true;return;}
      this.camera.x=-8;this.camera.z=-8;this.camera.h=2.5;this.camera.yaw=2.4;
      this.camera.span=this.w<600?90:72;this.view='3d';this._basis();this._dirty=true;
    }
    // Optional hook for commands issued through coordinates or the minimap.
    // It changes the center only when the requested location is off screen.
    ensureVisible(node) {
      if(!node)return false;const p=this.project({...node,height:1}),margin=Math.min(56,this.w*.16,this.h*.16);
      if(p.x>=margin&&p.x<=this.w-margin&&p.y>=margin&&p.y<=this.h-margin)return false;
      this.focus(node);return true;
    }
    setView(mode) { this.view=mode==='top'?'top':'3d';if(this.editor)this.camera.yaw=mode==='top'?Math.PI:.66;this._basis();this._dirty=true; }
    zoom(factor) { if(Number.isFinite(factor)&&factor>0)this.camera.span=clamp(this.camera.span/factor,11,this.level.worldParts?320:115);this._basis();this._dirty=true; }
    rotate(delta) { this.camera.yaw+=Number(delta)||0;this._basis();this._dirty=true; }
    getMode() { return this.mode; }
    resize() {
      const rect=this.canvas.getBoundingClientRect();this.w=Math.max(1,Math.round(rect.width));this.h=Math.max(1,Math.round(rect.height));
      this.dpr=Math.min(root.devicePixelRatio||1,this.w<600?1.5:2);
      if(this.mode==='webgl'){this.app.graphicsDevice.maxPixelRatio=Math.min(this.dpr,1.75);this.app.resizeCanvas(this.w,this.h);}else{this.canvas.width=Math.round(this.w*this.dpr);this.canvas.height=Math.round(this.h*this.dpr);this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0);}
      this._basis();this._dirty=true;
    }
    _tween(duration,fn) {
      if(this._reduced||duration<=0){fn(1);return Promise.resolve();}
      return new Promise(resolve=>{this.tweens.add({start:performance.now(),duration,fn,resolve});});
    }
    async animate(events) {
      for(const event of events||[]){
        if(this._disposed)return;
        if(event.type==='move'&&event.path?.length){
          if(this.killed.has(event.id))continue;
          const unit=(this.state.units||[]).find(u=>u.id===event.id);if(!unit)continue;
          const p=this.positions.get(event.id),path=event.path;
          for(let i=1;i<path.length;i++){
            if(this.killed.has(event.id))break;
            const a={x:p.x,z:p.z,h:p.h},b={x:path[i].x+.5,z:path[i].y+.5,h:this._height(path[i])};
            const length=Math.hypot(b.x-a.x,b.z-a.z),duration=clamp(length*125+Math.abs(b.h-a.h)*15,115,1350);
            p.yaw=Math.atan2(b.x-a.x,b.z-a.z);p.walk=1;
            await this._tween(duration,t=>{p.x=mix(a.x,b.x,t);p.z=mix(a.z,b.z,t);p.h=mix(a.h,b.h,t);this._dirty=true;});
          }
          p.walk=0;this._dirty=true;
        }else if(event.type==='shot'){
          const from=event.from,to=event.to;if(!from||!to)continue;
          const attacker=(this.state.units||[]).find(u=>u.id===event.attackerId),pos=this.positions.get(event.attackerId);
          if(pos)pos.yaw=Math.atan2(to.x-from.x,to.y-from.y);
          const effect={kind:'shot',a:{x:from.x+.5,h:this._height(from)+1.1,z:from.y+.5},b:{x:to.x+.5+(event.hit?0:.65),h:this._height(to)+1.05,z:to.y+.5+(event.hit?0:-.4)},start:performance.now(),duration:400,color:attacker?.team==='enemy'?'#e3a080':'#f1ce83',hit:event.hit,label:event.hit?`−${event.damage||0}`:'MISS'};
          this.effects.push(effect);await this._tween(this._reduced?0:240,()=>{this._dirty=true;});
        }else if(event.type==='death'){
          const p=this.positions.get(event.id);if(p){await this._tween(160,t=>{p.fall=t;this._dirty=true;});}
          this.killed.add(event.id);this._dirty=true;
        }else if(event.type==='hack'||event.type==='extract'){
          const n=event.node||this.level.relay;if(n)this.effects.push({kind:'pulse',node:n,start:performance.now(),duration:700,color:'#91d9b5'});
        }
      }
    }
    _pick(sx,sy) {
      if(this.editor){const r=this.canvas.getBoundingClientRect(),node=this.pickAt(sx+r.left,sy+r.top);if(node)this.onPick(node);return;}
      let nearest=null,best=Infinity;
      for(const unit of this.state.units||[]){if(!this._alive(unit))continue;const p=this.positions.get(unit.id);if(!p)continue;const q=this._projectWorld(p.x,p.h+1,p.z),d=Math.hypot(sx-q.x,sy-q.y);const hit=Math.max(9,Math.min(20,this.ppu*.45));if(d<hit&&d<best){nearest=unit;best=d;}}
      if(nearest){this.onPick({kind:'unit',id:nearest.id});return;}
      const candidates=[];
      for(const surface of [...(this.level.buildings||[]),...(this.level.bridges||[])]){
        const p=this._unproject(sx,sy,surface.h);if(insideRect(p.x,p.z,surface)){const node={x:Math.floor(p.x),y:Math.floor(p.z),layer:1};if(this.level.canStand(node,this.state.gateOpen))candidates.push({node,depth:this._projectWorld(p.x,surface.h,p.z).depth});}
      }
      const p=this._unproject(sx,sy,0),ground={x:Math.floor(p.x),y:Math.floor(p.z),layer:0};
      if(this.level.canStand(ground,this.state.gateOpen))candidates.push({node:ground,depth:this._projectWorld(p.x,0,p.z).depth});
      candidates.sort((a,b)=>b.depth-a.depth);
      const node=candidates[0]?.node||ground,bounds=this.level.bounds||{min:-64,max:63};
      if(node.x>=(bounds.minX??bounds.min)&&node.x<=(bounds.maxX??bounds.max)&&node.y>=(bounds.minY??bounds.min)&&node.y<=(bounds.maxY??bounds.max))this.onPick({kind:'tile',...node});
    }
    pickAt(clientX,clientY) {
      const r=this.canvas.getBoundingClientRect(),sx=clientX-r.left,sy=clientY-r.top;
      if(sx<0||sy<0||sx>r.width||sy>r.height)return null;
      const p=this._unproject(sx,sy,0),b=this.level.bounds||{min:-64,max:63},node={kind:'tile',x:Math.floor(p.x),y:Math.floor(p.z),layer:0};
      if(node.x<(b.minX??b.min)||node.x>(b.maxX??b.max)||node.y<(b.minY??b.min)||node.y>(b.maxY??b.max))return null;
      return node;
    }
    _bindControls() {
      const canvas=this.canvas,pointers=new Map();canvas.style.touchAction='none';this._pointers=pointers;let gesture=null;
      this._listeners=[];const on=(type,handler,options)=>{canvas.addEventListener(type,handler,options);this._listeners.push([type,handler,options]);};
      const position=e=>({x:e.clientX,y:e.clientY});
      on('pointerdown',e=>{pointers.set(e.pointerId,{...position(e),startX:e.clientX,startY:e.clientY,drag:false,button:e.button});canvas.setPointerCapture(e.pointerId);if(pointers.size===2){const[a,b]=[...pointers.values()];gesture={distance:Math.hypot(a.x-b.x,a.y-b.y),x:(a.x+b.x)/2,y:(a.y+b.y)/2};pointers.forEach(p=>p.drag=true);}});
      on('pointermove',e=>{
        const p=pointers.get(e.pointerId);if(!p)return;const dx=e.clientX-p.x,dy=e.clientY-p.y;p.x=e.clientX;p.y=e.clientY;if(Math.hypot(p.x-p.startX,p.y-p.startY)>6)p.drag=true;
        if(pointers.size===2){const[a,b]=[...pointers.values()],distance=Math.hypot(a.x-b.x,a.y-b.y),x=(a.x+b.x)/2,y=(a.y+b.y)/2;if(gesture){this.zoom(distance/Math.max(1,gesture.distance));this._pan(x-gesture.x,y-gesture.y);}gesture={distance,x,y};}
        else if(p.drag){if(this.editor&&p.button!==2&&!e.shiftKey&&this.view!=='top')this.rotate(-dx*.007);else this._pan(dx,dy);}
      });
      on('pointerup',e=>{const p=pointers.get(e.pointerId);if(p&&!p.drag&&p.button===0){const r=canvas.getBoundingClientRect();this._pick(e.clientX-r.left,e.clientY-r.top);}pointers.delete(e.pointerId);if(pointers.size<2)gesture=null;});
      on('pointercancel',e=>{pointers.delete(e.pointerId);gesture=null;});on('contextmenu',e=>e.preventDefault());
      on('lostpointercapture',e=>{pointers.delete(e.pointerId);if(pointers.size<2)gesture=null;});
      on('wheel',e=>{e.preventDefault();this.zoom(Math.exp(-e.deltaY*.0013));},{passive:false});
    }
    _pan(dx,dy) { const a=this._unproject(this.w/2,this.h/2,this.camera.h),b=this._unproject(this.w/2-dx,this.h/2-dy,this.camera.h),v=this.level.bounds;this.camera.x=clamp(this.camera.x+b.x-a.x,(v.minX??v.min)-2,(v.maxX??v.max)+3);this.camera.z=clamp(this.camera.z+b.z-a.z,(v.minY??v.min)-2,(v.maxY??v.max)+3);this._dirty=true; }
    _unbindControls() { for(const[type,handler,options]of this._listeners||[])this.canvas.removeEventListener(type,handler,options);this._listeners=[]; }
    _frame(now) {
      if(this._disposed)return;this._raf=requestAnimationFrame(this._frame);
      for(const t of [...this.tweens]){const p=clamp((now-t.start)/t.duration,0,1);t.fn(p);if(p===1){this.tweens.delete(t);t.resolve();}}
      const previousEffects=this.effects.length;this.effects=this.effects.filter(e=>now-e.start<e.duration);
      if(previousEffects!==this.effects.length)this._dirty=true;
      const active=this.tweens.size>0||this.effects.length>0;
      if(!this._dirty&&!active){
        if(this.mode!=='canvas2d'||this._reduced||!this._waterInView()||now-this._lastFrame<180)return;
      }else if(now-this._lastFrame<(this.w<600?33:30))return;
      this._lastFrame=now;this._time=now/1000;this._basis();
      if(this.mode==='webgl')this._renderGL(now);else this._renderCanvas(now);this._dirty=false;
    }
    _waterInView() {
      const c=this.level.canal;if(!c)return false;
      const points=[[c.x,c.y],[c.x+c.w,c.y],[c.x+c.w,c.y+c.d],[c.x,c.y+c.d]].map(p=>this._projectWorld(p[0],0,p[1]));
      return Math.max(...points.map(p=>p.x))>=0&&Math.min(...points.map(p=>p.x))<=this.w&&Math.max(...points.map(p=>p.y))>=0&&Math.min(...points.map(p=>p.y))<=this.h;
    }
    _near(p) { return p.ground||Math.hypot(p.x-this.camera.x,p.z-this.camera.z)<this.camera.span*1.35+Math.max(p.w,p.d)*.7; }
    _visibleFace(face) { return face.normal[0]*this._sin*this._cp+face.normal[1]*this._sp+face.normal[2]*this._cos*this._cp>.001; }
    _renderCanvas(now) {
      const ctx=this.ctx;ctx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.clearRect(0,0,this.w,this.h);
      const light=this.level.theme==='white-industrial',background=ctx.createLinearGradient(0,0,0,this.h);background.addColorStop(0,light?'#dde5df':'#172c33');background.addColorStop(1,light?'#f0f2ec':'#344b4b');ctx.fillStyle=background;ctx.fillRect(0,0,this.w,this.h);
      const v=this.level.bounds,mx=v.minX??v.min,my=v.minY??v.min,Mx=(v.maxX??v.max)+1,My=(v.maxY??v.max)+1;
      const floor=[[mx,my],[Mx,my],[Mx,My],[mx,My]].map(p=>this._projectWorld(p[0],-.025,p[1]));polygon(ctx,floor);ctx.fillStyle=light?'#e7ebe5':'#7a877f';ctx.fill();
      this._drawGroundDetails(ctx,now);
      const faces=[];
      for(const {p,faces:geometry}of this._staticGeometry){if(p.ground||!this._near(p)||(p.gate&&this.state.gateOpen))continue;if(p.shape==='sphere'){faces.push({kind:'sphere',part:p,depth:this._projectWorld(p.x,p.y,p.z).depth});continue;}for(const face of geometry)if(this._visibleFace(face))faces.push({...face,depth:this._projectWorld(face.cx,face.cy,face.cz).depth});}
      this._pushOverlays(faces);
      for(const unit of this.state.units||[]){
        if(!this._alive(unit))continue;const p=this.positions.get(unit.id);if(!p||Math.hypot(p.x-this.camera.x,p.z-this.camera.z)>this.camera.span*1.5)continue;
        const foot=this._projectWorld(p.x,p.h+.03,p.z);faces.push({kind:'shadow',depth:foot.depth-.25,pos:p});
        const parts=this._unitParts(unit,p,this._time);
        for(const part of parts){if(part.shape==='sphere'){faces.push({kind:'sphere',part,depth:this._projectWorld(part.x,part.y,part.z).depth});continue;}for(const face of this._boxFaces(part))if(this._visibleFace(face))faces.push({...face,depth:this._projectWorld(face.cx,face.cy,face.cz).depth});}
      }
      faces.sort((a,b)=>a.depth-b.depth);
      for(const face of faces){
        if(face.kind==='shadow'){this._drawShadow(ctx,face.pos);continue;}
        if(face.kind==='sphere'){this._drawSphere(ctx,face.part);continue;}
        const points=face.points.map(p=>this._projectWorld(p.x,p.y,p.z));
        if(points.every(p=>p.x<-20)||points.every(p=>p.x>this.w+20)||points.every(p=>p.y<-20)||points.every(p=>p.y>this.h+20))continue;
        polygon(ctx,points);ctx.fillStyle=face.fill;ctx.fill();
        if(!face.overlay){ctx.strokeStyle='rgba(17,35,36,.12)';ctx.lineWidth=.5;ctx.stroke();}
        if(face.stroke){ctx.strokeStyle=face.stroke;ctx.lineWidth=face.width||1;ctx.stroke();}
      }
      this._drawEffects(ctx,now);this._drawWorldMarkers(ctx);
      if(!light){const vignette=ctx.createRadialGradient(this.w/2,this.h/2,Math.min(this.w,this.h)*.28,this.w/2,this.h/2,Math.max(this.w,this.h)*.72);vignette.addColorStop(0,'rgba(5,16,20,0)');vignette.addColorStop(1,'rgba(5,16,20,.27)');ctx.fillStyle=vignette;ctx.fillRect(0,0,this.w,this.h);}
    }
    _drawGroundDetails(ctx,now) {
      if(this.level.worldParts){this._drawForgeGround(ctx,now);return;}
      const quad=(x,z,w,d,h=0)=>[{x,y:h,z},{x:x+w,y:h,z},{x:x+w,y:h,z:z+d},{x,y:h,z:z+d}].map(p=>this._projectWorld(p.x,p.y,p.z));
      polygon(ctx,quad(-7,-61,14,116));ctx.fillStyle='#6c7c77';ctx.fill();polygon(ctx,quad(-57,-41,112,10));ctx.fillStyle='#74817a';ctx.fill();
      const radius=Math.min(42,Math.ceil(this.camera.span*1.1)),cx=Math.floor(this.camera.x),cz=Math.floor(this.camera.z),step=this.ppu<6?4:1;
      ctx.strokeStyle=this.ppu<10?'rgba(33,56,53,.13)':'rgba(40,65,59,.22)';ctx.lineWidth=.65;
      for(let x=Math.max(-64,cx-radius);x<=Math.min(64,cx+radius);x+=step){const a=this._projectWorld(x,0,Math.max(-64,cz-radius)),b=this._projectWorld(x,0,Math.min(64,cz+radius));ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
      for(let z=Math.max(-64,cz-radius);z<=Math.min(64,cz+radius);z+=step){const a=this._projectWorld(Math.max(-64,cx-radius),0,z),b=this._projectWorld(Math.min(64,cx+radius),0,z);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
      const c=this.level.canal;if(c){const water=quad(c.x,c.y,c.w,c.d,.02);polygon(ctx,water);ctx.fillStyle='#315f63';ctx.fill();ctx.save();polygon(ctx,water);ctx.clip();
        for(let j=0;j<18;j++){const z=c.y+j*c.d/18+.1*Math.sin(now*.0007+j),a=this._projectWorld(c.x,.025,z),b=this._projectWorld(c.x+c.w,.025,z);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineWidth=j%4===0?1.5:.7;ctx.strokeStyle=j%3===0?'rgba(150,192,174,.23)':'rgba(9,45,51,.2)';ctx.stroke();}ctx.restore();}
      for(let y=-55;y<=55;y+=5){if(y>=-29&&y<-20)continue;polygon(ctx,quad(-1.06,y,.12,1.8,.035));ctx.fillStyle='#bdbda3';ctx.fill();}
      const evac=this.level.evac;if(evac)this._worldCircle(ctx,evac.x+.5,0.04,evac.y+.5,evac.r,'rgba(152,215,189,.72)',1.8,true);
    }
    _drawForgeGround(ctx,now) {
      for(const {p,faces}of this._staticGeometry){if(!p.ground||p.id==='forge-foundation')continue;const face=faces.find(f=>f.normal[1]>.9);if(!face)continue;polygon(ctx,face.points.map(v=>this._projectWorld(v.x,v.y,v.z)));ctx.fillStyle=p.color;ctx.fill();}
      const b=this.level.bounds,minX=b.minX,minY=b.minY,maxX=b.maxX+1,maxY=b.maxY+1,step=this.ppu>7?1:4;
      ctx.lineWidth=.6;
      const line=(x1,y1,x2,y2,color)=>{const a=this._projectWorld(x1,.32,y1),c=this._projectWorld(x2,.32,y2);ctx.strokeStyle=color;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(c.x,c.y);ctx.stroke();};
      for(let x=minX;x<=maxX;x+=step)line(x,minY,x,maxY,x===0?'rgba(25,92,89,.7)':x%16===0?'rgba(49,77,70,.3)':'rgba(49,77,70,.09)');
      for(let y=minY;y<=maxY;y+=step)line(minX,y,maxX,y,y===0?'rgba(25,92,89,.7)':y%16===0?'rgba(49,77,70,.3)':'rgba(49,77,70,.09)');
      ctx.font='600 10px ui-monospace,monospace';ctx.textAlign='center';
      for(let n=minX;n<=maxX;n+=16){const p=this._projectWorld(n,.4,minY);ctx.fillStyle='#263e37';ctx.fillText(n>0?'+'+n:String(n),p.x,p.y+13);}
      for(let n=minY;n<=maxY;n+=16){const p=this._projectWorld(minX,.4,n);ctx.fillStyle='#263e37';ctx.fillText(n>0?'+'+n:String(n),p.x-15,p.y+3);}
      const evac=this.level.evac;if(evac)this._worldCircle(ctx,evac.x+.5,.4,evac.y+.5,evac.r,'#62997e',1.5,true);
    }
    _pushOverlays(faces) {
      const add=(node,color,stroke,inset=.04)=>{const h=this._height(node)+.07,x=node.x+inset,z=node.y+inset,s=1-inset*2;const points=[{x,y:h,z},{x:x+s,y:h,z},{x:x+s,y:h,z:z+s},{x,y:h,z:z+s}];faces.push({points,fill:color,stroke,overlay:true,depth:this._projectWorld(x+s/2,h,z+s/2).depth+.018});};
      for(const node of this.overlay.reachable||[]){if(Math.hypot(node.x-this.camera.x,node.y-this.camera.z)<this.camera.span*1.4)add(node,'rgba(90,174,164,.26)','rgba(119,205,190,.37)');}
      for(const node of this.overlay.path||[])add(node,'rgba(220,174,91,.47)','rgba(242,202,123,.8)',.14);
      const path=this.overlay.path||[];
      for(let i=1;i<path.length;i++){
        const a=path[i-1],b=path[i],dx=b.x-a.x,dz=b.y-a.y,length=Math.hypot(dx,dz);if(length<1.5&&a.layer===b.layer)continue;
        const nx=-dz/Math.max(1,length)*.085,nz=dx/Math.max(1,length)*.085,ah=this._height(a)+.14,bh=this._height(b)+.14;
        const points=[{x:a.x+.5+nx,y:ah,z:a.y+.5+nz},{x:b.x+.5+nx,y:bh,z:b.y+.5+nz},{x:b.x+.5-nx,y:bh,z:b.y+.5-nz},{x:a.x+.5-nx,y:ah,z:a.y+.5-nz}];
        faces.push({points,fill:'rgba(246,199,115,.9)',overlay:true,depth:this._projectWorld((a.x+b.x)/2+.5,(ah+bh)/2,(a.y+b.y)/2+.5).depth+.03});
      }
      if(this.overlay.destination)add(this.overlay.destination,'rgba(234,188,103,.64)','#ffe1a0');
      const selected=(this.state.units||[]).find(u=>u.id===(this.overlay.selectedId||this.state.selectedId));if(selected&&this._alive(selected))add(selected,'rgba(119,209,186,.19)','#b9ead1',.01);
      const target=(this.state.units||[]).find(u=>u.id===this.overlay.targetId);if(target&&this._alive(target))add(target,'rgba(200,104,83,.23)','#edaa8e',.015);
      const r=this.overlay.selectionBox;if(r){const h=(r.elevation||0)+.36,points=[{x:r.x,y:h,z:r.y},{x:r.x+r.w,y:h,z:r.y},{x:r.x+r.w,y:h,z:r.y+r.d},{x:r.x,y:h,z:r.y+r.d}];faces.push({points,fill:'rgba(14,158,147,.18)',stroke:'#008c85',width:2,overlay:true,depth:this._projectWorld(r.x+r.w/2,h,r.y+r.d/2).depth+.04});}
    }
    _drawShadow(ctx,p) { const q=this._projectWorld(p.x+.18,p.h+.025,p.z+.12);ctx.save();ctx.translate(q.x,q.y);ctx.scale(1,Math.max(.28,this._sp*.65));ctx.beginPath();ctx.ellipse(0,0,this.ppu*.44,this.ppu*.25,0,0,TAU);ctx.fillStyle='rgba(18,31,29,.29)';ctx.fill();ctx.restore(); }
    _drawSphere(ctx,p) {
      const q=this._projectWorld(p.x,p.y,p.z),rx=Math.max(1,p.w*this.ppu/2),ry=Math.max(1,Math.hypot(p.h*this._cp,p.d*this._sp)*this.ppu/2);
      ctx.save();ctx.translate(q.x,q.y);ctx.scale(1,ry/rx);const grad=ctx.createRadialGradient(-rx*.34,-rx*.36,rx*.03,0,0,rx);grad.addColorStop(0,shade(p.color,1.2));grad.addColorStop(.37,p.color);grad.addColorStop(1,shade(p.color,.55));ctx.fillStyle=grad;ctx.beginPath();ctx.arc(0,0,rx,0,TAU);ctx.fill();ctx.restore();
    }
    _worldCircle(ctx,x,h,z,r,color,width=1,dashed=false) { const points=[];for(let i=0;i<=60;i++){const a=i/60*TAU;points.push(this._projectWorld(x+Math.cos(a)*r,h,z+Math.sin(a)*r));}ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle=color;ctx.lineWidth=width;if(dashed)ctx.setLineDash([8,5]);ctx.stroke();ctx.setLineDash([]); }
    _drawEffects(ctx,now) {
      for(const e of this.effects){const t=(now-e.start)/e.duration;if(e.kind==='shot'){const a=this._projectWorld(e.a.x,e.a.h,e.a.z),b=this._projectWorld(e.b.x,e.b.h,e.b.z);ctx.save();ctx.globalAlpha=Math.max(0,1-t);ctx.strokeStyle=e.color;ctx.shadowColor=e.color;ctx.shadowBlur=8;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.beginPath();ctx.arc(b.x,b.y,3+t*9,0,TAU);ctx.stroke();ctx.shadowBlur=0;ctx.fillStyle=e.color;ctx.font='700 12px system-ui,sans-serif';ctx.textAlign='center';ctx.fillText(e.label||'',b.x,b.y-12-t*12);ctx.restore();}else if(e.node)this._worldCircle(ctx,e.node.x+.5,this._height(e.node)+.08,e.node.y+.5,1+t*2,e.color,2);}
    }
    _drawWorldMarkers(ctx) {
      const markers=[{node:this.level.relay,text:this.state.hackProgress>=2?'LINKED':'RELAY',color:'#d4d9a4',height:2.9},{node:this.level.medkit,text:this.state.medkitUsed?'USED':'MED',color:'#d6c9a5',height:.85}];
      if(this.level.evac)markers.push({node:this.level.evac,text:'EXTRACT',color:'#a9dbc4',height:.15});
      ctx.font='600 9px system-ui,sans-serif';ctx.textAlign='center';
      for(const m of markers){if(!m.node)continue;const p=this.project({...m.node,height:m.height});if(!p.visible)continue;const width=ctx.measureText(m.text).width;ctx.fillStyle='rgba(14,35,39,.76)';ctx.fillRect(p.x-width/2-5,p.y-13,width+10,17);ctx.fillStyle=m.color;ctx.fillText(m.text,p.x,p.y-1);}
    }
    _renderGL(now) {
      const c=this.camera,pitch=this.view==='top'?Math.PI/2-.0001:c.pitch,distance=150;
      this.pcCamera.setPosition(c.x+Math.sin(c.yaw)*Math.cos(pitch)*distance,c.h+Math.sin(pitch)*distance,c.z+Math.cos(c.yaw)*Math.cos(pitch)*distance);this.pcCamera.lookAt(c.x,c.h,c.z);this.pcCamera.camera.orthoHeight=this.h/(2*this.ppu);
      if(!this._staticBatch)for(const p of this._parts){p.entity.enabled=this._near(p)&&!(p.gate&&this.state.gateOpen);}
      const alive=new Set();
      for(const unit of this.state.units||[]){if(!this._alive(unit))continue;alive.add(unit.id);const pos=this.positions.get(unit.id);if(!pos)continue;
        const parts=this._unitParts(unit,pos,this._time);let record=this._glUnits.get(unit.id);if(!record){record=new Map();this._glUnits.set(unit.id,record);}
        for(const p of parts){let e=record.get(p.id);if(!e){e=this._newPcPart(p);record.set(p.id,e);}e.enabled=Math.hypot(pos.x-c.x,pos.z-c.z)<c.span*1.5;this._setPcPart(e,p);}
      }
      for(const[id,record]of this._glUnits)if(!alive.has(id))for(const e of record.values())e.enabled=false;
      const line=(a,b,color)=>{const q=this._readColor(color);this.app.drawLine(new pc.Vec3(a.x,a.h,a.z),new pc.Vec3(b.x,b.h,b.z),new pc.Color(q[0]/255,q[1]/255,q[2]/255));};
      const tile=(n,color,inset=.03)=>{const h=this._height(n)+.075,x=n.x+inset,z=n.y+inset,s=1-inset*2,p=[{x,h,z},{x:x+s,h,z},{x:x+s,h,z:z+s},{x,h,z:z+s}];for(let i=0;i<4;i++)line(p[i],p[(i+1)%4],color);};
      const radius=Math.min(35,Math.ceil(c.span)),cx=Math.floor(c.x),cz=Math.floor(c.z),step=this.ppu<6?4:1;
      for(let x=Math.max(-64,cx-radius);x<Math.min(64,cx+radius);x+=step)line({x,h:.025,z:Math.max(-64,cz-radius)},{x,h:.025,z:Math.min(64,cz+radius)},'#708a7e');
      for(let z=Math.max(-64,cz-radius);z<Math.min(64,cz+radius);z+=step)line({x:Math.max(-64,cx-radius),h:.025,z},{x:Math.min(64,cx+radius),h:.025,z},'#708a7e');
      for(const n of this.overlay.reachable||[])if(Math.hypot(n.x-c.x,n.y-c.z)<c.span*1.4)tile(n,'#75b8a9');
      for(const n of this.overlay.path||[])tile(n,'#e8bd73',.16);
      const route=this.overlay.path||[];for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i];line({x:a.x+.5,h:this._height(a)+.14,z:a.y+.5},{x:b.x+.5,h:this._height(b)+.14,z:b.y+.5},'#f4c778');}
      if(this.overlay.destination)tile(this.overlay.destination,'#ffe0a0');
      const s=(this.state.units||[]).find(u=>u.id===(this.overlay.selectedId||this.state.selectedId));if(s&&this._alive(s))tile(s,'#b9f0d3',.01);
      const target=(this.state.units||[]).find(u=>u.id===this.overlay.targetId);if(target&&this._alive(target))tile(target,'#edaa8e',.015);
      const r=this.overlay.selectionBox;if(r){const h=(r.elevation||0)+.35,p=[{x:r.x,h,z:r.y},{x:r.x+r.w,h,z:r.y},{x:r.x+r.w,h,z:r.y+r.d},{x:r.x,h,z:r.y+r.d}];for(let i=0;i<4;i++)line(p[i],p[(i+1)%4],'#008d84');}
      for(const e of this.effects)if(e.kind==='shot')line(e.a,e.b,e.color);
      const evac=this.level.evac;if(evac)for(let i=0;i<48;i++){const a=i/48*TAU,b=(i+.7)/48*TAU;line({x:evac.x+.5+Math.cos(a)*evac.r,h:.05,z:evac.y+.5+Math.sin(a)*evac.r},{x:evac.x+.5+Math.cos(b)*evac.r,h:.05,z:evac.y+.5+Math.sin(b)*evac.r},'#9fd8ba');}
      this.app.renderNextFrame=true;
    }
    destroy() { this._disposed=true;cancelAnimationFrame(this._raf);this._resizeObserver?.disconnect();this._unbindControls();for(const t of this.tweens)t.resolve();this.tweens.clear();try{this.app?.destroy();}catch(_){}this.positions.clear(); }
  }
  root.P3Renderer=P3Renderer;
})(typeof window!=='undefined'?window:globalThis);
