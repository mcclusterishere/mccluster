// Caches only this app's own static files. API and auth responses (api.mccluster.org,
// Supabase, anything sent with Authorization) are never stored, so a signed-out
// device holds no rider, driver or renter data. Bumping CACHE deletes older caches.
const CACHE='we-rentals-v2';
const SHELL=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./assets/we-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||u.origin!==self.location.origin||r.headers.has('authorization'))return;
  // HTML is network-first and never stored under its query string (payment returns carry booking ids).
  if(r.mode==='navigate'||r.destination==='document'){e.respondWith(fetch(r).catch(()=>caches.match('./index.html')));return;}
  e.respondWith(fetch(r).then(res=>{if(res.ok&&res.type==='basic'&&!u.search){const copy=res.clone();caches.open(CACHE).then(c=>c.put(r,copy));}return res;}).catch(()=>caches.match(r)));
});
