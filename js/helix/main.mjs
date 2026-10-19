/* McCluster HELIX — the 3D object is the interaction surface, not decoration. */
import { HelixScene } from "./scene.mjs";
import { clamp, classifyGesture, lyricText } from "./math.mjs";

const $ = id => document.getElementById(id);
const app = $("helixApp");
const canvas = $("helixCanvas");
const notice = $("helixNotice");
const transport = window.MCC_MUSIC;
const state = { mode: "library", album: 0, track: 0 };
let albums = [];
let scene = null;
let pointer = null;
let pinch = null;
const lyricCache = new Map();

function announce(message, persist = false) {
  notice.textContent = message;
  notice.classList.toggle("is-hidden", !persist);
}

function fallback(message) {
  $("helixFallbackReason").textContent = message;
  $("helixFallback").hidden = false;
  announce("3D not available — use the Music link.", true);
}

function album() { return albums[state.album]; }
function track() { return album()?.tracks?.[state.track]; }
function canListen() { return !!transport?.audio; }

function clock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

function isCurrentTrack() {
  const active = transport?.current?.();
  return !!active && active.albumSlug === album()?.slug && active.title === track()?.title;
}

function paintPlayback() {
  if (state.mode !== "song") return;
  const audio = transport?.audio;
  const active = isCurrentTrack();
  const access = active ? transport.access?.() : null;
  const duration = Number(audio?.duration);
  const stamp = active && audio ? clock(audio.currentTime) +
    (Number.isFinite(duration) ? " / " + clock(duration) : "") : "";
  $("helixPlayback").textContent = access === "loading" ? "Preparing audio…" :
    access === "preview" ? "Preview · " + stamp :
    access === "unavailable" ? "Audio unavailable" :
    active ? (audio.paused ? "Paused" : "Playing") + (stamp ? " · " + stamp : "") :
    "Tap the glowing crossbar to play";
  scene?.setPlaying(active && !audio.paused);
}

function renderAccessible() {
  const nav = $("helixAccessible");
  const fragment = document.createDocumentFragment();
  if (state.mode === "library") {
    albums.forEach((record, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Open album: " + record.name;
      button.addEventListener("click", () => enterAlbum(index));
      fragment.append(button);
    });
  } else {
    album().tracks.forEach((record, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = (index + 1) + ". " + record.title +
        (index === state.track ? " — selected" : "");
      button.addEventListener("click", () => openSong(index));
      fragment.append(button);
    });
  }
  nav.replaceChildren(fragment);
}

function render() {
  if (!albums.length) return;
  state.track = clamp(state.track, 0, album().tracks.length - 1);
  app.dataset.view = state.mode;
  scene.setMode(state.mode, state.album, state.track);
  const record = album();
  $("helixAlbum").textContent = record.name;
  $("helixArtist").textContent = record.artist || "McCluster";
  $("helixLevel").textContent =
    state.mode === "library" ? "ALBUM DNA" :
    state.mode === "album" ? "THE STRAND" : "INSIDE THE SONG";
  $("helixEyebrow").textContent = state.mode === "library"
    ? "VIAL " + (state.album + 1) + " OF " + albums.length
    : state.mode === "album" ? "ALBUM GENOME" : "SONG GENOME";
  const deep = state.mode !== "library";
  $("helixSong").hidden = !deep;
  $("helixLyrics").hidden = state.mode !== "song";
  if (deep) {
    $("helixCounter").textContent = "RUNG " + (state.track + 1) + " / " + record.tracks.length;
    $("helixSongName").textContent = track().title;
  }
  $("helixHelp").textContent = state.mode === "library"
    ? "Swipe sideways to change albums · Tap the centered vial to enter"
    : state.mode === "album"
      ? "Swipe up or down to move through songs · Tap a crossbar to listen"
      : "Drag across the selected crossbar to seek · Tap to pause or play · Pinch out to go back";
  paintPlayback();
  renderAccessible();
}

function showLibrary(index = state.album) {
  state.album = clamp(index, 0, albums.length - 1);
  state.track = 0;
  state.mode = "library";
  render();
}

function enterAlbum(index = state.album) {
  state.album = clamp(index, 0, albums.length - 1);
  state.track = 0;
  state.mode = "album";
  render();
}

function changeAlbum(direction) {
  state.album = (state.album + direction + albums.length) % albums.length;
  state.track = 0;
  if (state.mode === "song") state.mode = "album";
  render();
}

