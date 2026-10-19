/* The strand IS the music control. No 3D asset or pre-rendered animation. */
import * as THREE from "../../vendor/three.module.min.js";
import { albumProfile, strandPoint, rungPositions, visualPeaks, catalogueOffset, clamp } from "./math.mjs";

const COLORS = ["#f2ae69", "#7fd8df", "#ba9dff", "#e79ab2", "#94d2a3", "#f3c576"];
const UP = new THREE.Vector3(0, 1, 0);
const V = point => new THREE.Vector3(point.x, point.y, point.z);
const temp = new THREE.Vector3();

function rod(a, b, radius, material, segments = 9) {
  const distance = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, distance, segments, 1), material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, temp.subVectors(b, a).normalize());
  return mesh;
}

function backbone(profile, side, material) {
  const points = Array.from({ length: 161 }, (_, i) => V(strandPoint(i / 160, side, profile)));
  return new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 192, 0.043, 7, false),
    material
  );
}

function waveform(spec, signature, material) {
  const count = signature.length;
  const positions = new Float32Array(count * 3);
  const a = V(spec.a);
  const b = V(spec.b);
  const direction = new THREE.Vector3().subVectors(b, a);
  for (let i = 0; i < count; i++) {
    const point = a.clone().addScaledVector(direction, i / (count - 1));
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y + (i % 2 ? -1 : 1) * signature[i] * 0.095;
    positions[i * 3 + 2] = point.z + 0.035;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Line(geometry, material);
}

export class HelixScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#07090f");
    this.scene.fog = new THREE.FogExp2("#07090f", 0.022);
    this.camera = new THREE.PerspectiveCamera(37, 1, 0.1, 80);
    this.camera.position.set(0, 0, 13.4);
    this.renderer = new THREE.WebGLRenderer({
      canvas, alpha: false, antialias: true, powerPreference: "low-power"
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene.add(new THREE.AmbientLight(0xd6e2fa, 1.25));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(-3, 5, 7);
    this.scene.add(key);
    const fill = new THREE.PointLight(0x4d6dff, 36, 22);
    fill.position.set(4, -2, 5);
    this.scene.add(fill);

    this.items = [];
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.mode = "library";
    this.albumIndex = 0;
    this.trackIndex = 0;
    this.clock = new THREE.Clock();
    this.lastDraw = 0;
    this.motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.cameraTarget = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();
    this.frame = null;
    this.playing = false;
    this.audio = null;
    this.live = false;
    this.boundResize = () => this.resize();
    this.boundVisibility = () => { if (!document.hidden) this.start(); };
    window.addEventListener("resize", this.boundResize);
    document.addEventListener("visibilitychange", this.boundVisibility);
    this.resize();
  }

  mount(albums) {
    this.items.forEach(item => this.scene.remove(item.root));
    this.items = albums.map((album, albumIndex) => this.makeAlbum(album, albumIndex));
    this.mode = "library";
    this.albumIndex = 0;
    this.trackIndex = 0;
    this.layout(true);
    this.start();
  }

  makeAlbum(album, albumIndex) {
    const tracks = album.tracks || [];
    const profile = albumProfile(tracks.length);
    const baseColor = new THREE.Color(tracks.find(t => t.pulse)?.pulse || COLORS[albumIndex % COLORS.length]);
    const root = new THREE.Group();
    const strand = new THREE.Group();
    root.add(strand);
    const railMaterial = new THREE.MeshStandardMaterial({
      color: "#aec7d0", metalness: 0.62, roughness: 0.23,
      emissive: baseColor, emissiveIntensity: 0.27
    });
    strand.add(backbone(profile, 0, railMaterial));
    strand.add(backbone(profile, 1, railMaterial));
    const endpoint = new THREE.SphereGeometry(0.068, 10, 8);
    const beadMaterial = new THREE.MeshStandardMaterial({
      color: baseColor, metalness: 0.35, roughness: 0.25,
      emissive: baseColor, emissiveIntensity: 0.42
    });
    const rungs = rungPositions(tracks.length, profile).map(spec => {
      const a = V(spec.a), b = V(spec.b);
      const mat = new THREE.MeshStandardMaterial({
        color: "#bac9d3", metalness: 0.7, roughness: 0.23,
        emissive: baseColor, emissiveIntensity: 0.18
      });
      const bar = rod(a, b, 0.024, mat);
      strand.add(bar);
      for (const p of [a, b]) {
        const node = new THREE.Mesh(endpoint, beadMaterial);
        node.position.copy(p);
        strand.add(node);
      }
      const signature = visualPeaks(album.slug + "|" + tracks[spec.index].title);
      const waveMaterial = new THREE.LineBasicMaterial({ color: baseColor, transparent: true, opacity: 0.7 });
      const wave = waveform(spec, signature, waveMaterial);
      strand.add(wave);
      const hit = rod(a, b, 0.18, new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0.003, depthWrite: false, colorWrite: false
      }), 10);
      hit.userData = { kind: "song", albumIndex, trackIndex: spec.index };
      strand.add(hit);
      return { spec, a, b, bar, hit, wave, mat, waveMaterial };
    });
    const vial = new THREE.Group();
    root.add(vial);
    const glassMat = new THREE.MeshPhongMaterial({
      color: 0xb7cde3, transparent: true, opacity: 0.14,
      shininess: 125, side: THREE.DoubleSide, depthWrite: false
    });
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.91, 0.91, 6.04, 40, 1, true), glassMat);
    vial.add(shell);
    const capMaterial = new THREE.MeshStandardMaterial({
      color: "#8794a4", metalness: 0.82, roughness: 0.23
    });
    const caps = [];
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x9fb9cb, transparent: true, opacity: 0.48 });
    for (const side of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.94, 0.94, 0.12, 32), capMaterial);
      cap.position.y = side * 3.05;
      cap.userData.decorative = true;
      vial.add(cap);
      caps.push(cap);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.014, 8, 42), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = side * 2.97;
      vial.add(ring);
      caps.push(ring);
    }
    const vialHit = new THREE.Mesh(new THREE.CylinderGeometry(0.94, 0.94, 6.1, 12), new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0.003, depthWrite: false, colorWrite: false
    }));
    vialHit.userData = { kind: "vial", albumIndex };
    vial.add(vialHit);
    const progress = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), new THREE.MeshBasicMaterial({ color: baseColor }));
    strand.add(progress);
    progress.visible = false;
    // Two energy markers run through the DNA rails at the selected song's time.
    const flow = [0, 1].map(() => {
      const node = new THREE.Mesh(new THREE.SphereGeometry(0.073, 11, 8), new THREE.MeshBasicMaterial({ color: baseColor }));
      node.visible = false;
      strand.add(node);
      return node;
    });
    this.scene.add(root);
    return { root, strand, vial, glassMat, caps, vialHit, profile, rungs, progress, flow, railMaterial, baseColor };
  }

  setMode(mode, albumIndex = this.albumIndex, trackIndex = this.trackIndex) {
    this.mode = mode;
    this.albumIndex = clamp(albumIndex, 0, Math.max(this.items.length - 1, 0));
    const count = this.items[this.albumIndex]?.rungs.length || 1;
    this.trackIndex = clamp(trackIndex, 0, count - 1);
    this.updateSelection();
  }

  updateSelection() {
    this.items.forEach((item, ai) => {
      item.rungs.forEach((rung, ri) => {
        const focused = ai === this.albumIndex && ri === this.trackIndex && this.mode !== "library";
        rung.mat.emissiveIntensity = focused ? 1.25 : 0.18;
        rung.mat.color.set(focused ? "#fff9e8" : "#bac9d3");
        rung.waveMaterial.opacity = focused ? 1 : 0.68;
      });
    });
  }

  setAudio(audio) { this.audio = audio; }
  setPlaying(playing) { this.playing = !!playing; }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  layout(immediate = false) {
    const selected = this.items[this.albumIndex];
    if (!selected) return;
    const library = this.mode === "library";
    const close = this.mode === "song";
    const focused = selected.rungs[this.trackIndex];
    const targetCamZ = library ? 13.4 : close ? 5.65 : 9.2;
    const targetY = close && focused ? focused.spec.y - 0.42 : 0;
    const blend = immediate || !this.motion ? 1 : 0.105;
    this.camera.position.z += (targetCamZ - this.camera.position.z) * blend;
    this.camera.position.y += (targetY - this.camera.position.y) * blend;
    this.lookTarget.y += (targetY - this.lookTarget.y) * blend;
    this.camera.lookAt(this.lookTarget);

    this.items.forEach((item, index) => {
      const offset = catalogueOffset(index, this.albumIndex, this.items.length);
      const show = library ? Math.abs(offset) <= 2 : index === this.albumIndex;
      item.root.visible = show;
      if (!show) return;
      const x = library ? offset * 2.95 : 0;
      const z = library ? -Math.abs(offset) * 1.8 : 0;
      const scale = library ? (offset === 0 ? 0.96 : 0.73) : 1;
      item.root.position.x += (x - item.root.position.x) * blend;
      item.root.position.z += (z - item.root.position.z) * blend;
      item.root.scale.setScalar(item.root.scale.x + (scale - item.root.scale.x) * blend);

      const goalOpacity = library ? 0.14 : 0;
      item.glassMat.opacity += (goalOpacity - item.glassMat.opacity) * blend;
      item.vial.visible = library || item.glassMat.opacity > 0.012;
      item.caps.forEach(cap => { cap.visible = library; });
      item.vialHit.visible = library;
      // In the close view, rotate the selected rung toward the camera.
      const rung = item.rungs[this.trackIndex];
      const angle = close && rung ? item.profile.phase + item.profile.turns * Math.PI * 2 * rung.spec.u : 0;
      item.strand.rotation.y += (angle - item.strand.rotation.y) * blend;
    });
  }

  draw() {
    if (!this.live || document.hidden) {
      this.frame = null;
      return;
    }
    this.frame = window.requestAnimationFrame(() => this.draw());
    const now = performance.now();
    // Limit redraw power on an iPhone; camera transitions still feel fluid.
    if (now - this.lastDraw < 1000 / 45) return;
    this.lastDraw = now;
    this.layout();
    const current = this.items[this.albumIndex];
    if (current) {
      const rung = current.rungs[this.trackIndex];
      if (rung && this.audio && this.mode === "song") {
        const duration = Number(this.audio.duration);
        const pct = Number.isFinite(duration) && duration > 0
          ? clamp(this.audio.currentTime / duration, 0, 1) : 0;
        current.progress.visible = true;
        current.progress.position.copy(rung.a).lerp(rung.b, pct);
        current.progress.scale.setScalar(this.playing && this.motion ? 1 + 0.08 * Math.sin(now * 0.009) : 1);
        const along = clamp(rung.spec.u + 0.11 * (pct - 0.5), 0, 1);
        current.flow.forEach((node, side) => {
          node.visible = this.mode === "song";
          node.position.copy(V(strandPoint(along, side, current.profile)));
          node.scale.setScalar(this.playing ? 1.12 : 0.85);
        });
        current.railMaterial.emissiveIntensity = this.playing && this.mode === "song" ? 0.45 : 0.27;
      } else {
        current.progress.visible = false;
        current.flow.forEach(node => { node.visible = false; });
        current.railMaterial.emissiveIntensity = 0.27;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    if (this.live && this.frame !== null) return;
    this.live = true;
    this.frame = window.requestAnimationFrame(() => this.draw());
  }

  pick(clientX, clientY) {
    if (!this.items.length) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.mode === "library"
      ? this.items.filter(item => item.root.visible).map(item => item.vialHit)
      : this.items[this.albumIndex].rungs.map(r => r.hit);
    const result = this.raycaster.intersectObjects(hits, false)[0];
    return result?.object.userData || null;
  }

  // Scrub across the selected 3D crossbar (not a separate timeline widget).
  seekFraction(clientX) {
    const item = this.items[this.albumIndex];
    const rung = item?.rungs[this.trackIndex];
    if (!rung) return null;
    this.scene.updateMatrixWorld(true);
    const left = rung.a.clone().applyMatrix4(item.strand.matrixWorld).project(this.camera);
    const right = rung.b.clone().applyMatrix4(item.strand.matrixWorld).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    return clamp((x - left.x) / (right.x - left.x || 1), 0, 1);
  }

  dispose() {
    this.live = false;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    window.removeEventListener("resize", this.boundResize);
    document.removeEventListener("visibilitychange", this.boundVisibility);
    this.items.forEach(item => {
      item.root.traverse(child => {
        child.geometry?.dispose?.();
        if (child.material && child.material !== item.railMaterial) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
      item.railMaterial.dispose();
    });
    this.renderer.dispose();
  }
}
