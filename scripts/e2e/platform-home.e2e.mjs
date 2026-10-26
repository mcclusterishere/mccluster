import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const { chromium } = createRequire(join(process.env.PLAYWRIGHT_DIR || '/tmp/selfservice-tools/node_modules','x'))('playwright');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium', args:['--no-sandbox'] });
const out = process.argv[2] || '/tmp/platform-home-proof'; await mkdir(out,{recursive:true});
try {
  const page = await browser.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url());
    // Shared shell is exercised in its own suites. This fixture is only the offer page.
    if(u.origin!=='https://fixture.invalid'||u.pathname==='/js/tabbar.js')return route.fulfill({body:'',contentType:'text/javascript'});
    const path=resolve(root,'.'+u.pathname); if(!path.startsWith(root))return route.abort();
    try {await route.fulfill({body:await readFile(path),contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[extname(path)]||'application/octet-stream'});}catch{await route.fulfill({status:404,body:''});}
  });
  for(const width of [390,1440]){
    await page.setViewportSize({width,height:900}); await page.goto('https://fixture.invalid/platform-home.html');
    assert.deepEqual(await page.locator('.offer-index a').allTextContents(),['01 Builders','02 Contributors','03 Backers']);
    assert.equal(await page.getByRole('link',{name:'Build my brand',exact:true}).getAttribute('href'),'#builders');
    assert.equal(await page.getByRole('link',{name:'Find opportunities',exact:true}).getAttribute('href'),'#contributors');
    assert.equal(await page.getByRole('link',{name:'Back a project',exact:true}).getAttribute('href'),'#backers');
    assert.match(await page.locator('#backing-note').innerText(),/planned/);
    assert.match(await page.locator('.shared-account').innerText(),/same account across roles/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth),true);
    const mark=page.locator('.brand img'); assert.equal(await mark.evaluate(img=>img.complete&&img.naturalWidth>0),true);
    await page.getByRole('button',{name:'Business'}).click();
    assert.equal(await page.locator('#siteCompanion').getAttribute('href'),'customer-commerce.html');
    assert.match(await page.locator('#sitePath').innerText(),/business and customers/);
    assert.equal(await page.getByRole('button',{name:'Business'}).getAttribute('aria-pressed'),'true');
    assert.equal(new URL(page.url()).searchParams.get('site'),'business');
    await page.getByRole('button',{name:'Project',exact:true}).click();
    assert.equal(await page.locator('#siteCompanion').getAttribute('href'),'customer-projects.html');
    await page.getByRole('button',{name:'Artist / creator'}).click();
    assert.equal(await page.locator('#siteCompanion').getAttribute('href'),'creator.html');
    assert.equal(await page.getByRole('link',{name:'Explore clipping campaigns'}).getAttribute('href'),'mnet.html?view=clips');
    assert.match(await page.locator('#backers').innerText(),/No funds are collected/);
    assert.match(await page.locator('#apps').innerText(),/module installation marketplace.*planned/);
    assert.equal(await page.getByRole('button',{name:/buy|install|fund|pay/i}).count(),0);
    await page.screenshot({path:join(out,`home-${width}.png`),fullPage:true});
  }
  await page.goto('https://fixture.invalid/platform-home.html?site=business'); assert.match(await page.locator('#sitePath').innerText(),/business and customers/);
  await page.goto('https://fixture.invalid/platform-home.html?site=%3Cscript%3E'); assert.match(await page.locator('#sitePath').innerText(),/portfolio and releases/);
  assert.deepEqual(errors,[]);
  console.log('PASS: three audiences, artist/business/project guidance/deep links, real destinations, no transactional placeholders, supplied asset, 390/1440 overflow, no JS errors');
} finally {await browser.close();}
