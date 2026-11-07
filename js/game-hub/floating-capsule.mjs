// A movable control surface that reserves a separate, unobstructed scrolling workspace.
export function clampPosition(point, { width, height, panelWidth, panelHeight, top = 64, bottom = 88, reserve = 96 }) {
  const x = Number.isFinite(point?.x) ? point.x : 12;
  const y = Number.isFinite(point?.y) ? point.y : top;
  return { x: Math.max(8, Math.min(x, width - panelWidth - 8)),
    y: Math.max(top, Math.min(y, height - bottom - panelHeight - reserve - 8)) };
}
export function mountCapsule({ root, workspace, storageKey = 'mcc.gamehub.capsule.v1' }) {
  const handle = root.querySelector('[data-capsule-drag]');
  const toggle = root.querySelector('[data-capsule-toggle]');
  const panel = root.querySelector('[data-capsule-panel]');
  let point, drag;
  try { point = JSON.parse(localStorage.getItem(storageKey)); } catch { /* use default */ }
  function save() { try { localStorage.setItem(storageKey, JSON.stringify(point)); } catch { /* private mode */ } }
  function layout() {
    if (root.hidden) return;
    const viewport = window.visualViewport;
    const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
    const left = viewport?.offsetLeft || 0, offsetTop = viewport?.offsetTop || 0;
    const top = parseFloat(getComputedStyle(root).getPropertyValue('--capsule-top')) || 64;
    const bottom = parseFloat(getComputedStyle(workspace).bottom) || 88;
    root.style.width = Math.min(340, width - 16) + 'px';
    root.style.maxHeight = Math.max(52, height - top - bottom - 104) + 'px';
    point = clampPosition(point, { width, height, panelWidth: root.offsetWidth, panelHeight: root.offsetHeight, top, bottom });
    root.style.left = (left + point.x) + 'px'; root.style.top = (offsetTop + point.y) + 'px';
    workspace.style.top = (offsetTop + point.y + root.offsetHeight + 8) + 'px';
  }
  function collapse(focus = false) {
    if (panel.contains(document.activeElement)) focus = true;
    panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    root.scrollTop = 0; layout(); if (focus) toggle.focus();
  }
  toggle.addEventListener('click', () => {
    if (!panel.hidden) return collapse(true);
    panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); layout();
  });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); collapse(true); } });
  function move(dx, dy) { point = { x: point.x + dx, y: point.y + dy }; layout(); save(); }
  handle.addEventListener('keydown', e => {
    const steps = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] };
    if (steps[e.key]) { e.preventDefault(); move(...steps[e.key]); }
    if (e.key === 'Home') { e.preventDefault(); point = null; layout(); save(); }
  });
  root.querySelectorAll('[data-capsule-move]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.capsuleMove === 'reset') { point = null; layout(); save(); }
    else move(...b.dataset.capsuleMove.split(',').map(Number));
  }));
  handle.addEventListener('pointerdown', e => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, origin: { ...point }, moved: false };
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true; point = { x: drag.origin.x + dx, y: drag.origin.y + dy }; layout();
  });
  function finish(e) { if (drag?.id === e.pointerId) { if (drag.moved) save(); drag = null; } }
  handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
  const observer = new ResizeObserver(layout); observer.observe(root);
  addEventListener('resize', layout); window.visualViewport?.addEventListener('resize', layout);
  window.visualViewport?.addEventListener('scroll', layout);
  layout();
  return { collapse, destroy() { observer.disconnect(); removeEventListener('resize', layout);
    window.visualViewport?.removeEventListener('resize', layout); window.visualViewport?.removeEventListener('scroll', layout); } };
}
