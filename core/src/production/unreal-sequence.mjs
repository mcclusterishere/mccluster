/* ============================================================
   UNREAL SEQUENCE MODE — render an approved Level Sequence in an
   approved Unreal project, through the in-editor Movie Render Queue.

   Why this path: on Prime (UE 5.8.4, AMD Radeon, D3D12) the old
   `-game -MoviePipelineConfig=<queue manifest>` launch failed while
   parsing its queue manifest; the local in-editor queue (PIE executor)
   rendered s31 correctly. This mode reuses that execution path:
   UnrealEditor.exe opens the project, tools/production/unreal/
   mcc_render_sequence.py builds the queue in memory (no manifest file)
   and runs it with the PIE executor, writes a result file and quits.

   What a job may name: two ids (unreal.project_id, unreal.sequence_id)
   and the shot range. Everything else comes from the machine owner's
   registry in the executor config:

     "unreal_projects": {
       "<project id>": {
         "production_project": "get-it-back",
         "uproject": "C:\\...\\Proof\\Proof.uproject",     (absolute; never written)
         "isolate": "copy",                                  (render a per-job copy)
         "rhi": "d3d12",
         "require_adapter": "Radeon",                        (substring of the GPU name)
         "render_offscreen": false,
         "sequences": {
           "<sequence id>": {
             "map": "/Game/Proof/S31_Map",
             "sequence": "/Game/Proof/S31_Seq",
             "shot_ids": ["s31"],
             "frame_start": 0, "frame_end": 119,
             "settings": { "spatial_samples": 1, "temporal_samples": 1,
                           "engine_warmup_count": 0, "render_warmup_count": 0 }
           }
         }
       }
     }

   Success is never "the editor exited". It is: the script's result says
   the executor finished successfully, the fresh output folder holds the
   expected number of contiguous frames, the engine's own log shows the
   required GPU on the required RHI (no software or basic adapter), the
   approved project is unchanged, and the encoded preview decodes with
   the expected frame count and duration.
   ============================================================ */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { UNREAL_ID } from './contract.mjs';

export const UNREAL_SEQUENCE_ADAPTER = 'mccluster-unreal-sequence/1';
export const UNREAL_RENDER_RESULT_SCHEMA = 'mccluster-unreal-render-result/1';
export const SUPPORTED_RHIS = Object.freeze(['d3d12']);
const OBJECT_PATH = /^\/Game\/[A-Za-z0-9_][A-Za-z0-9_/-]{0,200}(?:\.[A-Za-z0-9_]{1,120})?$/;
const SETTINGS = Object.freeze({
  spatial_samples: [1, 64],
  temporal_samples: [1, 64],
  engine_warmup_count: [0, 240],
  render_warmup_count: [0, 240]
});
// Never copied into a job's project copy: caches and logs the editor
// regenerates. Content, Config, Plugins, Binaries and the .uproject are.
const COPY_EXCLUDE = new Set(['Saved', 'Intermediate', 'DerivedDataCache']);

export class UnrealRegistryError extends Error {
  constructor(message) { super(message); this.code = 'CONFIG_INVALID'; this.status = 500; }
}

/* ---------- the owner's registry ---------- */

