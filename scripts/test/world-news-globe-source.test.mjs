import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

const get = path => readFile(new URL('../../' + path, import.meta.url),'utf8');

test('World has one mixed feed: news + posts, no separate News page or public caveat paragraphs', async () => {
  const [html, client, reader, travel, globe] = await Promise.all([
    get('mnet.html'), get('js/mnet.js'), get('js/world-news-globe.js'),
    get('js/travel/world-travel.mjs'), get('js/action-globe.js')
  ]);
  assert.match(html,/data-world-mode="posts" aria-pressed="false">Feed<\/button>/);
  assert.match(html,/id="mnFeed"/);
  assert.doesNotMatch(html,/id="worldNewsDeck"|News around the world|Story locations are GDELT mentions|Full articles require publisher permission/);
  assert.doesNotMatch(html,/data-hu-feed=|From the community/);
  assert.match(client,/interleaveFeed\(items, news\)/);
  assert.match(client,/function newsCard\(/);
  assert.match(client,/function postCard\(/);
  assert.match(client,/function fetchNews\(/);
  assert.match(client,/MCC_WORLD_NEWS_ITEMS/);
  assert.match(client,/mcc:world-news-loaded/);
  assert.match(reader,/MCC_WORLD_NEWS_READER/);
  assert.match(reader,/worldNewsReader/);
  assert.match(reader,/Join the conversation/);
  assert.match(reader,/document\.body\.appendChild\(reader\)/);
  assert.doesNotMatch(reader,/in-app full text is unavailable|publisher permission|discovery record, not|innerHTML|window\.open|fetch\(.*\.url/);
  assert.match(travel,/data-world-mode/);
  assert.match(globe,/worldNewsId/);
  assert.match(globe,/hu:world-news-selected/);
});

test('World geolocations retain validated article mentions and premium marker identity', async () => {
  const [client,reader,globe,globeCss,legacy] = await Promise.all([
    get('js/mnet.js'),get('js/world-news-globe.js'),get('js/action-globe.js'),
    get('css/world-news-globe.css'),get('js/docket-cohort-showcase.js')
  ]);
  assert.match(reader,/world-news-pins/);
  assert.match(reader,/Number\.isFinite/);
  assert.match(reader,/Math\.abs\(x\.lat\)/);
  assert.match(globe,/function worldNewsMarker\(/);
  assert.match(globe,/billboard:\{image:marker/);
  assert.match(globe,/properties:\{worldNewsId:x\.id\}/);
  assert.match(globe,/publicNewsOn/);
  assert.match(client,/mn__news-credit|mnNewsCredit/);
  assert.match(await get('mnet.html'),/https:\/\/www\.gdeltproject\.org\//);
  assert.match(globeCss,/world-news-reader::backdrop/);
  assert.match(legacy,/dc-event-feed/);
  const archive = await get('docket-516r-cohort.html');
  assert.match(archive,/css\/world-news-globe\.css/);
});

test('Native post and news comments share one UI; new news writes are flag gated and private', async () => {
  const [client,api,sql,html] = await Promise.all([
    get('js/mnet.js'), get('workers/mccluster/src/platform-api.js'),
    get('supabase/pending/world_news_discussions_v1.sql'), get('mnet.html')
  ]);
  assert.match(client,/function discussionHtml\(/);
  assert.match(client,/function bindDiscussions\(/);
  assert.match(client,/data-discussion-toggle/);
  assert.match(client,/discussionHtml\('post', id\)/);
  assert.match(client,/discussionHtml\('news', n\.id\)/);
  assert.match(client,/\/v1\/mnet\/posts\//);
  assert.match(client,/\/v1\/world\/news\//);
  assert.match(api,/function handleWorldNewsDiscussion\(/);
  assert.match(api,/WORLD_NEWS_COMMENTS_ENABLED/);
  assert.match(api,/blockedByViewer,blockedViewer/);
  assert.match(api,/blocked_m_uid=in\.\(/);
  assert.match(api,/blocker_m_uid=in\.\(/);
  assert.doesNotMatch(api,/await networkBlocked\(env,muid,comment\.author_m_uid\)/,
    'news comment reads must not perform one database lookup per author');
  assert.match(sql,/create table if not exists public\.media_news_comments/);
  assert.match(sql,/references public\.media_news_articles\(id\)/);
  assert.match(sql,/enable row level security/);
  assert.match(sql,/revoke all on public\.media_news_comments from public, anon, authenticated/);
  assert.match(sql,/media_news_comment_rate_guard_v1/);
  assert.match(html,/id="mnNewsCredit"/);
});
