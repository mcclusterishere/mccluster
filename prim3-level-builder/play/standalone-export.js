/* Keep the unbundled canonical runtime's downloadable HTML self-contained. */
(function () {
  'use strict';
  window.P3DownloadStandalone = async function (originalDocument) {
    const button = document.getElementById('download-html');
    if (button?.disabled) return;
    const oldLabel = button?.innerHTML;
    if (button) { button.disabled = true; button.textContent = 'Preparing HTML…'; }
    try {
      const doc = new DOMParser().parseFromString(originalDocument, 'text/html');
      const cache = new Map();
      function resource(path, type) {
        const url = new URL(path, location.href);
        if (url.origin !== location.origin) throw new Error('A game resource is outside this site.');
        const key = type + ':' + url.href;
        if (!cache.has(key)) cache.set(key, fetch(url.href, { credentials: 'same-origin' }).then(async response => {
          if (!response.ok) throw new Error('A required game resource could not be loaded.');
          return type === 'text' ? response.text() : response.blob();
        }));
        return cache.get(key);
      }
      for (const link of [...doc.querySelectorAll('link[rel="stylesheet"][href]')]) {
        const style = doc.createElement('style');
        style.textContent = (await resource(link.getAttribute('href'), 'text')).replace(/<\/style/gi, '<\\/style');
        link.replaceWith(style);
      }
      const scriptNodes = [...doc.querySelectorAll('script')].filter(script => script.type !== 'application/json');
      const code = await Promise.all(scriptNodes.map(script => script.src ? resource(script.getAttribute('src'), 'text') : Promise.resolve(script.textContent)));
      scriptNodes.forEach(script => script.remove());
      for (const text of code) {
        const script = doc.createElement('script'); script.textContent = text.replace(/<\/script/gi, '<\\/script'); doc.body.append(script);
      }
      for (const img of [...doc.querySelectorAll('img[src]')]) {
        const src = img.getAttribute('src'); if (src.startsWith('data:')) continue;
        const blob = await resource(src, 'blob');
        img.src = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('An image could not be embedded.')); reader.readAsDataURL(blob); });
      }
      if (window.P3CustomLevelDoc) {
        doc.getElementById('prim3-embedded-level')?.remove();
        const level = doc.createElement('script'); level.type = 'application/json'; level.id = 'prim3-embedded-level';
        level.textContent = JSON.stringify(window.P3CustomLevelDoc).replace(/</g, '\\u003c'); doc.head.append(level);
      }
      const data = '<!doctype html>\n' + doc.documentElement.outerHTML;
      const blob = new Blob([data], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = window.P3CustomLevelDoc ? 'PRIM3-Custom-Level.html' : 'PRIM3-Black-Signal.html';
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) {
      const message = document.getElementById('message');
      if (message) message.textContent = 'Could not prepare the offline HTML. ' + (error.message || 'Please try again while connected.');
    } finally { if (button) { button.disabled = false; button.innerHTML = oldLabel; } }
  };
})();