export function loadUnrealRegistry(raw = {}, { platform = process.platform } = {}) {
  const out = {};
  if (raw == null) return out;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new UnrealRegistryError('unreal_projects must be an object');
  const abs = platform === 'win32' ? path.win32.isAbsolute : path.isAbsolute;
  for (const [id, entry] of Object.entries(raw)) {
    if (!UNREAL_ID.test(id)) throw new UnrealRegistryError(`unreal project id ${id} is invalid`);
    if (!entry || typeof entry !== 'object') throw new UnrealRegistryError(`unreal project ${id} must be an object`);
    if (typeof entry.uproject !== 'string' || !abs(entry.uproject) || !/\.uproject$/i.test(entry.uproject)) throw new UnrealRegistryError(`unreal project ${id}: uproject must be an absolute path to a .uproject`);
    if (typeof entry.production_project !== 'string' || !entry.production_project) throw new UnrealRegistryError(`unreal project ${id}: production_project is required`);
    const rhi = String(entry.rhi || 'd3d12').toLowerCase();
    if (!SUPPORTED_RHIS.includes(rhi)) throw new UnrealRegistryError(`unreal project ${id}: rhi must be one of ${SUPPORTED_RHIS.join(', ')}`);
    const isolate = entry.isolate == null ? 'copy' : String(entry.isolate);
    if (!['copy', 'none'].includes(isolate)) throw new UnrealRegistryError(`unreal project ${id}: isolate must be copy or none`);
    const requireAdapter = entry.require_adapter == null ? null : String(entry.require_adapter).trim();
    if (requireAdapter !== null && !/^[A-Za-z0-9 ()._-]{2,80}$/.test(requireAdapter)) throw new UnrealRegistryError(`unreal project ${id}: require_adapter is invalid`);
    const sequences = {};
    for (const [sid, seq] of Object.entries(entry.sequences || {})) {
      if (!UNREAL_ID.test(sid)) throw new UnrealRegistryError(`sequence id ${sid} is invalid`);
      if (!OBJECT_PATH.test(String(seq?.map || ''))) throw new UnrealRegistryError(`sequence ${sid}: map must be a /Game/ object path`);
      if (!OBJECT_PATH.test(String(seq?.sequence || ''))) throw new UnrealRegistryError(`sequence ${sid}: sequence must be a /Game/ object path`);
      const shotIds = Array.isArray(seq.shot_ids) ? seq.shot_ids.map(String) : [];
      if (!shotIds.length) throw new UnrealRegistryError(`sequence ${sid}: shot_ids must list the shots it may render`);
      const range = [seq.frame_start, seq.frame_end];
      if (!range.every(Number.isInteger) || range[1] < range[0]) throw new UnrealRegistryError(`sequence ${sid}: frame_start and frame_end must be integers with end >= start`);
      const settings = {};
      for (const [key, value] of Object.entries(seq.settings || {})) {
        const bound = SETTINGS[key];
        if (!bound) throw new UnrealRegistryError(`sequence ${sid}: setting ${key} is not one the adapter applies`);
        if (!Number.isInteger(value) || value < bound[0] || value > bound[1]) throw new UnrealRegistryError(`sequence ${sid}: ${key} must be an integer ${bound[0]}..${bound[1]}`);
        settings[key] = value;
      }
      sequences[sid] = { map: seq.map, sequence: seq.sequence, shotIds, frameStart: range[0], frameEnd: range[1], settings };
    }
    if (!Object.keys(sequences).length) throw new UnrealRegistryError(`unreal project ${id} approves no sequence`);
    out[id] = { id, productionProject: entry.production_project, uproject: path.resolve(entry.uproject), isolate, rhi, requireAdapter, renderOffscreen: entry.render_offscreen === true, sequences };
  }
  return out;
}

// The job's ids against the registry. Throws a final (non-retryable)
// refusal for anything the owner did not approve on this machine.
export function resolveApprovedSequence(registry, manifest) {
  const refuse = (message) => Object.assign(new Error(message), { code: 'UNREAL_NOT_APPROVED', status: 422, retryable: false });
  const project = registry[manifest.unreal?.project_id];
  if (!project) throw refuse(`Unreal project ${manifest.unreal?.project_id} is not approved on this node`);
  if (project.productionProject !== manifest.project_id) throw refuse(`Unreal project ${project.id} is not approved for production project ${manifest.project_id}`);
  const sequence = project.sequences[manifest.unreal.sequence_id];
  if (!sequence) throw refuse(`sequence ${manifest.unreal.sequence_id} is not approved in Unreal project ${project.id}`);
  if (!sequence.shotIds.includes(manifest.shot_id)) throw refuse(`sequence ${manifest.unreal.sequence_id} is not approved for shot ${manifest.shot_id}`);
  if (manifest.frames.start < sequence.frameStart || manifest.frames.end > sequence.frameEnd) throw refuse(`frames ${manifest.frames.start}-${manifest.frames.end} are outside the approved range ${sequence.frameStart}-${sequence.frameEnd}`);
  return { project, sequence };
}

/* ---------- the device, from the engine's own log ---------- */

