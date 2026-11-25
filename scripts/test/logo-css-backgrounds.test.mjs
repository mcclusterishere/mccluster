/* THE LOGOS ARE NOT YOURS TO DRAW (AGENTS.md): "Do not recolour a supplied mark." "Do not crop supplied artwork. Scale the
   complete supplied artwork proportionally only." A stylesheet can break both without drawing a line: a supplied mark painted
   as a CSS background, then filtered, transformed past its box, blended, positioned outside it, sized to cover it or tiled
   against its edges, is a recoloured or cropped mark. The release review of 2026-11-19 (RS-1) found exactly that on the
   member's Action Record (#mnMissionsView::before: the Equity Uprise emblem on its white tile at 70 %, positioned at 115 % 8 %,
   saturate and contrast filters, scaled 1.035 under overflow hidden, so cut at the right, the top and the bottom).

   This test reads every stylesheet the repository tracks and refuses any rule that paints a supplied mark as a background
   while that background, or a rule reaching the same element (a shared selector list, a :hover or :focus state of it), does
   any of those things. Swapping an <img> for the variant made for its ground (content:url(...)) is not a background and is
   not judged here. The checker is tested on samples first, so a clean run cannot be a checker that sees nothing.
     node --test scripts/test/logo-css-backgrounds.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/* the owner's supplied marks under assets/img (AGENTS.md: the Equity Uprise emblem and its two made variants, the M, the Whip
   Equipped kit, PRIM3, the halo and the favicons made from them) */
const MARK = /assets\/img\/(?:equity-uprise-(?:logo|mark)[\w.-]*|m-mark[\w.-]*|we-(?:logo|icon|mark)[\w.-]*|prim3-(?:logo|mark|emblem)[\w.-]*|hm-mark[\w.-]*|eu-favicon[\w.-]*)/i;

/* every rule of a stylesheet as { selectors, decls }, walking into @media, @supports, @layer and @container */
export function cssRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  (function walk(src) {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open < 0) break;
      let prelude = src.slice(i, open);
      prelude = prelude.slice(prelude.lastIndexOf(';') + 1).replace(/[{}]/g, '').trim();
      let depth = 1, j = open + 1;
      while (j < src.length && depth) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
      const body = src.slice(open + 1, j - 1);
      if (prelude.startsWith('@')) { if (/^@(media|supports|layer|container)\b/i.test(prelude)) walk(body); }
      else if (prelude) out.push({ selectors: prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean), decls: body });
      i = j;
    }
  })(text);
  return out;
}

/* the declarations of a block as [property, value] pairs (a url() may hold a ';' only inside quotes, which the marks never do) */
const declsOf = (body) => body.split(';').map((d) => d.trim()).filter(Boolean).map((d) => { const k = d.indexOf(':'); return k < 0 ? null : [d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim()]; }).filter(Boolean);
/* the element a selector reaches, with its interaction states taken off: a:hover::before reaches what a::before reaches */
const STATES = /:(?:hover|focus|focus-visible|focus-within|active|visited)(?![\w-])/g;
const base = (sel) => sel.replace(STATES, '');

/* what is wrong with painting a mark through these declarations: the empty list is clean */
function problems(decls) {
  const bad = [];
  for (const [prop, value] of decls) {
    const v = value.replace(/!important/i, '').trim().toLowerCase();
    if (prop === 'filter' || prop === '-webkit-filter' || prop === 'backdrop-filter') { if (v !== 'none') bad.push(`${prop}: ${v} recolours it`); }
    else if (prop === 'transform' || prop === 'scale' || prop === 'rotate' || prop === 'translate') { if (v !== 'none') bad.push(`${prop}: ${v} moves or scales it past its box`); }
    else if (prop === 'mix-blend-mode' || prop === 'background-blend-mode') { if (v !== 'normal') bad.push(`${prop}: ${v} recolours it`); }
    else if (prop === 'background-size') { if (/\bcover\b/.test(v)) bad.push('background-size: cover crops it'); for (const p of v.match(/-?[\d.]+%/g) || []) if (parseFloat(p) > 100) bad.push(`background-size ${p} is larger than its box`); }
    else if (prop === 'background-position' || prop === 'background-position-x' || prop === 'background-position-y') {
      for (const p of v.match(/-?[\d.]+%/g) || []) if (parseFloat(p) < 0 || parseFloat(p) > 100) bad.push(`${prop} ${p} puts part of it outside its box`);
      if (/(^|\s)-[\d.]+(px|r?em|vw|vh)\b/.test(v)) bad.push(`${prop} ${v} puts part of it outside its box`);
    }
    else if (prop === 'background-repeat') { if (!/^no-repeat(\s+no-repeat)?$/.test(v)) bad.push(`background-repeat: ${v} tiles it against its edges`); }
    else if (prop === 'background') {
      if (/\bcover\b/.test(v)) bad.push('background: ... cover crops it');
      const pos = v.replace(/url\([^)]*\)/g, ' ');
      for (const p of pos.match(/-?[\d.]+%/g) || []) if (parseFloat(p) < 0 || parseFloat(p) > 100) bad.push(`background position or size ${p} puts part of it outside its box`);
    }
  }
  return bad;
}

