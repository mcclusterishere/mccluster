// Controls for the existing site transport. Never construct another Audio element.
export async function createSharedMusic({ root }) {
  try { if (parent !== window) parent.MCC_MUSIC_JOURNEYS?.attachEngine(window); } catch (_) {}
  if (!window.MCC_MUSIC) {
    for (const file of ['listen-ledger.js', 'gated-audio.js', 'music-engine.js']) {
      await import(new URL('../' + file, import.meta.url));
    }
  }
  const engine = window.MCC_MUSIC;
  const play = root.querySelector('[data-hub-music-play]');
  const next = root.querySelector('[data-music-next]');
  const title = root.querySelector('[data-music-title]');
  const role = root.querySelector('[data-music-role]');
  const status = root.closest('#ghCapsule').querySelector('[data-music-status]');
  const course = root.closest('#ghCapsule').querySelector('[data-course-soundtrack]');
  const progress = root.querySelector('[data-music-progress]');
  let album, module;
  function paint() {
    const current = engine.current(), track = current || album?.tracks[0];
    title.textContent = track?.title || 'No tracks'; title.title = title.textContent;
    const playing = !engine.audio.paused;
    play.dataset.state = playing ? 'playing' : 'paused';
    play.setAttribute('aria-pressed', String(playing));
    play.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${track?.title || 'music'}`);
    play.disabled = !track; course.disabled = !album?.tracks.length;
    next.disabled = !current;
    role.textContent = engine.access() === 'unavailable' ? 'Music unavailable · try Play again' :
      (current ? current.albumName : module?.music.label) || '';
    status.textContent = role.textContent;
    progress.style.transform = `scaleX(${engine.audio.duration ? Math.min(1, engine.audio.currentTime / engine.audio.duration) : 0})`;
  }
  function run(action) { Promise.resolve().then(action).catch(() => { role.textContent = status.textContent = 'Music unavailable · try Play again'; }); }
  play.addEventListener('click', () => run(() => !engine.audio.paused ? engine.pause() :
    engine.current() ? engine.resume() : engine.play(album.slug, album.tracks[0].title)));
  course.addEventListener('click', () => run(() => engine.play(album.slug, album.tracks[0].title)));
  next.addEventListener('click', () => run(() => engine.next()));
  window.addEventListener('mcc:music-state', paint);
  return { setModule(m, a) { module = m; album = a; paint(); }, engine };
}
