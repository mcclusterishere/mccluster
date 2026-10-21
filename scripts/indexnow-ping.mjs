#!/usr/bin/env node
/* Tell IndexNow search engines (Bing, Yandex, Seznam, Naver; Bing's index
   also feeds ChatGPT search) that pages changed, instead of waiting for a
   crawl. The key file 652fa7fba334f6ba19e940ed1c7208a0.txt at the site root proves the ping
   comes from the site's owner.

     node scripts/indexnow-ping.mjs resume-it-support.html llms.txt ...

   Run it after the change is live on matthew.mccluster.org. */
const HOST = 'matthew.mccluster.org';
const KEY = '652fa7fba334f6ba19e940ed1c7208a0';
const paths = process.argv.slice(2);
if (!paths.length) { console.error('usage: indexnow-ping.mjs <path> [path...]'); process.exit(1); }
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: `https://${HOST}/${KEY}.txt`,
    urlList: paths.map((p) => `https://${HOST}/${p.replace(/^\//, '')}`)
  })
});
console.log('IndexNow', res.status, res.statusText, await res.text());
process.exit(res.status === 200 || res.status === 202 ? 0 : 1);
