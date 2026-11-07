/* One playing document, explicit same-origin rooms. No token, audio URL or
   entitlement is transported. Each room runs its original authorization gate. */
import { mountCapsule } from './game-hub/floating-capsule.mjs';

const PATHS = /^\/(?:listen|game-hub|control|prim3-transit|prim3|prim3-world|city-arcade|fictional-city|equity-uprise-server-lab-3d)\.html$|^\/screens\/terminal\.html$/;
export function journeyURL(href, base) {
  try {
    const u = new URL(href, base), b = new URL(base);
    return u.origin === b.origin && /^https?:$/.test(u.protocol) && PATHS.test(u.pathname) &&
      !u.username && !u.password && !u.hash.includes('mcc_handoff=') ? u : null;
  } catch { return null; }
}

export function installMusicJourneys({ root }) {
  if (window.MCC_MUSIC_JOURNEYS) return window.MCC_MUSIC_JOURNEYS;
  const engine = window.MCC_MUSIC;
  if (!engine) throw new Error('Music transport is unavailable');
  const original = location.href, originalTitle = document.title;
  let frame, shell, capsule, movement, timer, destination = '', returnFocus, suspended = false;
  const hidden = new Map();
  const style = document.createElement('link'); style.rel = 'stylesheet';
  style.href = new URL('css/music-journeys.css', root).href; document.head.append(style);
  const sameRoom = (a, b) => a.pathname === b.pathname && a.search === b.search;
  function accepts(child) {
    try { return !!frame && child === frame.contentWindow && child.location.origin === location.origin &&
      !!journeyURL(child.location.href, original); } catch { return false; }
  }
  function attachEngine(child) {
    if (!accepts(child)) return false;
    child.MCC_MUSIC = engine;
    if (!child.__mccMusicSurface) {
      child.__mccMusicSurface = true;
      const dispose = engine.bindSurface(child.document);
      child.addEventListener('pagehide', dispose, {once:true});
    }
    return true;
  }
  function paint() {
    if (!capsule) return;
    capsule.querySelector('[data-song]').textContent = engine.current()?.title || 'Music';
    const b = capsule.querySelector('[data-play]');
    b.textContent = engine.audio.paused ? 'Play' : 'Pause';
    b.setAttribute('aria-label', `${b.textContent} ${engine.current()?.title || 'music'}`);
    b.setAttribute('aria-pressed', String(!engine.audio.paused));
  }
  function conceal() {
    if (suspended) return;
    for (const node of document.body.children) {
      if (/^(SCRIPT|LINK|STYLE|TEMPLATE)$/.test(node.tagName) || node === shell || node === capsule ||
          node.matches('.appbar, .mcc-auth-nav, #mccAuthChip, #mccDestinations, #mccProfileMenu')) continue;
      if (!hidden.has(node)) hidden.set(node, node.inert);
      node.setAttribute('data-mcc-retained-hidden', ''); node.inert = true;
    }
  }
  function suspendForWorld() {
    if (!destination || suspended) return;
    suspended = true; clearTimeout(timer);
    if (shell) shell.hidden = true;
    if (capsule) capsule.hidden = true;
    for (const [node, inert] of hidden) { node.removeAttribute('data-mcc-retained-hidden'); node.inert = inert; }
    hidden.clear();
    document.documentElement.classList.remove('mcc-music-room-open');
  }
  function showOriginal() {
    clearTimeout(timer); destination = ''; suspended = false;
    if (shell) { shell.hidden = true; frame.contentWindow.location.replace('about:blank'); }
    if (capsule) capsule.hidden = true;
    for (const [node, inert] of hidden) { node.removeAttribute('data-mcc-retained-hidden'); node.inert = inert; }
    hidden.clear();
    document.documentElement.dataset.musicJourneyHidden = 'false';
    document.documentElement.classList.remove('mcc-music-room-open');
    document.title = originalTitle;
    window.dispatchEvent(new CustomEvent('mcc:journey-visibility', {detail:{visible:true}}));
    window.dispatchEvent(new CustomEvent('mcc:journey-route'));
    returnFocus?.focus?.();
  }
  function status(text) {
    const box = shell.querySelector('[data-room-status]'); box.hidden = false;
    box.querySelector('[role=status]').textContent = text;
  }
  function create() {
    if (shell) return;
    shell = document.createElement('section'); shell.id = 'mccMusicRoom'; shell.hidden = true;
    shell.setAttribute('aria-label', 'Current page');
    frame = document.createElement('iframe'); frame.title = 'Current page'; frame.allow = 'autoplay; fullscreen';
    shell.append(frame);
    const notice = document.createElement('div'); notice.dataset.roomStatus = '';
    notice.innerHTML = '<p role="status">Opening page…</p><button type="button" data-retry>Retry</button> <button type="button" data-return>Return to previous page</button> <a data-direct>Open directly (stops music)</a>';
    notice.querySelector('[data-retry]').onclick = () => open(destination, false, true);
    notice.querySelector('[data-return]').onclick = () => navigate(original);
    shell.append(notice); document.body.append(shell);
    capsule = document.createElement('section'); capsule.id = 'mccJourneyCapsule'; capsule.hidden = true;
    capsule.setAttribute('aria-label', 'Music and page controls');
    capsule.innerHTML = '<div class="mjc-row"><button type="button" data-capsule-drag aria-label="Move controls. Arrow keys move; Home resets.">⠿</button><button type="button" data-play>Play</button><b data-song></b><button type="button" data-capsule-toggle aria-expanded="false" aria-controls="mccJourneyPanel">Controls</button></div><div id="mccJourneyPanel" data-capsule-panel hidden><button type="button" data-next>Next track</button><button type="button" data-context></button><p role="status" data-music-error></p><div class="mjc-move" role="group" aria-label="Move controls"><button type="button" data-capsule-move="-24,0" aria-label="Move left">←</button><button type="button" data-capsule-move="0,-24" aria-label="Move up">↑</button><button type="button" data-capsule-move="0,24" aria-label="Move down">↓</button><button type="button" data-capsule-move="24,0" aria-label="Move right">→</button><button type="button" data-capsule-move="reset">Reset</button></div></div>';
    document.body.append(capsule);
    const run = action => {
      const error = () => { capsule.querySelector('[data-music-error]').textContent = 'Playback could not start. Try Play again.'; };
      capsule.querySelector('[data-music-error]').textContent = '';
      try { Promise.resolve(action()).catch(error); } catch { error(); }
    };
    capsule.querySelector('[data-play]').onclick = () => run(() => engine.audio.paused ? engine.resume() : engine.pause());
    capsule.querySelector('[data-next]').onclick = () => run(() => engine.next());
    movement = mountCapsule({root:capsule, workspace:shell, storageKey:'mcc.music.capsule.v1'});
    new MutationObserver(() => { if (destination) conceal(); }).observe(document.body, {childList:true});
    // Child load alone is not proof of a usable room: attach() is the handshake.
    frame.addEventListener('load', () => {
      try { if (accepts(frame.contentWindow)) attach(frame.contentWindow); }
      catch { /* visible timeout recovery remains available */ }
    });
  }
  function ready(child) {
    if (!accepts(child)) return;
    destination = child.location.href;
    clearTimeout(timer); shell.querySelector('[data-room-status]').hidden = true;
    if (suspended) return;
    frame.title = child.document.title || 'Current page'; document.title = frame.title;
    const games = /\/game-hub.html$/.test(child.location.pathname);
    capsule.hidden = games; shell.classList.toggle('mjc-game-room', games);
    if (games) shell.style.top = '0px'; else movement.collapse();
    const context = capsule.querySelector('[data-context]');
    // Page-specific actions reuse existing page controls; no extra global menu.
    if (/\/listen.html$/.test(child.location.pathname)) {
      context.textContent = 'Search this music library';
      context.onclick = () => { movement.collapse(); child.document.querySelector('#q')?.focus(); };
    } else if (/\/control.html$/.test(child.location.pathname)) {
      context.textContent = 'Focus Control workspace';
      context.onclick = () => { movement.collapse(); const main = child.document.querySelector('main, [role=main]');
        if (main) { main.tabIndex = -1; main.focus(); } };
    } else {
      context.textContent = 'Back to Game Hub'; context.onclick = () => navigate(new URL('game-hub.html', root).href);
    }
    window.dispatchEvent(new CustomEvent('mcc:journey-route'));
    paint();
  }
  function attach(child) {
    if (!attachEngine(child)) return false;
    if (child.__mccMusicRoomAttached) { ready(child); return true; }
    child.__mccMusicRoomAttached = true;
    const css = child.document.createElement('style');
    css.textContent = '@view-transition{navigation:none}.appbar,#mccAuthChip,#musicMini{display:none!important}html{--appbar-h:0px}body.gh-body #ghMain{bottom:8px}body.gh-body #ghCapsule{--capsule-top:64px}';
    child.document.head.append(css);
    child.document.querySelector('.appbar')?.remove();
    child.MCC_SHELL?.clear();
    child.document.addEventListener('click', e => {
      const a = e.target.closest?.('a[href]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ||
          a.hasAttribute('download') || a.target && a.target !== '_self') return;
      const u = new URL(a.href, child.location.href);
      if (!/^https?:$/.test(u.protocol)) return;
      // Preserve local anchors and native Control routing inside the active room.
      if (sameRoom(u, new URL(child.location.href))) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (!navigate(u.href)) window.MCC_BAR.navigation.go(u.href);
    }, true);
    child.addEventListener('mcc:auth-changed', () => {
      // The child uses the same canonical origin storage, never a transported token.
      window.dispatchEvent(new CustomEvent('mcc:auth-changed'));
      window.MCC_GATED?.forget();
    });
    child.addEventListener('hashchange', () => { if (accepts(child)) { destination = child.location.href; window.dispatchEvent(new CustomEvent('mcc:journey-route')); } });
    ready(child);
    return true;
  }
  function open(href, push = true, retry = false) {
    const u = journeyURL(href, original); if (!u) return false;
    window.MCC_WORLD_AUDIO?.leaveForJourney?.();
    suspended = false;
    const source = new URL(original);
    if (sameRoom(u, source)) {
      if (push) history.pushState({mccMusicJourney:original}, '', original);
      showOriginal();
      if (u.hash !== source.hash) location.hash = u.hash;
      return true;
    }
    create(); returnFocus = document.activeElement;
    if (push) history.pushState({mccMusicJourney:u.href}, '', source.pathname + source.search + '#mcc_music_room=' + encodeURIComponent(u.pathname + u.search + u.hash));
    const previous = destination; destination = u.href;
    document.documentElement.dataset.musicJourneyHidden = 'true';
    document.documentElement.classList.add('mcc-music-room-open');
    window.dispatchEvent(new CustomEvent('mcc:journey-visibility', {detail:{visible:false}}));
    shell.hidden = false; capsule.hidden = false; conceal(); movement.collapse(); paint();
    shell.querySelector('[data-direct]').href = destination;
    shell.querySelector('[data-direct]').onclick = e => { e.preventDefault(); location.assign(destination); };
    clearTimeout(timer);
    if (!retry && previous && sameRoom(u, new URL(previous)) && accepts(frame.contentWindow)) {
      frame.contentWindow.location.replace(u.href); ready(frame.contentWindow); return true;
    }
    status('Opening page…'); frame.contentWindow.location.replace(destination);
    timer = setTimeout(() => status('This page has not finished opening. Retry or return; your music is still here.'), 15000);
    return true;
  }
  function navigate(href) { return open(href); }
  // Host routers must not interpret the shell's private fragment as a course
  // or Control route while that source document is retained out of view.
  window.addEventListener('hashchange', e => {
    if (location.hash.startsWith('#mcc_music_room=')) e.stopImmediatePropagation();
  }, true);
  window.addEventListener('popstate', e => {
    if (e.state?.mccWorldAudio) { suspendForWorld(); return; }
    const href = e.state?.mccMusicJourney;
    if (href && journeyURL(href, original)) open(href, false);
    else showOriginal();
  });
  for (const type of ['mcc:music-state', 'mcc:music-selected']) window.addEventListener(type, e => {
    paint(); if (frame && accepts(frame.contentWindow)) frame.contentWindow.dispatchEvent(new frame.contentWindow.CustomEvent(type, {detail:e.detail}));
  });
  window.MCC_MUSIC_JOURNEYS = {navigate, attach, attachEngine, suspendForWorld, active:() => !!destination && !suspended, location:() => suspended ? window.location : new URL(destination || original)};
  return window.MCC_MUSIC_JOURNEYS;
}
