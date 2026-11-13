self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('whip-equipped-')).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
// Demo uses ordinary network loading; never cache ride or account responses.
