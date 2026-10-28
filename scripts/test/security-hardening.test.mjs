/* Audit fixes (audit/security-headers), the site's side: a VR tag's label is
   escaped by the engine itself (finding 5), the person sheet paints a
   member's banner through an intact style attribute (finding 6), the
   third-party scripts the globe pages load are pinned by hash and fetched
   with CORS (finding 4a, 4c), and supabase-js is a pinned file of our own
   rather than whatever esm.sh serves next (finding 4b). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const read = (p) => readFile(new URL('../../' + p, import.meta.url), 'utf8');

test('vr360 escapes a tag\'s label itself, and does not escape an already escaped one twice', async () => {
  const src = await read('js/vr360.js');
  assert.match(src, /el\.innerHTML = "<i><\/i><span>" \+ esc\(s\.label\) \+ "<\/span>";/);
  assert.doesNotMatch(src, /"<span>" \+ s\.label/);
  const fn = src.match(/function esc\(t\) \{[\s\S]*?\n    \}\n/)[0];
  const esc = vm.runInNewContext('(' + fn.replace(/^function esc/, 'function') + ')');
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc('Rock & Roll "live" \'86'), 'Rock &amp; Roll &quot;live&quot; &#39;86');
  assert.equal(esc('Rock &amp; Roll &quot;live&quot; &#39;86'), 'Rock &amp; Roll &quot;live&quot; &#39;86', 'js/main.js vrSpots escaped it already: unchanged');
  assert.equal(esc('&lt;b&gt; &copy;'), '&lt;b&gt; &amp;copy;', 'text either way, never markup');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('the person sheet paints a member\'s banner and avatar through a quoted CSS url inside an intact style attribute', async () => {
  const src = await read('js/mnet.js');
  assert.doesNotMatch(src, /style=\\?"background-image:url\('\+JSON\.stringify/, 'JSON.stringify\'s quotes end a double-quoted attribute early');
  const bannerExpr = src.match(/\(banner\?' style="background-image:url\(\\''\+esc\(banner\.replace\(\/'\/g,'%27'\)\)\+'\\'\)"':''\)/)?.[0];
  const avatarExpr = src.match(/avatar\?'style="background-image:url\(\\''\+esc\(avatar\.replace\(\/'\/g,'%27'\)\)\+'\\'\)"':""/)?.[0];
  assert.ok(bannerExpr, 'the hero banner');
  assert.ok(avatarExpr, 'the avatar');
  /* mnet.js's own escaper, on a URL exactly as safeHttpUrl returns it (new URL().href) */
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const banner = new URL('https://cdn.example/it\'s)".png?x=1&y=2').href;
  assert.equal(banner, 'https://cdn.example/it\'s)%22.png?x=1&y=2', 'the URL parser keeps a quote and a paren in the path');
  const html = vm.runInNewContext(bannerExpr, { banner, esc });
  assert.equal(html, ' style="background-image:url(\'https://cdn.example/it%27s)%22.png?x=1&amp;y=2\')"');
  const avatarHtml = vm.runInNewContext(avatarExpr, { avatar: banner, esc });
  assert.equal(avatarHtml, 'style="background-image:url(\'https://cdn.example/it%27s)%22.png?x=1&amp;y=2\')"');
  assert.equal(vm.runInNewContext(bannerExpr, { banner: '', esc }), '', 'no banner, no attribute');
});

test('the Cesium and model-viewer tags are pinned by hash and fetched with CORS, the same hash for the same file on every page', async () => {
  const seen = new Map();
  for (const page of ['action-globe.html', 'guest-globe.html', 'world-news.html', '_unfinished/asset-lab.html']) {
    const html = await read(page);
    const tags = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="(https:\/\/(?:cesium\.com|ajax\.googleapis\.com)[^"]+)"[^>]*>/g)];
    assert.ok(tags.length, `${page} loads a third-party file`);
    for (const [tag, url] of tags) {
      const integrity = tag.match(/\bintegrity="(sha384-[A-Za-z0-9+/]{64})"/);
      assert.ok(integrity, `${page}: ${url} carries a sha384`);
      assert.match(tag, /\bcrossorigin="anonymous"/, `${page}: ${url} is fetched with CORS, as SRI requires`);
      if (seen.has(url)) assert.equal(seen.get(url), integrity[1], `${page}: ${url} is the same file everywhere`);
      seen.set(url, integrity[1]);
    }
  }
  assert.deepEqual([...seen.keys()].sort(), [
    'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js',
    'https://cesium.com/downloads/cesiumjs/releases/1.131/Build/Cesium/Cesium.js',
    'https://cesium.com/downloads/cesiumjs/releases/1.131/Build/Cesium/Widgets/widgets.css'
  ]);
});

test('supabase-js is pinned and self-hosted: the modules import the vendored file, which is byte-identical to the source its header names', async () => {
  for (const f of ['js/music-creator-studio.js', 'js/mccluster-creator-account.js', 'js/mccluster-public-profile.js']) {
    const src = await read(f);
    assert.match(src, /^import \{ ?createClient ?\} from ["']\.\.\/vendor\/supabase-js-2\.57\.0\.mjs["'];/m, f);
    assert.doesNotMatch(src, /esm\.sh/, f);
  }
  const vendored = await read('vendor/supabase-js-2.57.0.mjs');
  const [header, ...rest] = vendored.split('\n');
  const body = rest.join('\n');
  assert.match(header, /^\/\* @supabase\/supabase-js 2\.57\.0 \(MIT: vendor\/LICENSES\/supabase-js-MIT\.txt\)/);
  assert.match(header, /https:\/\/esm\.sh\/@supabase\/supabase-js@2\.57\.0\/es2022\/supabase-js\.bundle\.mjs/, 'the header names its source');
  const sha = header.match(/sha256 ([0-9a-f]{64})/)[1];
  assert.equal(createHash('sha256').update(body).digest('hex'), sha, 'everything after the header is the file the header describes');
  /* self-contained: Node resolves a bare or absolute specifier (`ws`, `/node/process.mjs`) against the
     filesystem and fails, so a successful import below proves no import leaves the file (the text itself
     is no proof: realtime-js carries `import ws from "ws"` inside an error message) */
  assert.match(await read('vendor/LICENSES/supabase-js-MIT.txt'), /MIT License[\s\S]*Copyright \(c\) 2020 Supabase/);
  const mod = await import(new URL('../../vendor/supabase-js-2.57.0.mjs', import.meta.url));
  assert.equal(typeof mod.createClient, 'function');
});