/* every place a stylesheet paints a supplied mark as a background, with what is wrong with it */
export function markBackgrounds(sheets) {
  const all = sheets.flatMap(({ file, css }) => cssRules(css).map((r) => ({ file, ...r, list: declsOf(r.decls) })));
  const found = [];
  for (const rule of all) {
    const paint = rule.list.filter(([p, v]) => (p === 'background' || p === 'background-image') && /url\(/i.test(v) && MARK.test(v));
    if (!paint.length) continue;
    for (const sel of rule.selectors) {
      const reach = all.filter((r) => r.selectors.some((s) => base(s) === base(sel)));
      const decls = reach.flatMap((r) => r.list);
      /* a shorthand without no-repeat tiles the mark unless a background-repeat says no-repeat */
      const repeat = decls.filter(([p]) => p === 'background-repeat').map(([, v]) => v.toLowerCase());
      const shorthandRepeats = paint.some(([p, v]) => p === 'background' && !/no-repeat/i.test(v)) && !repeat.some((v) => /^no-repeat/.test(v));
      const imageRepeats = paint.some(([p]) => p === 'background-image') && !decls.some(([p, v]) => (p === 'background-repeat' && /^no-repeat/i.test(v)) || (p === 'background' && /no-repeat/i.test(v)));
      const bad = problems(decls).concat(shorthandRepeats || imageRepeats ? ['the mark tiles against its edges (no no-repeat)'] : []);
      found.push({ file: rule.file, selector: sel, mark: (paint[0][1].match(MARK) || [''])[0], problems: [...new Set(bad)] });
    }
  }
  return found;
}

function trackedSheets() {
  const out = [];
  const skip = new Set(['node_modules', '.git', 'e2e-out', 'vendor']);
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = join(dir, name), s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (name.endsWith('.css')) out.push({ file: relative(ROOT, p), css: readFileSync(p, 'utf8') });
    }
  })(ROOT);
  return out;
}

test('the checker sees what it is for: a filtered, cropped or tiled mark is refused, a whole one is not', () => {
  const sample = (css) => markBackgrounds([{ file: 'sample.css', css }]);
  /* the shape the review found, a shared ::before rule and the mark on one selector of it */
  const review = sample(`.a,#v{position:relative;overflow:hidden}
    .a::before,#v::before{content:"";position:absolute;inset:0;filter:saturate(.8) contrast(1.08);transform:scale(1.035)}
    #v::before{background-image:url("../assets/img/equity-uprise-logo.webp");background-size:70%;background-repeat:no-repeat;background-position:115% 8%;opacity:.09}`);
  assert.equal(review.length, 1);
  assert.match(review[0].problems.join(' | '), /filter: saturate/);
  assert.match(review[0].problems.join(' | '), /transform: scale/);
  assert.match(review[0].problems.join(' | '), /115%/);
  /* a hover state reaches the same element */
  const hover = sample(`.m::before{background:url(../assets/img/m-mark.png) center/40% no-repeat}
    .m:hover::before{transform:scale(1.07)}`);
  assert.match(hover[0].problems.join(' | '), /transform/);
  assert.equal(sample('.t{background:url(assets/img/we-icon.png)}')[0].problems.length, 1, 'a tiled mark');
  assert.match(sample('.c{background:url(assets/img/prim3-logo.png) center/cover no-repeat}')[0].problems.join(), /cover/);
  assert.match(sample('@media (min-width:700px){.d{background-image:url(assets/img/equity-uprise-mark.png);background-repeat:no-repeat;mix-blend-mode:multiply}}')[0].problems.join(), /mix-blend-mode/);
  /* the whole mark, scaled proportionally inside its box, opacity only: allowed */
  assert.deepEqual(sample('.w::after{content:"";position:absolute;inset:0;background:url(assets/img/prim3-logo.png) center/40% no-repeat;opacity:.5}')[0].problems, []);
  /* not a mark, and a content swap of an <img> for its ground's variant: neither is a background */
  assert.deepEqual(sample('.p{background:url(assets/img/heal-the-3-cover.jpg) 68% 45%/cover;filter:saturate(.8)}'), []);
  assert.deepEqual(sample('html[data-theme="light"] .appbar__m{content:url("../assets/img/m-mark-dark.png")}'), []);
});

test('no stylesheet paints a supplied mark as a background that is filtered, transformed, blended, cropped or tiled', () => {
  const sheets = trackedSheets();
  assert.ok(sheets.length > 50 && sheets.some((s) => s.file === 'css/mnet.css'), 'the stylesheets were read');
  const offenders = markBackgrounds(sheets).filter((f) => f.problems.length);
  assert.deepEqual(offenders, [], JSON.stringify(offenders, null, 1));
});

test('the member\'s Action Record paints no mark behind its words (review RS-1)', () => {
  const css = readFileSync(join(ROOT, 'css/mnet.css'), 'utf8');
  const onView = cssRules(css).filter((r) => r.selectors.some((s) => /#mnMissionsView::before/.test(s)));
  assert.deepEqual(onView.map((r) => r.selectors.join(',')), [], 'no rule draws a ::before layer on #mnMissionsView');
  assert.doesNotMatch(css, /#mnMissionsView[^{]*\{[^}]*url\(/, 'no background image on the Action Record');
});
