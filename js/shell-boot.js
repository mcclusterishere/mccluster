/* Before first paint: reserve navigation while the server verifies this session.
   This is only a visual loading state. It never grants an owner role. */
(function () {
  'use strict';
  const h = document.documentElement;
  if (window.parent !== window) return;
  h.classList.add('mcc-shell-pending');
  const style = document.createElement('style');
  style.textContent = 'html.mcc-shell-pending .appbar,html.mcc-shell-pending .cr-rail,html.mcc-shell-pending .cr-bottom,html.mcc-shell-pending #cpGate{visibility:hidden!important}html.halo-loading #deck,html.halo-loading body>header,html.halo-loading .world-mode,html.halo-loading .world-tools,html.halo-loading .globe-controls,html.halo-loading .globe-data,html.halo-loading #worldFeed{visibility:hidden!important}html.halo-loading body::after{content:"Opening Halo…";position:fixed;top:24px;left:24px;color:#d8e4ef;font:14px system-ui;z-index:4}';
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
