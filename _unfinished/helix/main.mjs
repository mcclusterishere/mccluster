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
let informationTab = "lyrics";

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
  const audio = transport?.audio;
  const active = state.mode === "song" && isCurrentTrack();
  const access = active ? transport.access?.() : null;
  const duration = Number(audio?.duration);
  const validDuration = active && Number.isFinite(duration) && duration > 0;
  const currentTime = active ? Number(audio?.currentTime) || 0 : 0;
  const stamp = active ? clock(currentTime) +
    (validDuration ? " / " + clock(duration) : "") : "";
  $("helixPlayback").textContent = state.mode !== "song" ? "Choose a song on the DNA strand" :
    access === "loading" ? "Preparing audio…" :
    access === "preview" ? "Preview · " + stamp :
    access === "unavailable" ? "Audio unavailable" :
    access === "spent" ? "This one-time listen has ended" :
    active ? (audio.paused ? "Paused" : "Playing") + (stamp ? " · " + stamp : "") :
    "Tap the glowing crossbar or Play to listen";
  const seek = $("helixSeek");
  seek.disabled = !validDuration || !!track()?.gated;
  seek.value = validDuration ? String(Math.round(clamp(currentTime / duration, 0, 1) * 1000)) : "0";
  $("helixCurrent").textContent = active ? clock(currentTime) : "0:00";
  $("helixDuration").textContent = validDuration ? clock(duration) : "—:—";
  const label = state.mode === "library" ? "Enter album" : state.mode === "album" ?
    "Play selected song" : active && !audio?.paused ? "Pause" : "Play";
  $("helixPlayLabel").textContent = label;
  $("helixPlay").setAttribute("aria-label", label);
  // Progress belongs only to the selected active recording, never another track.
  scene?.setAudio(active ? audio : null);
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

function renderInformationPanels() {
  const showingSong = state.mode === "song";
  $("helixLyrics").hidden = !showingSong || informationTab !== "lyrics";
  $("helixDetails").hidden = !showingSong || informationTab !== "details";
  for (const [name, id] of [["lyrics", "helixLyricsTab"], ["details", "helixDetailsTab"]]) {
    const button = $(id);
    const active = name === informationTab;
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = !showingSong;
  }
}

function renderSongData(record, item) {
  // Only approved, provenance-tagged measurements may populate brain metrics.
  // A 3D brain is illustrative: this is neither EEG nor an inferred mental state.
  const analysis = item?.analysis;
  const measured = analysis?.provenance === "measured" || analysis?.provenance === "verified";
  const bpm = measured ? Number(analysis.bpm) : NaN;
  $("helixBpm").textContent = Number.isFinite(bpm) && bpm >= 20 && bpm <= 360 ?
    String(Math.round(bpm)) : "—";
  $("helixKey").textContent = measured && typeof analysis.key === "string" ?
    analysis.key.slice(0, 18) : "—";
  $("helixSignature").textContent = measured && typeof analysis.spectralLabel === "string" ?
    analysis.spectralLabel.slice(0, 22) : "—";
  const source = measured ?
    "Measured audio features · NOT a brain scan or biological reading" :
    "Audio analysis pending · brain illustration is not an EEG";
  $("helixBrainSource").textContent = source;
  $("helixDetailProvenance").textContent = source +
    ". Decorative DNA waveform is not a measured recording waveform.";
  $("helixDetailAlbum").textContent = record.name;
  $("helixDetailTrack").textContent = item?.title || "Select a track";
}

function render() {
  if (!albums.length) return;
  state.track = clamp(state.track, 0, album().tracks.length - 1);
  app.dataset.view = state.mode;
  scene.setMode(state.mode, state.album, state.track);
  const record = album();
  const item = track();
  $("helixAlbum").textContent = record.name;
  $("helixArtist").textContent = record.artist || "Matthew McCluster";
  $("helixLevel").textContent = state.mode === "library" ? "ALBUM DNA" :
    state.mode === "album" ? "THE STRAND" : "INSIDE THE SONG";
  $("helixEyebrow").textContent = state.mode === "library"
    ? "VIAL " + (state.album + 1) + " OF " + albums.length
    : state.mode === "album" ? "ALBUM GENOME" : "SONG GENOME";
  const art = $("helixArt");
  if (typeof record.art === "string" && /^assets\/(?:img|frames)\/[a-z0-9_./-]+$/i.test(record.art)) {
    art.src = record.art;
    art.alt = record.name + " cover art";
    art.hidden = false;
  } else {
    art.removeAttribute("src");
    art.hidden = true;
  }
  const deep = state.mode !== "library";
  $("helixSong").hidden = !deep;
  if (deep) {
    $("helixCounter").textContent = "RUNG " + (state.track + 1) + " / " + record.tracks.length;
    $("helixSongName").textContent = item.title;
  }
  renderSongData(record, deep ? item : null);
  renderInformationPanels();
  $("helixHelp").textContent = state.mode === "library"
    ? "Swipe to change vials · Tap the centered vial to enter"
    : state.mode === "album"
      ? "Swipe up or down to browse crossbars · Tap one to listen"
      : "Select a DNA rung · Touch the glowing rung to play · Pinch in to return";
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
  const requested = new URLSearchParams(location.search).get("album");
  const index = albums.findIndex(a => a.slug === requested);
  if (index >= 0) enterAlbum(index);
  else showLibrary(0);

  // The console controls the SAME canonical engine as the 3D crossbars.
  $("helixPrevious").addEventListener("click", () =>
    state.mode === "library" ? changeAlbum(-1) : stepTrack(-1));
  $("helixNext").addEventListener("click", () =>
    state.mode === "library" ? changeAlbum(1) : stepTrack(1));
  $("helixPlay").addEventListener("click", () => {
    if (state.mode === "library") enterAlbum();
    else if (state.mode === "album") openSong();
    else togglePlayback();
  });
  $("helixSeek").addEventListener("change", event => {
    if (state.mode !== "song" || !isCurrentTrack() || track()?.gated) return;
    const audio = transport.audio;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.currentTime = clamp(Number(event.target.value) / 1000, 0, 1) * audio.duration;
    paintPlayback();
  });
  $("helixLyricsTab").addEventListener("click", () => {
    informationTab = "lyrics";
    renderInformationPanels();
  });
  $("helixDetailsTab").addEventListener("click", () => {
    informationTab = "details";
    renderInformationPanels();
  });

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
  // Don't make every playback tick override an in-progress helix selection.
  window.addEventListener("mcc:music-state", paintPlayback);
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
