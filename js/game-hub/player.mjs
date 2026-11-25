/* The Game Hub's music bar: one <audio> element for the page, playing the selected module's paired album. Selecting a
   module switches the album; each module's place (track and second) is remembered in this browser, so coming back
   resumes where it was. Nothing plays until the visitor presses play (browsers allow sound only after a gesture);
   once they have, switching modules keeps the music going, because a module switch is itself a tap.

   The site's album engine (js/music-engine.js) is one global queue across every album with gated masters and its own
   transport; the hub needs a per-module album and per-module memory, so it keeps this small player instead. */

export const STORE_KEY = 'mcc.gamehub.music.v1';

export function loadPositions(storage) {
  try { const x = JSON.parse(storage.getItem(STORE_KEY) || 'null'); return x && typeof x === 'object' && x.modules ? x : { modules: {} }; } catch (e) { return { modules: {} }; }
}
export function savePositions(storage, state) { try { storage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode: nothing kept */ } }

/* a saved place, clamped to the album as it is today (a track may have been removed since) */
export function placeFor(saved, album) {
  const n = album.tracks.length;
  if (!n) return { track: 0, time: 0 };
  const track = Number.isInteger(saved?.track) && saved.track >= 0 && saved.track < n ? saved.track : 0;
  const time = track === saved?.track && Number.isFinite(saved?.time) && saved.time > 0 ? saved.time : 0;
  return { track, time };
}
export const nextIndex = (album, i) => (album.tracks.length ? (i + 1) % album.tracks.length : 0);

export function createPlayer({ root, storage = globalThis.localStorage, audio = new Audio() } = {}) {
  const $ = (s) => root.querySelector(s);
  const playBtn = $('[data-music-play]'), nextBtn = $('[data-music-next]'), title = $('[data-music-title]'), role = $('[data-music-role]'), bar = $('[data-music-progress]');
  audio.preload = 'none';
  audio.setAttribute('playsinline', '');
  let positions = loadPositions(storage);
  let mod = null, album = null, index = 0, wants = false, lastSave = 0;

  function remember() {
    if (!mod || !album) return;
    positions.modules[mod.id] = { album: album.slug, track: index, time: Math.floor(audio.currentTime || 0) };
    savePositions(storage, positions);
  }
  function paint() {
    const t = album && album.tracks[index];
    title.textContent = t ? t.title : 'No tracks';
    role.textContent = mod ? mod.music.label : '';
    const playing = !audio.paused;
    playBtn.setAttribute('aria-pressed', String(playing));
    playBtn.setAttribute('aria-label', (playing ? 'Pause ' : 'Play ') + (t ? t.title : 'music'));
    playBtn.dataset.state = playing ? 'playing' : 'paused';
    nextBtn.disabled = !album || album.tracks.length < 2;
  }
  function load(i, time = 0) {
    index = i;
    const t = album.tracks[index];
    if (!t) return;
    audio.src = t.src;
    if (time) {
      const seek = () => { try { audio.currentTime = time; } catch (e) { /* not seekable yet */ } };
      audio.addEventListener('loadedmetadata', seek, { once: true });
    }
    paint();
  }
  function play() {
    wants = true;
    if (!audio.src) load(index);
    const p = audio.play();
    if (p && p.catch) p.catch(() => { wants = false; paint(); });
    paint();
  }
  function pause() { wants = false; audio.pause(); remember(); paint(); }

  playBtn.addEventListener('click', () => (audio.paused ? play() : pause()));
  nextBtn.addEventListener('click', () => { if (!album) return; load(nextIndex(album, index)); remember(); if (wants) play(); });
  audio.addEventListener('ended', () => { load(nextIndex(album, index)); remember(); if (wants) play(); });
  audio.addEventListener('play', paint);
  audio.addEventListener('pause', paint);
  audio.addEventListener('timeupdate', () => {
    const d = audio.duration || (album && album.tracks[index]?.seconds) || 0;
    if (bar) bar.style.transform = `scaleX(${d ? Math.min(1, audio.currentTime / d) : 0})`;
    const now = Date.now();
    if (now - lastSave > 3000) { lastSave = now; remember(); }
  });
  addEventListener('pagehide', remember);

  return {
    /* switch to a module's album; keeps playing if the visitor had pressed play */
    setModule(next, nextAlbum) {
      if (mod && mod.id === next.id) return;
      remember();
      const keep = wants;
      audio.pause();
      mod = next; album = nextAlbum;
      root.dataset.role = next.music.role;
      const place = placeFor(positions.modules[next.id], album);
      audio.removeAttribute('src'); audio.load();
      load(place.track, place.time);
      if (bar) bar.style.transform = 'scaleX(0)';
      if (keep) play(); else paint();
    },
    play, pause,
    get playing() { return !audio.paused; },
    get track() { return album && album.tracks[index]; },
    audio
  };
}
