import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFile} from 'node:fs/promises';
const get=p=>readFile(new URL('../../'+p,import.meta.url),'utf8');
test('news and event globe source boundaries',async()=>{
const html=await get('mnet.html'),globe=await get('js/action-globe.js'),src=await get('js/world-news-globe.js'),archive=await get('js/docket-cohort-showcase.js');
assert.match(html,/data-world-mode="posts" aria-pressed="false">News/);
assert.match(src,/credentials:'omit'/);assert.match(src,/limit=50/);
assert.match(src,/world-news-pins/);assert.match(src,/Show on globe/);
assert.match(src,/mentioned|mentions|article mentions/);
assert.match(globe,/worldNewsId/);assert.match(globe,/hu:world-news-selected/);
assert.match(archive,/dc-event-feed/);assert.match(archive,/e\.work_ids/);
assert.doesNotMatch(src,/innerHTML/);
});
