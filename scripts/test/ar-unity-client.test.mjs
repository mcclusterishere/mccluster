/* THE AR CLIENT CONTRACT: the Unity project under ar/ stays a client of the plane.

     node --test scripts/test/ar-unity-client.test.mjs

   It cannot run Unity (no licence in CI, AGENTS.md hard rule 2 keeps heavy builds off feature
   branches). It checks what can be checked without the Editor: the bundled storefront snapshot
   still matches the canonical city manifest, the printed marker still matches its generator and
   the size the app tracks, the project pins exact versions, nothing private is published, and
   the C# never grows a backend, a credential, or a colour the owner has ruled out. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBusinessExport, comparable, outPath, SOURCE, DEFAULT_ID } from '../../tools/ar/export-business.mjs';
import { MARKER, PNG_PATH, PDF_PATH, markerPixels, scanlines } from '../../tools/ar/generate-marker.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const walk = (dir) => readdirSync(join(ROOT, dir)).flatMap((n) => {
  const rel = `${dir}/${n}`;
  return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
});

test('the bundled storefront snapshot matches the canonical city manifest', () => {
  const manifestBytes = readFileSync(join(ROOT, SOURCE));
  const fresh = buildBusinessExport(manifestBytes, DEFAULT_ID);
  const committed = JSON.parse(readFileSync(outPath(DEFAULT_ID, ROOT), 'utf8'));
  assert.deepEqual(comparable(committed), comparable(fresh),
    `ar/ snapshot drifted from ${SOURCE}: run node tools/ar/export-business.mjs --id ${DEFAULT_ID}`);

  // The owner's decisions for the first storefront, read back from the manifest rather than restated.
  const m = JSON.parse(manifestBytes);
  const b = m.businesses.find((x) => x.id === 'gauranfucking-tea');
  assert.equal(committed.business.name, b.name);
  assert.equal(committed.business.name, 'GAURANFUCKING TEA');
  assert.equal(committed.business.tagline, "We guarantee you'll like it, or else fuck you.");
  assert.equal(committed.business.color, b.color);
  assert.deepEqual(committed.staff.map((s) => s.id), b.staffIds);
  assert.deepEqual(committed.staff.map((s) => s.name).sort(), ['Eli Mensah', 'Lin Qiao', 'Mara Costa']);
  assert.equal(committed.source.path, SOURCE);
  assert.match(committed.source.sha256, /^[0-9a-f]{64}$/);
});

test('the exporter resolves expansion businesses too, and refuses unknown ids', () => {
  const bytes = readFileSync(join(ROOT, SOURCE));
  const m = JSON.parse(bytes);
  const expansion = (m.expansionBusinesses || [])[0];
  if (expansion) assert.equal(buildBusinessExport(bytes, expansion.id).business.id, expansion.id);
  assert.throws(() => buildBusinessExport(bytes, 'no-such-business'), /No business/);
});

test('the printed marker is the generated pattern at the size the app tracks', () => {
  const png = readFileSync(join(ROOT, PNG_PATH));
  assert.equal(png.readUInt32BE(16), png.readUInt32BE(20), 'marker must be square');
  const { px, size } = markerPixels();
  assert.equal(png.readUInt32BE(16), size);
  // Concatenate IDAT chunks and compare decoded scanlines (zlib byte output may differ across Node versions).
  const idat = [];
  for (let o = 8; o < png.length;) {
    const len = png.readUInt32BE(o), type = png.toString('latin1', o + 4, o + 8);
    if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  assert.ok(inflateSync(Buffer.concat(idat)).equals(scanlines(px, size)), 'marker PNG differs from tools/ar/generate-marker.mjs');

  const pdf = readFileSync(join(ROOT, PDF_PATH)).toString('latin1');
  assert.match(pdf, /\/MediaBox \[0 0 612 792\]/);
  const edgePt = ((MARKER.physicalMeters * 1000 * 72) / 25.4).toFixed(2);
  assert.ok(pdf.includes(`q ${edgePt} 0 0 ${edgePt} `), 'PDF must print the marker at physicalMeters');

  const setup = read('ar/Assets/McCluster/Editor/McClusterArSetup.cs');
  assert.ok(setup.includes(`MarkerMeters = ${MARKER.physicalMeters}f`), 'reference library size must equal the printed size');
  assert.ok(setup.includes(`"${MARKER.name}"`));
  assert.ok(read('ar/Assets/McCluster/Runtime/ImageMarkerAnchorProvider.cs').includes(`"${MARKER.name}"`));
});

test('the Unity project pins an exact editor and exact AR package versions', () => {
  const version = read('ar/ProjectSettings/ProjectVersion.txt');
  assert.match(version, /^m_EditorVersion: 6000\.\d+\.\d+f\d+$/m);
  const deps = JSON.parse(read('ar/Packages/manifest.json')).dependencies;
  for (const pkg of ['com.unity.xr.arfoundation', 'com.unity.xr.arkit', 'com.unity.xr.arcore'])
    assert.match(deps[pkg] || '', /^\d+\.\d+\.\d+$/, `${pkg} must be pinned to an exact version`);
  assert.equal(deps['com.unity.xr.arkit'], deps['com.unity.xr.arfoundation'], 'ARKit plug-in tracks AR Foundation');
  assert.equal(deps['com.unity.xr.arcore'], deps['com.unity.xr.arfoundation'], 'ARCore plug-in tracks AR Foundation');
  for (const [name, ver] of Object.entries(deps)) {
    assert.ok(!/lightship|niantic|8thwall/i.test(name), `retired hosted platform package ${name}`);
    assert.ok(!/^(https?:|git)/.test(ver), `${name} must come from the Unity registry; ARCore Extensions is an optional later install`);
  }
});

test('Unity output and private material stay out of Git, Pages and the Worker', () => {
  const ignore = read('ar/.gitignore');
  for (const p of ['/[Ll]ibrary/', '/[Tt]emp/', '/[Bb]uilds/', '/[Ll]ogs/', '/[Uu]ser[Ss]ettings/', '*.keystore', '*.p12', '*.mobileprovision'])
    assert.ok(ignore.includes(p), `ar/.gitignore must ignore ${p}`);
  assert.ok(!/^\*\.meta$/m.test(ignore), '.meta files must be committed, not ignored');

  const workflow = read('.github/workflows/deploy-pages.yml');
  const strip = workflow.split('\n').map((l) => l.trim()).find((l) => l.startsWith('rm -rf '));
  assert.ok(strip.split(/\s+/).includes('ar'), 'deploy-pages.yml must strip ar/ before gh-pages');
  assert.ok(workflow.includes('/ar/README.md'), 'the private-path probe must check ar/');
  assert.ok(!read('workers/mccluster/wrangler.toml').includes('ar/'), 'the Worker never bundles the AR client');
});

test('the C# is a client: no new backend, no credential, no invented route, no purple', () => {
  const files = walk('ar/Assets/McCluster').filter((f) => f.endsWith('.cs') || f.endsWith('.shader'));
  assert.ok(files.length >= 10, 'expected the AR runtime, editor and shader sources');
  const hosts = new Set();
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) hosts.add(m[1].toLowerCase());
    assert.ok(!/AIza[0-9A-Za-z_-]{20,}|sb_secret_|sk_live_|service_role/.test(src), `${f} carries a credential`);
    assert.ok(!/mccluster-core/.test(src), `${f} names a Worker that does not exist`);
    // Purple/violet/magenta hues are ruled out for the city; check every #rrggbb and Color32 literal.
    const hexes = [...src.matchAll(/#([0-9a-f]{6})\b/gi)].map((m) => m[1]);
    const c32 = [...src.matchAll(/Color32\(\s*0x([0-9a-f]{2}),\s*0x([0-9a-f]{2}),\s*0x([0-9a-f]{2})/gi)].map((m) => m.slice(1).join(''));
    for (const hex of [...hexes, ...c32]) {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const purple = b > g + 24 && r > g + 24;
      assert.ok(!purple, `${f} uses a purple colour #${hex}`);
    }
  }
  const allowed = ['api.mccluster.org', 'zmnhbrjyhxzhkxmhkexs.supabase.co', 'matthew.mccluster.org'];
  for (const h of hosts) assert.ok(allowed.includes(h), `the AR client talks to ${h}, which is not the plane`);

  const api = read('ar/Assets/McCluster/Runtime/McClusterApi.cs');
  // Every Worker path the client names must exist in the Worker source.
  const worker = walk('workers/mccluster/src').filter((f) => f.endsWith('.js')).map(read).join('\n');
  for (const m of api.matchAll(/ApiOrigin \+ "(\/v1\/[a-z/-]+)/g)) {
    const prefix = m[1].split('/').slice(0, 3).join('/');
    assert.ok(worker.includes(`'${prefix}`) || worker.includes(`"${prefix}`) || worker.includes(`\`${prefix}`), `${m[1]} is not a Worker route`);
  }
  for (const m of api.matchAll(/rpc\/([a-z_]+)/g))
    assert.ok(existsSync(join(ROOT, 'js/action.js')) && (read('js/action.js') + read('js/action-globe.js')).includes(m[1]), `RPC ${m[1]} is not used by the web client`);
  assert.match(api, /SpatialCaptureSubmit = null/, 'spatial capture upload has no route yet and must say so');
});

test('captures are clean camera frames with honest depth provenance', () => {
  const cap = read('ar/Assets/McCluster/Runtime/CaptureSession.cs');
  assert.match(cap, /TryAcquireLatestCpuImage/, 'frames come from the CPU camera image');
  assert.ok(!/ReadPixels|ScreenCapture|RenderTexture/.test(cap), 'frames must never be read back from the rendered screen');
  const manifest = read('ar/Assets/McCluster/Runtime/CaptureManifestV1.cs');
  for (const v of ['sensor-lidar', 'estimated', 'none']) assert.ok(cap.includes(`"${v}"`) || manifest.includes(v), `depth source ${v}`);
  assert.match(manifest, /TODO\(capture-contract\)/, 'reconcile with the canonical CaptureManifestV1 when it lands');
  const hud = read('ar/Assets/McCluster/Runtime/ArHud.cs');
  assert.match(hud, /Reality view/, 'the reality-view toggle is always drawn');
});

// Source-level lifecycle guard only; Unity/device permission behaviour still needs its pilot test.
test('location startup cannot outlive capture consent', () => {
  const cap = read('ar/Assets/McCluster/Runtime/CaptureSession.cs');
  const start = cap.slice(cap.indexOf('public void StartCapture('), cap.indexOf('public void StopCapture('));
  assert.ok(start.indexOf('IsCapturing = true') < start.indexOf('StartCoroutine(StartLocation())'));
  const stop = cap.slice(cap.indexOf('public void StopCapture('), cap.indexOf('IEnumerator StartLocation('));
  assert.match(stop, /StopCoroutine\(m_LocationStartup\)/);
  assert.match(stop, /m_LocationStartup = null/);
  assert.match(stop, /Input\.location\.status != LocationServiceStatus\.Stopped/);
  const location = cap.slice(cap.indexOf('IEnumerator StartLocation('), cap.indexOf('void OnFrame('));
  assert.match(location, /if \(!IsCapturing \|\| !Input\.location\.isEnabledByUser\) yield break;/);
  assert.ok(location.indexOf('if (!IsCapturing') > location.indexOf('yield return'));
  assert.ok(location.indexOf('if (!IsCapturing') < location.indexOf('Input.location.Start('));
});