function stepTrack(direction) {
  if (state.mode === "library") return enterAlbum();
  const next = clamp(state.track + direction, 0, album().tracks.length - 1);
  if (state.mode === "song" && next !== state.track) openSong(next);
  else { state.track = next; render(); }
}

function back() {
  if (state.mode === "song") {
    state.mode = "album";
    $("helixLyricText").textContent = "";
    render();
  } else if (state.mode === "album") showLibrary();
  else window.location.href = "listen.html";
}

function lyricLocation(path) {
  if (typeof path !== "string" || !/^data\/lyrics\/[a-z0-9_.-]+\.json$/i.test(path)) return null;
  return path;
}

function loadLyrics() {
  const item = track();
  const key = album().slug + "|" + item.title;
  const box = $("helixLyricText");
  const safePath = lyricLocation(item.lyrics);
  box.textContent = safePath ? "Opening the lyrics…" : "Lyrics have not been published for this song.";
  if (!safePath) return;
  const apply = text => {
    if (state.mode === "song" && album().slug + "|" + track().title === key) {
      box.textContent = text || "Lyrics have not been published for this song.";
      box.scrollTop = 0;
    }
  };
  if (lyricCache.has(key)) return apply(lyricCache.get(key));
  fetch(safePath).then(response => {
    if (!response.ok) throw new Error("lyrics unavailable");
    return response.json();
  }).then(record => {
    const words = lyricText(record).trim();
    lyricCache.set(key, words);
    apply(words);
  }).catch(() => apply("Lyrics are unavailable for this track."));
}

function openSong(index = state.track) {
  state.track = clamp(index, 0, album().tracks.length - 1);
  state.mode = "song";
  render();
  loadLyrics();
  if (!canListen()) return announce("The music engine could not start.", true);
  // The engine remains the sole authority for login gates, previews and playback.
  if (isCurrentTrack()) {
    if (transport.audio.paused) transport.resume?.().catch(() => announce("Playback was blocked. Tap the strand again.", true));
    return;
  }
  transport.play(album().slug, track().title).catch(() => {
    announce("This track is unavailable. You can still explore the album.", true);
    paintPlayback();
  });
}

function togglePlayback() {
  if (!canListen()) return;
  if (!isCurrentTrack()) return openSong();
  if (transport.audio.paused) {
    transport.resume().catch(() => announce("Tap again to start audio.", true));
  } else transport.pause();
}

function scrub(clientX) {
  if (!canListen() || !isCurrentTrack()) return;
  // Earned one-time streams may disallow backward seek; never bypass the gate.
  if (track()?.gated) return announce("Seeking is restricted for this recording.", true);
  const audio = transport.audio;
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
  const fraction = scene.seekFraction(clientX);
  if (fraction === null) return;
  audio.currentTime = clamp(fraction, 0, 1) * audio.duration;
  paintPlayback();
}

function selectAt(x, y) {
  const hit = scene.pick(x, y);
  if (!hit) return;
  if (state.mode === "library" && hit.kind === "vial") {
    if (hit.albumIndex === state.album) enterAlbum(state.album);
    else showLibrary(hit.albumIndex);
  } else if (state.mode === "album" && hit.kind === "song") {
    openSong(hit.trackIndex);
  } else if (state.mode === "song" && hit.kind === "song") {
    if (hit.trackIndex === state.track) togglePlayback();
    else openSong(hit.trackIndex);
  }
}

function pointerDown(event) {
  if (!event.isPrimary || event.button !== 0) return;
  pointer = {
    id: event.pointerId, x: event.clientX, y: event.clientY,
    hit: scene.pick(event.clientX, event.clientY)
  };
  canvas.setPointerCapture(event.pointerId);
}

function pointerUp(event) {
  if (!pointer || pointer.id !== event.pointerId) return;
  const prev = pointer;
  pointer = null;
  const dx = event.clientX - prev.x;
  const dy = event.clientY - prev.y;
  const gesture = classifyGesture(dx, dy);
  if (gesture === "tap") return selectAt(event.clientX, event.clientY);
  if (gesture === "horizontal") {
    if (state.mode === "song" && prev.hit?.kind === "song" &&
        prev.hit.trackIndex === state.track) return scrub(event.clientX);
    if (state.mode !== "song") return changeAlbum(dx < 0 ? 1 : -1);
  }
  if (gesture === "vertical") {
    if (state.mode === "library") {
      if (dy < 0) enterAlbum();
      return;
    }
    stepTrack(dy < 0 ? 1 : -1);
  }
}

