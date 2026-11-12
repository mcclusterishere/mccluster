import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
test('Finance is an owner-only World mode in the existing navigation and same iframe',()=>{
 const html=read('mnet.html'),travel=read('js/travel/world-travel.mjs'),css=read('css/world-finance.css'),controller=read('js/world-finance.mjs');
 assert.equal((html.match(/id="mnWorldFrame"/g)||[]).length,1);assert.match(html,/data-world-mode="finance" aria-pressed="false">Finance/);
 assert.match(travel,/\? \['posts', 'environment'\] : \['travel', 'missions', 'posts', 'environment', 'finance'\]/);
 assert.match(css,/\.hu-social-only.*\[data-world-mode="finance"\].*display:none/);assert.match(controller,/!globe\?\.owner\?\.\(\)/);assert.doesNotMatch(controller,/new .*Viewer|iframe.*src\s*=|localStorage\.setItem/);
 assert.match(controller,/e\.source!==frame\.contentWindow\|\|e\.origin!==location\.origin/);
});
test('Finance suppresses unrelated news and mission pins without deleting their data or creating a second viewer',()=>{
 const globe=read('js/action-globe.js'),news=read('js/world-news-globe.js');
 assert.match(globe,/if\(showMissions&&!financeMode\)/);assert.match(globe,/if\(showCities&&!financeMode\)/);assert.match(globe,/!travelMode&&!financeMode&&completedOn/);assert.match(globe,/setFinanceMode\(d\.on\)/);assert.match(news,/mode\(\) !== 'finance'/);
 assert.doesNotMatch(read('js/halo/finance-roster.js'),/new .*Viewer/);
});
test('public reference and browser lifecycle checks are wired into the existing Finance workflow',()=>{
 const workflow=read('.github/workflows/finance-globe.yml');for(const path of ['js/world-finance.mjs','data/markets/company-leadership.json','scripts/e2e/finance-leadership.mjs','scripts/test-finance-leadership-dom.mjs'])assert.ok(workflow.includes(path),path);
});
