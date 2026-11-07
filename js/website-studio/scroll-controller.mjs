/** Independently written native scroll controller. No GSAP/Lenis dependency.
 * Drives a frame index; decoding, bounded caching and a poster are the media
 * renderer's job. Not a claim of codec support or a complete website builder.
 */
export function frameAt(progress, frameCount) {
  if (!Number.isFinite(progress) || !Number.isSafeInteger(frameCount) || frameCount < 1)
    throw new TypeError('finite progress and positive frame count required');
  return Math.round(Math.max(0, Math.min(1, progress)) * (frameCount - 1));
}
export function sceneProgress(top, height, viewportHeight) {
  if (![top, height, viewportHeight].every(Number.isFinite) || height <= 0 || viewportHeight <= 0)
    throw new TypeError('valid scene geometry required');
  const travel = height - viewportHeight;
  return travel > 0 ? Math.max(0, Math.min(1, -top / travel)) : (top < 0 ? 1 : 0);
}
/** element is the full scroll section containing a CSS-sticky visual. It must
 * have positive height. onFrame must keep the last decoded frame/poster if the
 * requested frame is not loaded; it must NOT start processing jobs on scroll.
 */
export function attachScrollSequence({ element, frameCount, onFrame, win = globalThis.window }) {
  if (!element?.getBoundingClientRect || typeof onFrame !== 'function' || !win)
    throw new TypeError('element, callback and window required');
  frameAt(0, frameCount);
  let scheduled = null, disposed = false, previous = -1;
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  function draw() {
    scheduled = null; if (disposed) return;
    const rect = element.getBoundingClientRect();
    // Hidden/zero-size sections are not an error and should not animate.
    const progress = reduced?.matches || rect.height <= 0 || win.innerHeight <= 0 ? 0
      : sceneProgress(rect.top, rect.height, win.innerHeight);
    const frame = frameAt(progress, frameCount);
    if (frame !== previous) { previous = frame; onFrame(frame, progress); }
  }
  function schedule() {
    if (!disposed && scheduled === null) scheduled = win.requestAnimationFrame(draw);
  }
  win.addEventListener('scroll', schedule, { passive: true });
  win.addEventListener('resize', schedule, { passive: true });
  reduced?.addEventListener?.('change', schedule);
  const observer = win.ResizeObserver ? new win.ResizeObserver(schedule) : null;
  observer?.observe(element); schedule();
  return {
    refresh: schedule,
    destroy() {
      disposed = true;
      if (scheduled !== null) win.cancelAnimationFrame(scheduled);
      scheduled = null;
      win.removeEventListener('scroll', schedule); win.removeEventListener('resize', schedule);
      reduced?.removeEventListener?.('change', schedule); observer?.disconnect();
    }
  };
}
/** An owner's auto-start setting is intent, not browser permission. The player
 * must still catch play() rejection, display Play, and coordinate one audible
 * source. No immersive experience is entered automatically.
 */
export function mayRequestAutoStart({ intent, visitorSoundEnabled, visible, kind, reducedMotion = false }) {
  return intent === 'enter_after_consent' && visitorSoundEnabled === true && visible === true
    && reducedMotion === false && ['music', 'native_video'].includes(kind);
}