function keydown(event) {
  if (event.altKey || event.metaKey || event.ctrlKey) return;
  if (event.target !== canvas) return;
  if (event.key === "ArrowLeft") changeAlbum(-1);
  else if (event.key === "ArrowRight") changeAlbum(1);
  else if (event.key === "ArrowUp") stepTrack(-1);
  else if (event.key === "ArrowDown") stepTrack(1);
  else if (event.key === "Escape" || event.key === "Backspace") back();
  else if (event.key === "Enter" || event.key === " ") {
    if (state.mode === "library") enterAlbum();
    else if (state.mode === "album") openSong();
    else togglePlayback();
  } else return;
  event.preventDefault();
}

function touchDistance(touches) {
  const a = touches[0], b = touches[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchStart(event) {
  if (event.touches.length !== 2) return;
  pointer = null; // a two-finger gesture must not also select a crossbar
  pinch = { start: touchDistance(event.touches), end: touchDistance(event.touches) };
  event.preventDefault();
}

function touchMove(event) {
  if (!pinch || event.touches.length !== 2) return;
  pinch.end = touchDistance(event.touches);
  event.preventDefault();
}

function touchEnd(event) {
  if (!pinch || event.touches.length >= 2) return;
  const ratio = pinch.end / Math.max(1, pinch.start);
  pinch = null;
  if (ratio < 0.78 && state.mode !== "library") back();
  else if (ratio > 1.22) {
    if (state.mode === "library") enterAlbum();
    else if (state.mode === "album") openSong();
  }
  event.preventDefault();
}

function syncFromEngine() {
  if (!canListen()) return;
  const current = transport.current?.();
  if (!current) return paintPlayback();
  // Auto-advance and lock-screen next track must keep the helix in sync.
  const ai = albums.findIndex(a => a.slug === current.albumSlug);
  if (ai >= 0) {
    const ti = albums[ai].tracks.findIndex(t => t.title === current.title);
    if (ti >= 0 && (state.album !== ai || state.track !== ti) && state.mode === "song") {
      state.album = ai;
      state.track = ti;
      render();
      loadLyrics();
    }
  }
  paintPlayback();
}

async function boot() {
  if (!canListen()) throw new Error("Music engine unavailable");
  const response = await fetch("data/albums.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("Catalog unavailable (" + response.status + ")");
  const data = await response.json();
  albums = (Array.isArray(data.albums) ? data.albums : []).filter(a =>
    a && typeof a.slug === "string" && Array.isArray(a.tracks) && a.tracks.length > 0
  );
  if (!albums.length) throw new Error("No published albums with tracks");
  scene = new HelixScene(canvas);
  scene.mount(albums);
  scene.setAudio(transport.audio);
  const requested = new URLSearchParams(location.search).get("album");
  const index = albums.findIndex(a => a.slug === requested);
  if (index >= 0) enterAlbum(index);
  else showLibrary(0);

  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", () => { pointer = null; });
  canvas.addEventListener("keydown", keydown);
  let lastWheel = 0;
  canvas.addEventListener("wheel", event => {
    if (event.ctrlKey) { event.preventDefault(); return; }
    if (Math.abs(event.deltaY) <= 4 || state.mode === "library") return;
    event.preventDefault();
    const now = performance.now();
    if (now - lastWheel < 230) return;
    lastWheel = now;
    stepTrack(event.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  canvas.addEventListener("touchstart", touchStart, { passive: false });
  canvas.addEventListener("touchmove", touchMove, { passive: false });
  canvas.addEventListener("touchend", touchEnd, { passive: false });
  canvas.addEventListener("touchcancel", () => { pinch = null; });
  canvas.addEventListener("gesturestart", event => event.preventDefault(), { passive: false });
  window.addEventListener("mcc:music-selected", syncFromEngine);
  window.addEventListener("mcc:music-state", syncFromEngine);
  transport.audio.addEventListener("timeupdate", paintPlayback);
  transport.audio.addEventListener("pause", paintPlayback);
  transport.audio.addEventListener("play", paintPlayback);
  transport.audio.addEventListener("ended", paintPlayback);
  window.MCC_HELIX_READY = true;
  announce("", false);
}

boot().catch(error => {
  console.error("[Helix] viewer unavailable", error);
  fallback(error.message || "The 3D viewer could not start.");
});
