// Controls for the existing site transport. Never construct another Audio element.
export async function createSharedMusic({ root }) {
  if (!window.MCC_MUSIC) {
    /* the one helper every player asks before it plays (js/now-playing.js) comes first */
    for (const file of ['now-playing.js', 'listen-ledger.js', 'gated-audio.js', 'music-engine.js']) {
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
  /* what the listener asked for, not only what the element does: a song being picked up again after a dropped read
     is quiet, and this button is still its Pause, which stops the tries (music slice M3) */
  const wanted = () => engine.playing ? engine.playing() : !engine.audio.paused;
  function paint() {
    const current = engine.current(), track = current || album?.tracks[0];
    title.textContent = track?.title || 'No tracks'; title.title = title.textContent;
    const playing = wanted();
    play.dataset.state = playing ? 'playing' : 'paused';
    play.setAttribute('aria-pressed', String(playing));
    play.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${track?.title || 'music'}`);
    play.disabled = !track; course.disabled = !album?.tracks.length;
    next.disabled = !current;
    /* and why it is quiet, in the engine's own few words ("Reconnecting…", "Connection lost · tap play") */
    const trouble = current && engine.delivery ? engine.delivery().status : '';
    role.textContent = engine.access() === 'unavailable' ? 'Music unavailable · try Play again' :
      trouble || (current ? current.albumName : module?.music.label) || '';
    status.textContent = role.textContent;
    progress.style.transform = `scaleX(${engine.audio.duration ? Math.min(1, engine.audio.currentTime / engine.audio.duration) : 0})`;
  }
  function run(action) { Promise.resolve().then(action).catch(() => { role.textContent = status.textContent = 'Music unavailable · try Play again'; }); }
  play.addEventListener('click', () => run(() => wanted() ? engine.pause() :
    engine.current() ? engine.resume() : engine.play(album.slug, album.tracks[0].title)));
  course.addEventListener('click', () => run(() => engine.play(album.slug, album.tracks[0].title)));
  next.addEventListener('click', () => run(() => engine.next()));
  window.addEventListener('mcc:music-state', paint);
  return { setModule(m, a) { module = m; album = a; paint(); }, engine };
}
