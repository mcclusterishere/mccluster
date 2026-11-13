self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('we-rentals-')).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
// Do not cache rental sessions or restore the retired reservation UI offline.
