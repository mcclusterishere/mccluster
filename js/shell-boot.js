/* Before first paint: reserve navigation while the server verifies this session.
   This is only a visual loading state. It never grants an owner role. */
(function () {
  'use strict';
  const h = document.documentElement;
  const topLevel = window.parent === window;
  const displayMode = window.matchMedia && window.matchMedia('(display-mode: standalone)');
  // Frames share the app's presentation, but only the outer document consumes
  // the device inset. This also runs before a retained World frame first paints.
  function appMode() {
    const installed = window.navigator.standalone === true || !!(displayMode && displayMode.matches);
    h.classList.toggle('mcc-installed-app', installed);
    h.classList.toggle('mcc-app-top', installed && topLevel);
  }
  appMode();
  if (displayMode && displayMode.addEventListener) displayMode.addEventListener('change', appMode);
  else if (displayMode && displayMode.addListener) displayMode.addListener(appMode);
  if (!topLevel) {
    /* A MUSIC VIEW (music slice M5, js/music-shell.js). Only the music shell's own frame is ever looked at: the
       World's (another origin), Control's front-page preview and any embed are left exactly as they were. A music
       page there carries <html data-music-view> and is adopted before any other script runs; its own bar and chip
       are hidden before first paint (the retained document's are the one bar). Any other document in that frame
       (a script navigation, the service worker's offline index.html) is stopped before its body and handed back to
       the shell to route, so the front page never renders in a frame. */
    try {
      const shell = window.parent.MCC_MUSIC_SHELL, frame = window.frameElement;
      if (shell && frame && typeof shell.owns === 'function' && shell.owns(frame)) {
        const view = h.hasAttribute('data-music-view') ? shell.adopt(window) : null;
        if (view) {
          window.MCC_MUSIC_VIEW = view;
          h.classList.add('mcc-music-view');
          const own = document.createElement('style');
          own.textContent = 'html.mcc-music-view .appbar,html.mcc-music-view .mcc-auth-nav,html.mcc-music-view #musicMini,html.mcc-music-view #musicNow,html.mcc-music-view .pocket,html.mcc-music-view #mccPrivacyNotice{display:none!important}html.mcc-music-view body{padding-bottom:var(--mcc-view-clear,0px)!important}html.mcc-music-view [data-mcc-view-heading]:focus{outline:none;box-shadow:none}';
          document.head.appendChild(own);
        } else {
          window.stop();
          shell.unexpected(window);
        }
      }
    } catch (e) { /* a parent on another origin: not the shell's frame */ }
    return;
  }
  h.classList.add('mcc-shell-pending');
  const style = document.createElement('style');
  style.textContent = 'html.mcc-shell-pending .appbar,html.mcc-shell-pending .cr-sections,html.mcc-shell-pending #cpGate{visibility:hidden!important}html.halo-loading #deck,html.halo-loading body>header,html.halo-loading .world-mode,html.halo-loading .world-tools,html.halo-loading .globe-controls,html.halo-loading .globe-data,html.halo-loading #worldFeed{visibility:hidden!important}html.halo-loading body::after{content:"Opening Halo…";position:fixed;top:24px;left:24px;color:#d8e4ef;font:14px system-ui;z-index:4}';
  document.head.appendChild(style);
  const halo = /action-globe\.html$/.test(location.pathname) && new URLSearchParams(location.search).has('halo');
  if (halo) h.classList.add('halo-loading');
  // A missing script must not strand the page without its ordinary navigation.
  let fallback = setTimeout(() => h.classList.remove('mcc-shell-pending','halo-loading'), 12000);
  window.MCC_SHELL = Object.freeze({
    navigationReady() { h.classList.remove('mcc-shell-pending'); },
    haloReady() { h.classList.remove('halo-loading'); },
    clear() { clearTimeout(fallback); h.classList.remove('mcc-shell-pending','halo-loading'); }
  });
})();
