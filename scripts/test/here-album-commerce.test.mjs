import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(p)=>readFile(p,'utf8');
const json=async(p)=>JSON.parse(await read(p));

test('HERE is configured as a six-track service-selling experience',async()=>{
  const albums=await json('data/albums.json');
  const here=albums.albums.find(a=>a.slug==='here');
  assert.ok(here);
  assert.equal(here.tracks.length,6);
  assert.equal(here.experience.commerce_mode,'lyric-service');
  const offers=new Map(here.tracks.map(t=>[t.title,t.experience?.commerce?.offer_id]));
  assert.equal(offers.get('Who Did The Shoot'),'who-did-the-shoot');
  assert.equal(offers.get('Runway Walk'),'runway');
  assert.equal(offers.get('Write a Song'),'write-a-song');
  assert.equal(offers.get('Here'),'runway');
  assert.equal(offers.get('Antisocial'),'anti-social');
  assert.equal(offers.get('Lightroom'),'who-did-the-shoot');
  for(const t of here.tracks){
    assert.ok(t.music_video, t.title+' needs a canonical music video');
    assert.ok(t.experience?.theme?.accent, t.title+' needs a player accent');
    assert.ok(t.experience?.commerce?.href, t.title+' needs a primary commercial destination');
    assert.equal('video' in t,false,t.title+' must not write the legacy video field');
  }
});

test('lyric commerce only highlights phrases that exist in canonical lyrics',async()=>{
  const albums=await json('data/albums.json');
  const here=albums.albums.find(a=>a.slug==='here');
  let asserted=0;
  for(const t of here.tracks){
    const rules=t.experience?.lyric_ctas||[];
    if(!rules.length) continue;
    assert.ok(t.lyrics,t.title+' cannot have lyric CTAs without a lyric master');
    const lyric=await json(t.lyrics);
    const plain=String(lyric.plain||'').toLowerCase();
    for(const rule of rules){
      assert.ok(plain.includes(String(rule.match).toLowerCase()),
        t.title+' CTA phrase is not present in the canonical lyric master: '+rule.match);
      assert.ok(rule.href,'CTA needs a destination');
      asserted++;
    }
  }
  assert.ok(asserted>=10,'expected the real HERE lyric masters to carry a useful CTA set');
});

test('music video is the canonical public and database vocabulary',async()=>{
  const [migration,page,legacy,playlists]=await Promise.all([
    read('supabase/migrations/20261006213626_here_album_commerce_v1.sql'),
    read('music-videos.html'),read('films.html'),json('data/playlists.json')
  ]);
  assert.match(migration,/music_video_url/);
  assert.match(migration,/music_video_view/);
  assert.match(page,/music_video_view/);
  assert.doesNotMatch(page,/"film_view"/);
  assert.match(legacy,/music-videos\.html/);
  const videos=playlists.playlists.find(p=>p.slug==='music-videos');
  assert.ok(videos);
  assert.equal(videos.name,'Music Videos');
  assert.deepEqual(videos.legacy_slugs,['the-films']);
});

test('album player changes theme and commerce with the active track',async()=>{
  const [album,commerce]=await Promise.all([read('album.html'),read('js/lyric-commerce.js')]);
  assert.match(album,/--player-bg/);
  assert.match(album,/data-experience/);
  assert.match(album,/data-music-video/);
  assert.match(album,/player_theme_applied/);
  assert.match(album,/id="nowService"/);
  assert.match(album,/MCC_LYRIC_COMMERCE\.bindPrimary/);
  assert.match(album,/MCC_LYRIC_COMMERCE\.renderLine/);
  assert.match(commerce,/lyric_service_cta_click/);
  assert.match(commerce,/track_service_cta_click/);
});

test('creator backend authors the same theme, music-video and lyric-commerce contract',async()=>{
  const [migration,page,studio,access]=await Promise.all([
    read('supabase/migrations/20261006213626_here_album_commerce_v1.sql'),
    read('creator.html'),read('js/music-creator-studio.js'),
    read('supabase/functions/music-access/index.ts')
  ]);
  assert.match(migration,/alter table public\.creator_tracks[\s\S]*music_video_url[\s\S]*lyrics_url[\s\S]*experience jsonb/);
  for(const id of ['creatorAccent','creatorBackground','creatorForeground','creatorSurface','trackMusicVideo','trackLyricsUrl','trackServiceLabel','trackServiceUrl','trackLyricCtas']){
    assert.match(page,new RegExp('id="'+id+'"'),id+' missing from Creator Studio');
  }
  assert.match(studio,/experience_theme/);
  assert.match(studio,/parseLyricCtas/);
  assert.match(studio,/music_video_url:/);
  assert.match(studio,/lyrics_url:/);
  assert.match(studio,/experience: experienceFromForm\(\)/);
  assert.match(access,/music_video_url,lyrics_url,experience/);
});

test('legacy track URLs deep-link to their actual music video',async()=>{
  const pages={
    'tracks/who-did-the-shoot.html':'Who%20Did%20The%20Shoot',
    'tracks/runway-walk.html':'Runway%20Walk',
    'tracks/write-a-song.html':'Write%20a%20Song',
    'tracks/here.html':'Here',
    'tracks/antisocial.html':'Antisocial',
    'tracks/lightroom.html':'Lightroom'
  };
  for(const [path,q] of Object.entries(pages)){
    const html=await read(path);
    assert.match(html,/music-videos\.html\?album=here&t=/);
    assert.ok(html.includes(q),path+' must retain its specific track destination');
  }
});
