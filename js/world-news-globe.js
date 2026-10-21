/* World news belongs to the same stream as community posts. This module owns
   only the in-app story view and geographic marker bridge, never a second feed.
   The globe is sent the stories the feed is showing (window.MCC_WORLD_NEWS_ITEMS, js/mnet.js); it draws no pin per
   story (the news heat map counts them, js/action-globe.js), only the one whose place a card pointed to.
   GDELT mention/permission caveats are retained in internal data and docs. */
(function () {
  'use strict';
  const frame = document.getElementById('mnWorldFrame');
  if (!frame) return;
  const mode = () => window.MCC_WORLD_MODE?.get?.() || document.documentElement.dataset.worldMode || 'travel';
  const feed = document.getElementById('mnFeed');
  const geo = x => x && typeof x.lat === 'number' && typeof x.lon === 'number' &&
    Number.isFinite(x.lat) && Number.isFinite(x.lon) &&
    Math.abs(x.lat) <= 90 && Math.abs(x.lon) <= 180 && (x.lat !== 0 || x.lon !== 0);
  const valid = x => x && typeof x.id === 'string' && typeof x.title === 'string' &&
    typeof x.domain === 'string' && typeof x.url === 'string' && /^https?:\/\//i.test(x.url);
  const items = () => {
    try { return (window.MCC_WORLD_NEWS_ITEMS?.() || []).filter(valid).slice(0,120); }
    catch (_) { return []; }
  };
  function send(data) {
    if (frame.contentWindow) frame.contentWindow.postMessage(data, location.origin);
  }
  function sync() {
    const on = mode() !== 'travel';
    send({type:'hu:world-news-pins',on,items:on ? items().filter(geo).map(x => ({id:x.id,lat:x.lat,lon:x.lon})) : []});
  }

  const reader = document.createElement('dialog');
  reader.id = 'worldNewsReader';
  reader.className = 'world-news-reader';
  reader.setAttribute('aria-labelledby','worldNewsReaderTitle');
  const label = document.createElement('p');
  label.className = 'world-news-reader__eyebrow';
  label.textContent = 'World · News';
  const title = document.createElement('h3');
  title.id = 'worldNewsReaderTitle';
  const meta = document.createElement('p');
  meta.className = 'world-news-meta';
  const actions = document.createElement('div');
  actions.className = 'world-news-reader__actions';
  const discuss = document.createElement('button');
  discuss.type = 'button';
  discuss.textContent = 'Join the conversation';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Close';
  close.onclick = () => reader.close();
  actions.append(discuss, close);
  reader.append(label, title, meta, actions);
  document.body.appendChild(reader);
  let prior = null, currentId = null;
  reader.addEventListener('close', () => { prior?.focus?.(); prior = null; });
  function discussion(id) {
    const card = [...(feed?.querySelectorAll('[data-news-id]') || [])]
      .find(el => el.dataset.newsId === id);
    if (!card) return;
    window.MCC_WORLD_MODE?.set?.('posts');
    card.scrollIntoView({block:'center',behavior:'smooth'});
    card.querySelector('[data-discussion-toggle]')?.click();
  }
  function discussionAvailable(id) {
    const card = [...(feed?.querySelectorAll('[data-news-id]') || [])]
      .find(el => el.dataset.newsId === id);
    // Actual live feed capabilities own the input. Never advertise a dead
    // discussion action while the server flag or SQL migration is disabled.
    return !!card?.querySelector('[data-discussion-toggle]');
  }
  function openStory(story, opener) {
    if (!valid(story)) return;
    discuss.hidden = !discussionAvailable(story.id);
    prior = opener || null;
    currentId = story.id;
    title.textContent = story.title;
    const when = story.seen_at && !Number.isNaN(Date.parse(story.seen_at))
      ? new Date(story.seen_at).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : '';
    meta.textContent = [story.domain,when,story.place].filter(Boolean).join(' · ');
    if (!reader.open) reader.showModal();
  }
  discuss.onclick = () => {
    const id = currentId;
    if (!id || !discussionAvailable(id)) {
      discuss.hidden = true;
      return; // The modal stays open; the Close button remains useful.
    }
    reader.close();
    discussion(id);
  };
  window.MCC_WORLD_NEWS_READER = {open:openStory};
  window.addEventListener('mcc:world-news-loaded', sync);
  /* the feed rendered a different set of stories (a country picked, a search, a scope, a mission): the pins follow */
  window.addEventListener('mcc:world-news-shown', sync);
  window.addEventListener('mcc:world-mode', sync);
  window.addEventListener('message', e => {
    if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
    const data = e.data || {};
    if (data.type === 'hu:globe-ready') sync();
    if (data.type === 'hu:world-news-selected' && typeof data.id === 'string') {
      window.MCC_WORLD_MODE?.set?.('posts');
      discussion(data.id);
    }
  });
  sync();
})();
