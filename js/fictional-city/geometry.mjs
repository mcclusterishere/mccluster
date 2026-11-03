/* Original procedural kit. No borrowed game assets, reconstructed marks or building interiors. */
import * as THREE from 'three';

export function createGeometryKit() {
  const geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    cone: new THREE.ConeGeometry(0.5, 1, 6),
    sphere: new THREE.SphereGeometry(0.5, 7, 5),
    torus: new THREE.TorusGeometry(0.5, 0.16, 5, 12),
    plane: new THREE.PlaneGeometry(1, 1),
    circle: new THREE.CircleGeometry(0.5, 16)
  };
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.Float32BufferAttribute([
    -.5,0,-.5, .5,0,-.5, 0,1,-.5, .5,0,.5, -.5,0,.5, 0,1,.5,
    -.5,0,-.5, 0,1,-.5, 0,1,.5, -.5,0,-.5, 0,1,.5, -.5,0,.5,
    0,1,-.5, .5,0,-.5, .5,0,.5, 0,1,-.5, .5,0,.5, 0,1,.5,
    -.5,0,.5, .5,0,.5, .5,0,-.5, -.5,0,.5, .5,0,-.5, -.5,0,-.5
  ], 3));
  roof.computeVertexNormals(); geometries.roof = roof;
  const materials = new Map();
  const pos = new THREE.Vector3(), scale = new THREE.Vector3(), quat = new THREE.Quaternion(), euler = new THREE.Euler();

  function material(color, options = {}) {
    const k = `${color}|${options.basic ? 'b' : 's'}|${options.opacity ?? 1}`;
    if (!materials.has(k)) {
      const params = { color, transparent: options.opacity < 1, opacity: options.opacity ?? 1 };
      materials.set(k, options.basic ? new THREE.MeshBasicMaterial(params) : new THREE.MeshLambertMaterial(params));
    }
    return materials.get(k);
  }

  function batch(parent) {
    const bins = new Map();
    const api = {
      target: null,
      setTarget(target) { api.target = target; },
      add(shape, color, x, y, z, sx, sy, sz, rotation = null, target = null, options = {}) {
        const m = material(color, options), k = `${shape}:${m.uuid}`;
        if (!bins.has(k)) bins.set(k, { geometry: geometries[shape], material: m, records: [] });
        const matrix = new THREE.Matrix4();
        pos.set(x, y, z); scale.set(sx, sy, sz);
        if (rotation) euler.set(rotation[0], rotation[1], rotation[2]); else euler.set(0, 0, 0);
        quat.setFromEuler(euler); matrix.compose(pos, quat, scale);
        bins.get(k).records.push({ matrix, target: target || api.target });
        return api;
      },
      finish() {
        const meshes = [];
        for (const bin of bins.values()) {
          const fading = bin.records.some(r => r.target);
          const geometry = fading ? bin.geometry.clone() : bin.geometry;
          const mat = fading ? bin.material.clone() : bin.material;
          const fade = fading ? new Float32Array(bin.records.length).fill(1) : null;
          if (fading) {
            geometry.setAttribute('cityFade', new THREE.InstancedBufferAttribute(fade, 1));
            // Ordered transparency keeps depth sorting deterministic and avoids a second draw pass.
            mat.onBeforeCompile = shader => {
              shader.vertexShader = 'attribute float cityFade; varying float vCityFade;\n' + shader.vertexShader;
              shader.vertexShader = shader.vertexShader.replace('void main() {', 'void main() { vCityFade = cityFade;');
              shader.fragmentShader = 'varying float vCityFade;\n' + shader.fragmentShader;
              shader.fragmentShader = shader.fragmentShader.replace('void main() {', `void main() {
                vec2 cityPixel = mod(floor(gl_FragCoord.xy), 4.0);
                float cityThreshold = (mod(cityPixel.x * 2.0 + cityPixel.y * 3.0, 4.0) * 4.0 + mod(cityPixel.y * 2.0 + cityPixel.x, 4.0)) / 16.0;
                if (vCityFade < 0.99 && cityThreshold > vCityFade) discard;`);
            };
            mat.customProgramCacheKey = () => 'fictional-city-occlusion-v1';
          }
          const mesh = new THREE.InstancedMesh(geometry, mat, bin.records.length);
          if (fading) { mesh.userData.ownedGeometry = geometry; mesh.userData.ownedMaterial = mat; mesh.userData.fade = fade; }
          mesh.userData.instanceTargets = bin.records.map(r => r.target);
          bin.records.forEach((r, i) => mesh.setMatrixAt(i, r.matrix));
          mesh.instanceMatrix.needsUpdate = true;
          mesh.computeBoundingSphere(); parent.add(mesh); meshes.push(mesh);
        }
        return meshes;
      }
    };
    return api;
  }

  function sign(parent, text, subline, { x, y, z, width = 12, height = 2.1, yaw = 0, background = '#26383c', foreground = '#fff2d9', accent = '#e8b87c' } = {}) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = background; ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = accent; ctx.lineWidth = 5; ctx.strokeRect(10, 10, 1004, 236);
    const words = String(text).split(/\s+/); let lines = [], fontSize = 70;
    for (; fontSize >= 28; fontSize -= 2) {
      ctx.font = `800 ${fontSize}px system-ui, sans-serif`; lines = []; let line = '';
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > 950 && line) { lines.push(line); line = word; } else line = next;
      }
      if (line) lines.push(line);
      if (lines.length <= 2 && lines.every(l => ctx.measureText(l).width <= 950)) break;
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = foreground;
    const mid = subline ? 102 : 128;
    lines.forEach((l, i) => ctx.fillText(l, 512, mid + (i - (lines.length - 1) / 2) * (fontSize + 5), 950));
    if (subline) {
      let small = 27;
      while (small > 17) { ctx.font = `600 ${small}px system-ui, sans-serif`; if (ctx.measureText(subline).width <= 930) break; small--; }
      ctx.fillStyle = accent; ctx.fillText(subline, 512, 211, 930);
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2;
    const m = new THREE.MeshBasicMaterial({ map: texture });
    const mesh = new THREE.Mesh(geometries.plane, m);
    mesh.position.set(x, y, z); mesh.rotation.y = yaw; mesh.scale.set(width, height, 1);
    mesh.userData.ownedTexture = texture; mesh.userData.ownedMaterial = m;
    parent.add(mesh); return mesh;
  }

  function clearGroup(group) {
    group.traverse(o => {
      if (o.isInstancedMesh) o.dispose();
      o.userData.ownedTexture?.dispose(); o.userData.ownedMaterial?.dispose(); o.userData.ownedGeometry?.dispose();
    });
    group.clear();
  }
  return { geometries, material, batch, sign, clearGroup, dispose() { for (const g of Object.values(geometries)) g.dispose(); for (const m of materials.values()) m.dispose(); materials.clear(); } };
}
