/* The thumbnail editor (js/mnet.js loadThumbVideo): a picture chosen while the video is still loading is saving, so the
   video landing afterwards never wipes "Saving the thumbnail…" or puts another message over it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../../js/mnet.js', import.meta.url), 'utf8');

test('once the video has loaded, the editor speaks only when no save is running', () => {
  const start = SRC.indexOf('function loadThumbVideo(');
  const body = SRC.slice(start, SRC.indexOf('function clockText(', start));
  const afterLoad = body.slice(body.indexOf('}).then(function () {'));
  const calls = afterLoad.match(/[^\n]*thumbStatus\([^\n]*/g) || [];
  assert.ok(calls.length >= 3, 'the three messages after the load are found');
  for (const line of calls) assert.match(line, /if \(!thumbEdit\.busy\) thumbStatus\(/, line.trim());
});
