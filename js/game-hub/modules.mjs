/* The Game Hub's module list (data/game-hub/modules.json): the schema, its checks, and the music pairing rule.
   Pure, so scripts/test/game-hub.test.mjs and the page share one definition. */

export const ICON_KINDS = ['image', 'glyph'];
export const GLYPHS = ['ring', 'flask', 'atom', 'book'];
export const GAME_KINDS = ['link', 'embedded'];
export const EMBEDDED_VIEWS = ['chem108/molecule-rush'];
export const MUSIC_ROLES = ['rhythm', 'soundtrack'];
const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const COLOR = /^#[0-9a-f]{6}$/i;

/* Purple is not a house colour (owner). A hue between violet and magenta with real saturation is refused. */
export function isPurple(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.15) return false;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return h >= 250 && h <= 320;
}

/* The pairing rule (docs/prim3/LEARNING-MODALITY-CONTRACT.md): a "rhythm" album is the course's own songs, which
   reinforce concepts they actually contain; a "soundtrack" is study music with none of the course in its lyrics, and it
   must say so on its label, because a song never creates course credit it does not teach. */
export function musicErrors(m) {
  const e = [], mu = m.music;
  if (!mu || typeof mu !== 'object') return [`${m.id}: music is required`];
  if (!MUSIC_ROLES.includes(mu.role)) e.push(`${m.id}: music.role must be one of ${MUSIC_ROLES.join(', ')}`);
  if (typeof mu.album !== 'string' || !mu.album) e.push(`${m.id}: music.album is required`);
  if (typeof mu.label !== 'string' || !mu.label) e.push(`${m.id}: music.label is required`);
  if (mu.role === 'soundtrack' && !/no .*lyrics/i.test(mu.label || '')) e.push(`${m.id}: a soundtrack's label must say it carries no course lyrics`);
  if (mu.role === 'soundtrack' && /rhythm/i.test(mu.label || '')) e.push(`${m.id}: a soundtrack never claims Rhythm`);
  return e;
}

export function validateModules(doc, { albums } = {}) {
  const errors = [];
  if (!doc || doc.version !== 1 || !Array.isArray(doc.modules) || !doc.modules.length) return ['modules.json: version 1 with a non-empty modules list'];
  const ids = new Set();
  for (const m of doc.modules) {
    if (!ID.test(m.id || '')) errors.push(`bad module id ${m.id}`);
    if (ids.has(m.id)) errors.push(`duplicate module id ${m.id}`);
    ids.add(m.id);
    for (const k of ['label', 'short', 'course', 'blurb']) if (typeof m[k] !== 'string' || !m[k].trim()) errors.push(`${m.id}: ${k} is required`);
    if (!COLOR.test(m.accent || '')) errors.push(`${m.id}: accent must be #rrggbb`);
    else if (isPurple(m.accent)) errors.push(`${m.id}: accent ${m.accent} is purple`);
    const ic = m.icon || {};
    if (!ICON_KINDS.includes(ic.kind)) errors.push(`${m.id}: icon.kind must be image or glyph`);
    if (ic.kind === 'image' && !/^assets\/img\/[\w.-]+\.(png|webp|jpg)$/.test(ic.src || '')) errors.push(`${m.id}: an image icon is owner-supplied artwork under assets/img/`);
    if (ic.kind === 'glyph' && !GLYPHS.includes(ic.glyph)) errors.push(`${m.id}: unknown glyph ${ic.glyph}`);
    errors.push(...musicErrors(m));
    if (albums && m.music && !albums.some((a) => a.slug === m.music.album)) errors.push(`${m.id}: album ${m.music.album} is not in data/albums.json`);
    if (!Array.isArray(m.games) || !m.games.length) { errors.push(`${m.id}: at least one game`); continue; }
    const gids = new Set();
    for (const g of m.games) {
      if (!ID.test(g.id || '') || gids.has(g.id)) errors.push(`${m.id}: bad or duplicate game id ${g.id}`);
      gids.add(g.id);
      if (!GAME_KINDS.includes(g.kind)) errors.push(`${m.id}/${g.id}: kind must be link or embedded`);
      for (const k of ['title', 'tag', 'blurb']) if (typeof g[k] !== 'string' || !g[k].trim()) errors.push(`${m.id}/${g.id}: ${k} is required`);
      if (g.kind === 'link' && !/^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.html(\?[^#\r\n]*)?$/.test(g.href || '')) errors.push(`${m.id}/${g.id}: a link game names a page on this site`);
      if (g.kind === 'embedded' && !EMBEDDED_VIEWS.includes(g.view)) errors.push(`${m.id}/${g.id}: unknown embedded view ${g.view}`);
      if (g.gate !== undefined && g.gate !== 'owner') errors.push(`${m.id}/${g.id}: the only gate is "owner"`);
    }
  }
  if (!ids.has(doc.default)) errors.push(`default ${doc.default} is not a module`);
  return errors;
}

export function albumFor(albums, slug) {
  const a = albums.find((x) => x.slug === slug);
  if (!a) return null;
  return { slug: a.slug, name: a.name, art: a.art, tracks: (a.tracks || []).filter((t) => t.src && !t.gated).map((t) => ({ title: t.title, src: t.src, seconds: t.seconds || null })) };
}

/* the hash is the hub's address: #m=<module>[&play=<game>] */
export function parseHash(hash) {
  const p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  return { module: p.get('m') || null, play: p.get('play') || null };
}
export function hashFor(moduleId, play) { return '#m=' + encodeURIComponent(moduleId) + (play ? '&play=' + encodeURIComponent(play) : ''); }
