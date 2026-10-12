import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const router = readFileSync(new URL('../src/analytics/router.js', import.meta.url), 'utf8');
const engine = readFileSync(new URL('../../../js/music-engine.js', import.meta.url), 'utf8');
const explorer = readFileSync(new URL('../../../js/analytics-users.js', import.meta.url), 'utf8');

test('creator play starts count canonical events, not the paired access-state event', () => {
  assert.match(router, /\['music_play','song_start'\]\.includes\(e\.name\)/);
  assert.doesNotMatch(router, /\['music_play','music_full_play','music_preview_play','song_start'\]\.includes/);
});
test('creator completion emits stable creator track identifier', () => {
  assert.match(engine, /trackEvent\("music_complete",[\s\S]*?creator_track_id: current && current\.creatorTrackId/);
});
test('owner explorer queries bounded events per uid rather than a shared batch cap', () => {
  assert.match(router, /for \(const id of ids\)/);
  assert.match(router, /uid=eq\.' \+ encodeURIComponent\(id\)/);
});
test('listening activity includes album player events', () => {
  assert.match(router, /name=in\.\(album_play,music_play,music_full_play,music_preview_play,music_complete,song_start,track_share\)/);
});
test('owner explorer supports subsequent account pages', () => {
  assert.match(explorer, /hasMore=data\.has_more===true/);
  assert.match(explorer, /page="\+page/);
  assert.match(explorer, /load\(currentPage\+1\)/);
});