const SOFTWARE_ADAPTER = /Microsoft Basic Render|Basic Display|WARP|SwiftShader|llvmpipe|lavapipe|Software Rasterizer/i;
const SOFTWARE_VENDORS = new Set(['0x1414']); // Microsoft (WARP / Basic Render Driver)

// Reads the lines a UE 5 editor writes about its RHI and GPU. The exact
// wording differs between versions, so several forms are accepted; when
// none is found the device is unknown and the render does not pass.
export function parseUnrealLog(text = '') {
  const lines = String(text).split(/\r?\n/);
  const evidence = [];
  const keep = (line) => { if (evidence.length < 12 && !evidence.includes(line.trim())) evidence.push(line.trim().slice(0, 300)); };
  let engineVersion = null; let rhi = null; let adapter = null; let vendor = null; let driver = null;
  const adapters = new Map(); let chosen = null; let nullRhi = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let m;
    if (!engineVersion && (m = line.match(/LogInit:.*Engine Version:\s*([0-9]+\.[0-9]+\.[0-9]+[^\s]*)/))) { engineVersion = m[1]; keep(line); }
    if ((m = line.match(/Found D3D12 adapter\s+(\d+):\s*(.+?)\s*\(VendorId:\s*(0x[0-9a-fA-F]+|[0-9a-fA-F]{4})/))) {
      adapters.set(m[1], { name: m[2].trim(), vendor: normalizeVendor(m[3]) }); keep(line);
    }
    if ((m = line.match(/Chosen D3D12 Adapter(?: Id)?\s*[=:]\s*(\d+)/i))) { chosen = m[1]; keep(line); }
    if (/Creating D3D12 RHI|D3D12RHI.*Using D3D12|Selected (?:Dynamic )?RHI.*D3D12|RHI:\s*D3D12|Using D3D12 RHI/i.test(line)) { rhi = rhi || 'D3D12'; keep(line); }
    if (/Creating Vulkan RHI|LogVulkanRHI.*Using Vulkan|Selected (?:Dynamic )?RHI.*Vulkan/i.test(line)) { rhi = rhi || 'Vulkan'; keep(line); }
    if (/NullDrv|Using Null RHI|Selected (?:Dynamic )?RHI.*Null|-nullrhi/i.test(line)) { nullRhi = true; keep(line); }
    if (/RHI Adapter Info:/i.test(line)) {
      keep(line);
      for (let j = i + 1; j < Math.min(lines.length, i + 8); j += 1) {
        const info = lines[j];
        if ((m = info.match(/\bName\s*:\s*(.+)$/))) { adapter = adapter || m[1].trim(); keep(info); }
        else if ((m = info.match(/Driver Version\s*:\s*(.+)$/))) { driver = driver || m[1].trim(); keep(info); }
      }
    }
    if (!adapter && (m = line.match(/(?:GPU|Adapter)\s+Name\s*[:=]\s*(.+)$/i))) { adapter = m[1].trim(); keep(line); }
    if (!driver && (m = line.match(/Driver Version\s*[:=]\s*(.+)$/i))) { driver = m[1].trim(); }
  }
  const picked = (chosen && adapters.get(chosen)) || (adapters.size === 1 ? [...adapters.values()][0] : null);
  if (picked) { adapter = adapter || picked.name; vendor = picked.vendor; }
  else if (adapter && adapters.size) for (const a of adapters.values()) if (a.name === adapter) vendor = a.vendor;
  if (nullRhi) rhi = 'Null';
  const software = Boolean((adapter && SOFTWARE_ADAPTER.test(adapter)) || (vendor && SOFTWARE_VENDORS.has(vendor)) || nullRhi);
  return { engine_version: engineVersion, rhi, adapter, vendor_id: vendor, driver, software, evidence };
}

function normalizeVendor(value) {
  const hex = String(value).toLowerCase().replace(/^0x/, '');
  return `0x${hex.padStart(4, '0')}`;
}

