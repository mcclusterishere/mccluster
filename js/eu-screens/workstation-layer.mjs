/* Authored workstation display layer shared by building views. No proxy geometry,
   placement guesses, boot advancement, or live-device access. The asset is absolute
   building feet, Z-up. A containing frame may adapt the viewer, never a device. */
import { monitorVisualState } from './monitor-visual-state.mjs';

export const WORKSTATION_FILE = 'equity-uprise-workstations-v1.glb';
export const WORKSTATION_URL = '/equity-uprise-preview/' + WORKSTATION_FILE;
export const DEVICE_CATALOG_URL = '/equity-uprise-preview/equity-uprise-device-components-v1.json';
export const authoredName = object => object?.userData?.name || object?.name || '';
export function effectivelyVisible(object) {
  for (let node = object; node; node = node.parent) if (node.visible === false) return false;
  return !!object;
}
export function workstationFloor(id) {
  if (/^B1-/.test(id)) return 'B1';
  const floor = /^(F[1-6])-/.exec(id);
  return floor?.[1] || null;
}
export function workstationCatalog(catalog) {
  const components = new Map();
  for (const record of catalog?.devices || []) {
    if (!['workstation', 'monitor'].includes(record.archetype)) continue;
    for (const component of record.components || []) {
      if (component.mesh_name && workstationFloor(record.asset_id)) {
        components.set(component.mesh_name, { record, component });
      }
    }
  }
  return components;
}
export function prepareWorkstationRoot(root, catalog, { metresPerWorldUnit = 1, origin = [0, 0, 0] } = {}) {
  if (!(metresPerWorldUnit > 0)) throw new Error('Invalid workstation frame scale');
  const components = workstationCatalog(catalog), meshes = [], assets = new Set(), seen = new Set();
  let duplicate = false;
  root.traverse(object => {
    if (!object.isMesh) return;
    const name = authoredName(object), match = components.get(name);
    // A wrong/old asset cannot expose outlets, cabling, racks or security equipment.
    object.visible = !!match && (object.userData.euAuthoredVisible ?? object.visible !== false);
    if (!match) return;
    if (seen.has(name)) duplicate = true;
    seen.add(name);
    const { record, component } = match;
    object.name = name; // GLTFLoader sanitizes colons; retain the original ID.
    Object.assign(object.userData, {
      assetId: record.asset_id, componentId: component.component_id,
      euAssemblyFloor: workstationFloor(record.asset_id), euPhysicalAssembly: true,
      euAuthoredVisible: object.visible, euDeviceRecord: record,
    });
    meshes.push(object); assets.add(record.asset_id);
  });
  const expected = new Set([...components.values()].map(({ record }) => record.asset_id));
  if (!expected.size || [...expected].some(id => !assets.has(id)) || [...components.keys()].some(name => !seen.has(name))) throw new Error('Workstation model is incomplete');
  if (duplicate) throw new Error('Workstation model has duplicate components');
  root.scale.setScalar(0.3048 / metresPerWorldUnit);
  root.rotation.x = -Math.PI / 2;
  root.position.set(...origin); // frame origin only; absolute FFE is already in the GLB.
  root.userData.euWorkstationMeshes = meshes;
  root.updateMatrixWorld(true);
  return root;
}
export function syncWorkstationVisibility(root, { floorVisible = () => false, fullElectronicsVisible = false } = {}) {
  if (!root) return 0;
  root.visible = !fullElectronicsVisible;
  const assets = new Set();
  for (const mesh of root.userData.euWorkstationMeshes || []) {
    mesh.visible = mesh.userData.euAuthoredVisible && !!floorVisible(mesh.userData.euAssemblyFloor);
    if (effectivelyVisible(mesh)) assets.add(mesh.userData.assetId);
  }
  return assets.size;
}
export function paintWorkstationMonitors(root, registry, fleet = null) {
  const screens = new Map((registry?.screens || []).filter(s => s.asset_type === 'monitor').map(s => [s.asset_id, s]));
  for (const mesh of root?.userData.euWorkstationMeshes || []) {
    if (mesh.userData.componentId !== 'DISPLAY_PANEL') continue;
    const state = monitorVisualState(fleet, screens.get(mesh.userData.assetId));
    if (!mesh.userData.euMonitorMaterial) {
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(m => m.clone()) : mesh.material.clone();
      mesh.userData.euMonitorMaterial = true;
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      material.color?.setHex(state.color); material.emissive?.setHex(state.color);
      if ('emissiveIntensity' in material) material.emissiveIntensity = state.emission;
    }
    mesh.userData.euMonitorState = state.state;
    mesh.userData.euMonitorLabel = 'Sandbox: ' + state.label;
  }
}
// Coalesces loads. A rejected asset produces explicit unavailable state, not a
// fallback shape. A later user request may retry the same asset safely.
export function createWorkstationLayer({ loadAsset, loadCatalog, onReady = () => {}, onStatus = () => {}, frame = {} }) {
  let root = null, pending = null, status = 'idle';
  return {
    get root() { return root; }, get status() { return status; },
    ensure() {
      if (root) return Promise.resolve(root);
      if (pending) return pending;
      status = 'loading'; onStatus(status);
      pending = Promise.all([loadAsset(), loadCatalog()]).then(async ([gltf, catalog]) => {
        const candidate = prepareWorkstationRoot(gltf.scene, catalog, frame);
        paintWorkstationMonitors(candidate, null); // unknown is dark until sandbox data resolves.
        await onReady(candidate);
        root = candidate; status = 'ready'; onStatus(status); return root;
      }).catch(error => { status = 'unavailable'; onStatus(status, error); throw error; }).finally(() => { pending = null; });
      return pending;
    },
  };
}
export async function fetchWorkstationCatalog(url = DEVICE_CATALOG_URL) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Workstation catalog unavailable: ' + response.status);
  return response.json();
}

/* Standalone floor views use a local metre frame. The outer group subtracts
   Core V2 FFE once; all authored devices retain their full-building coordinates. */
export function mountFloorWorkstations({ THREE, loader, scene, floor, ffeFt, getFloorRoot, onStatus = () => {} }) {
  const frame = new THREE.Group(); frame.name = 'WORKSTATION-FLOOR-FRAME';
  frame.position.y = -ffeFt * .3048; scene.add(frame);
  const layer = createWorkstationLayer({
    loadAsset: () => loader.loadAsync(WORKSTATION_URL), loadCatalog: () => fetchWorkstationCatalog(),
    onStatus,
    onReady(root) {
      frame.add(root);
      syncWorkstationVisibility(root, { floorVisible: lv => lv === floor && effectivelyVisible(getFloorRoot()) });
    },
  });
  async function refresh() {
    if (!layer.root) return;
    paintWorkstationMonitors(layer.root, null);
    try {
      const { openScreenSession } = await import('./sandbox-session.mjs');
      const session = await openScreenSession('WORKPLACE');
      paintWorkstationMonitors(layer.root, session.screens, session.hardware);
    } catch { /* Unknown remains explicitly dark. */ }
  }
  addEventListener('focus', refresh);
  layer.ensure().then(refresh).catch(() => {});
  return layer;
}
