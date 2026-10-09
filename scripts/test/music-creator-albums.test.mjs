/* A creator's albums and front page on McCluster Music. What matters: the
   albums a creator writes are bounded and can only point at images the
   platform stores; a public page shows published tracks only, hides albums
   with none, and lists everything else as singles; the page and the studio
   use these rules rather than their own; the page is phone-first and never
   dresses an artist in the house mark. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ALB = require('../../js/music-creator-albums.js');
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const ART = 'https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/v1/object/public/creator-artwork/';
const OWNER = '11111111-2222-4333-8444-555555555555';
const cover = `${ART}${OWNER}/0b7a3c1e-1111-4222-8333-444455556666-cover.jpg`;
const id = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;

test('only images the platform stores are shown, and only https links are followed', () => {
  assert.equal(ALB.safeArtwork(cover), cover);
  for (const bad of [
    '', 'https://evil.example/pixel.gif', cover.replace('creator-artwork', 'creator-masters'),
    cover.replace('https://', 'http://'), `${ART}${OWNER}/../creator-masters/x.wav`, `${ART}${OWNER}/a.jpg?x=1`,
    `${ART}not-a-uid/a.jpg`, `javascript:alert(1)//${ART}`, `${ART}${OWNER}/a b.jpg`
  ]) assert.equal(ALB.safeArtwork(bad), '', bad);
  assert.equal(ALB.safeLink('https://example.com/artist'), 'https://example.com/artist');
  for (const bad of ['javascript:alert(1)', 'http://example.com', 'https://user:pw@example.com', 'data:text/html,x', ' ']) {
    assert.equal(ALB.safeLink(bad), '', bad);
  }
});

test('albums are bounded, de-duplicated and stripped to known fields', () => {
  const albums = ALB.normalizeAlbums({ albums: [
    { id: 'alb_debut00001', title: '  Northbound\u0007 ', kind: 'ep', release_date: '2026-02-30', description: 'x'.repeat(3000),
      cover_url: 'https://evil.example/c.jpg', tracks: [id(1), id(1).toUpperCase(), 'not-a-uuid', id(2)], extra: 'dropped' },
    { id: 'alb_debut00001', title: 'Duplicate id', tracks: [] },
    { id: 'alb_bad', title: 'Short id' },
    { id: 'alb_notitle01', title: '   ' },
    { id: 'alb_ok00000002', title: 'Second', kind: 'boxset', release_date: '2025-06-12', cover_url: cover, tracks: Array.from({ length: 80 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) },
    null, 'string'
  ] });
  assert.equal(albums.length, 2);
  assert.deepEqual(Object.keys(albums[0]).sort(), ['cover_url', 'description', 'id', 'kind', 'release_date', 'title', 'tracks']);
  assert.equal(albums[0].title, 'Northbound');
  assert.equal(albums[0].kind, 'ep');
  assert.equal(albums[0].release_date, '', 'an impossible date is dropped');
  assert.equal(albums[0].description.length, 2000);
  assert.equal(albums[0].cover_url, '', 'a foreign image is dropped');
  assert.deepEqual(albums[0].tracks, [id(1), id(2)], 'unique, lowercase uuids only');
  assert.equal(albums[1].kind, 'album', 'an unknown type falls back to album');
  assert.equal(albums[1].release_date, '2025-06-12');
  assert.equal(albums[1].cover_url, cover);
  assert.equal(albums[1].tracks.length, ALB.MAX_TRACKS);
  const many = ALB.normalizeAlbums({ albums: Array.from({ length: 40 }, (_, i) => ({ id: `alb_${String(i).padStart(8, 'a')}`, title: `A${i}` })) });
  assert.equal(many.length, ALB.MAX_ALBUMS);
  assert.match(ALB.newAlbumId(), /^alb_[a-z0-9]{10}$/);
  assert.deepEqual(ALB.normalizeAlbums(null), []);
});

test('a public page shows published tracks only, hides empty albums and lists the rest as singles', () => {
  const published = [
    { id: id(1), title: 'One' }, { id: id(2), title: 'Two' }, { id: id(3), title: 'Three' }, { id: id(5), title: 'Single' }
  ];
  const settings = {
    featured_album: 'alb_second0002',
    albums: [
      { id: 'alb_first00001', title: 'First', tracks: [id(3), id(9), id(1)] },
      { id: 'alb_second0002', title: 'Second', tracks: [id(2)] },
      { id: 'alb_unrel00003', title: 'Unreleased', tracks: [id(9)] }
    ]
  };
  const cat = ALB.publicCatalogue(settings, published);
  assert.deepEqual(cat.albums.map((a) => a.title), ['First', 'Second'], 'an album with nothing published is hidden');
  assert.deepEqual(cat.albums[0].rows.map((t) => t.title), ['Three', 'One'], "the creator's order, published only");
  assert.deepEqual(cat.singles.map((t) => t.title), ['Single']);
  assert.equal(cat.featured, 'alb_second0002');
  assert.equal(ALB.publicCatalogue({ featured_album: 'alb_unrel00003', albums: settings.albums }, published).featured, 'alb_first00001',
    'a featured album with nothing published falls back to the first shown');
  assert.deepEqual(ALB.publicCatalogue({}, []), { albums: [], singles: [], featured: '' });
});

test('artist colours are hex only', () => {
  assert.deepEqual(ALB.theme({ experience_theme: { accent: '#2F9DF4', background: 'red', foreground: '#fff', surface: '#111823;x' } }), { accent: '#2F9DF4' });
  assert.deepEqual(ALB.theme(null), {});
});

test('the artist page renders from these rules, phone first, without the house mark as artist art', () => {
  const html = read('music-creator.html');
  const js = read('js/music-creator-profile.js');
  const css = read('css/music-artist.css');
  assert.ok(html.indexOf('js/music-creator-albums.js') > 0 && html.indexOf('js/music-creator-albums.js') < html.indexOf('js/music-creator-profile.js'));
  assert.match(html, /css\/music-artist\.css/);
  assert.doesNotMatch(html.match(/<meta name="viewport" content="([^"]+)">/)[1], /user-scalable=no|maximum-scale/);
  for (const el of ['creatorHero', 'creatorArtist', 'creatorBio', 'creatorAvatar', 'apFeatured', 'apTracks', 'apShelf', 'creatorPublicTracks']) {
    assert.match(html, new RegExp(`id="${el}"`), el);
  }
  assert.match(js, /ALB\.publicCatalogue\(p\.settings \|\| \{\}, tracks \|\| \[\]\)/);
  assert.match(js, /var avatar = ALB\.safeArtwork\(p\.avatar_url\)/);
  assert.match(js, /ALB\.safeArtwork\(p\.banner_url\)/);
  assert.match(js, /var site = ALB\.safeLink\(p\.website_url\)/);
  assert.match(js, /&status=eq\.published&/, 'published tracks only');
  assert.match(js, /rel="noopener nofollow ugc"/);
  assert.doesNotMatch(js, /m-mark/, 'the house mark is never an artist\'s artwork');
  assert.doesNotMatch(html.replace(/<header class="music-contextbar">[\s\S]*?<\/header>/, '').replace(/<link rel="icon"[^>]*>/, ''), /m-mark/);
  assert.match(css, /\.ap \[hidden\]\{display:none!important\}/);
  assert.doesNotMatch(css, /@media[^{]*max-width/, 'breakpoints only add');
  assert.doesNotMatch(css.replace(/minmax\(0,1fr\)/g, '').replace(/minmax\(0,340px\)/g, ''), /\b1fr\b/);
});

test('Creator Studio saves albums through the same rules and never clobbers newer settings', () => {
  const html = read('creator.html');
  const js = read('js/music-creator-studio.js');
  for (const el of ['creatorAvatarFile', 'creatorBannerFile', 'albumForm', 'albumTitle', 'albumKind', 'albumDate', 'albumCover', 'albumFeatured', 'albumTracks', 'albumPool', 'trackAlbum']) {
    assert.match(html, new RegExp(`id="${el}"`), el);
  }
  assert.ok(html.indexOf('js/music-creator-albums.js') < html.indexOf('js/music-creator-studio.js'));
  assert.match(js, /async function saveSettings\(change\) \{\s+const rows = await rest\("music_creator_profiles\?m_uid=eq\."[\s\S]*?settings\.albums = ALB\.normalizeAlbums\(settings\);/,
    'reads the current settings before writing them back');
  assert.match(js, /uploadGrant\("creator-artwork", cover\)/);
  assert.match(js, /if \(coverUpload\) \{ try \{ await removeUpload\(coverUpload\.bucket, coverUpload\.path\)/, 'a failed album save removes its cover');
  assert.match(js, /patch\.avatar_url = publicUrl\("creator-artwork"/);
  assert.match(js, /patch\.banner_url = publicUrl\("creator-artwork"/);
  assert.match(js, /const albumId = \$\("trackAlbum"\)\.value;[\s\S]*?committed = true|committed = true;[\s\S]*?const albumId = \$\("trackAlbum"\)\.value;/, 'a track joins its album only after the release is committed');
});