export function verifyDevice(device, { rhi = 'd3d12', requireAdapter = null } = {}) {
  const reasons = [];
  if (!device.rhi) reasons.push('the log names no RHI');
  else if (device.rhi.toLowerCase() !== rhi) reasons.push(`rendered on ${device.rhi}, not ${rhi.toUpperCase()}`);
  if (!device.adapter) reasons.push('the log names no GPU adapter');
  if (device.software) reasons.push(`software or basic adapter (${device.adapter || device.rhi}): no CPU fallback is accepted`);
  if (requireAdapter && device.adapter && !device.adapter.toLowerCase().includes(requireAdapter.toLowerCase())) reasons.push(`adapter ${device.adapter} is not the required ${requireAdapter}`);
  const pass = reasons.length === 0;
  return { pass, detail: pass ? `${device.adapter} via ${device.rhi}${device.driver ? `, driver ${device.driver}` : ''}` : reasons.join('; '), measured: { rhi: device.rhi, adapter: device.adapter, vendor_id: device.vendor_id, driver: device.driver, engine_version: device.engine_version } };
}

/* ---------- the approved project, left as it was ---------- */

// A fingerprint of everything the copy carries: relative path, size and
// modification time of each file outside the regenerated caches.
export function projectFingerprint(projectDir, { fsImpl = fs } = {}) {
  const entries = [];
  const walk = (dir, rel) => {
    for (const name of fsImpl.readdirSync(dir).sort()) {
      if (!rel && COPY_EXCLUDE.has(name)) continue;
      const full = path.join(dir, name);
      const stat = fsImpl.statSync(full);
      const relPath = rel ? `${rel}/${name}` : name;
      if (stat.isDirectory()) walk(full, relPath);
      else entries.push(`${relPath}\t${stat.size}\t${Math.round(stat.mtimeMs)}`);
    }
  };
  walk(projectDir, '');
  return { files: entries.length, sha256: crypto.createHash('sha256').update(entries.join('\n')).digest('hex') };
}

export function copyProject(projectDir, destDir, { fsImpl = fs } = {}) {
  fsImpl.mkdirSync(destDir, { recursive: true });
  for (const name of fsImpl.readdirSync(projectDir)) {
    if (COPY_EXCLUDE.has(name)) continue;
    fsImpl.cpSync(path.join(projectDir, name), path.join(destDir, name), { recursive: true, preserveTimestamps: true, errorOnExist: false, force: true });
  }
}

/* ---------- a fresh output folder per run ---------- */

export function freshOutputDir(root, manifest, jobId, { now = new Date(), fsImpl = fs } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const base = path.join(root, 'renders', 'unreal', manifest.shot_id, `t${String(manifest.take).padStart(3, '0')}-${jobId.slice(0, 8)}-${stamp}`);
  let dir = base;
  for (let n = 2; fsImpl.existsSync(dir); n += 1) dir = `${base}-${n}`;
  fsImpl.mkdirSync(path.join(dir, 'frames'), { recursive: true });
  return dir;
}

// The frames the queue wrote: one contiguous numbered run of PNGs.
export function frameRun(files) {
  const parsed = files.map((name) => name.match(/^(.*?)(\d+)\.png$/i)).filter(Boolean)
    .map((m) => ({ prefix: m[1], digits: m[2].length, n: Number.parseInt(m[2], 10), name: m[0] }))
    .sort((a, b) => a.n - b.n);
  if (!parsed.length) return { count: 0, contiguous: false, pattern: null, start: null };
  const { prefix, digits } = parsed[0];
  const same = parsed.every((p) => p.prefix === prefix && p.digits === digits);
  const contiguous = same && parsed.every((p, i) => p.n === parsed[0].n + i);
  return { count: parsed.length, contiguous, pattern: `${prefix}%0${digits}d.png`, start: parsed[0].n, first: parsed[0].name, last: parsed.at(-1).name };
}

// The editor command line: fixed flags only. Nothing from a job reaches
// it except the job file path the adapter wrote.
export function editorArgs({ uproject, script, abslog, rhi = 'd3d12', renderOffscreen = false }) {
  const args = [uproject, `-ExecutePythonScript=${script}`, `-${rhi}`, '-unattended', '-nosplash', '-NoSound', '-NoLoadingScreen', '-log', `-abslog=${abslog}`];
  if (renderOffscreen) args.push('-RenderOffscreen');
  return args;
}
