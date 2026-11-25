/* Existing app and analytics fixtures. No production traffic or writes. */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {context,browser,server,BASE,OUT} from './analytics-unified.e2e.mjs';
const checks=[];
function check(name,pass){checks.push({name,pass:!!pass});console.log((pass?'PASS ':'FAIL ')+name);assert.ok(pass,name);}
try{
  for(const width of [390,820,1280]){
    const {ctx,page,errors}=await context({width,height:900},{deviceScaleFactor:1});
    await page.goto(BASE+'/control.html#analytics');
    await page.waitForFunction(()=>CR.analytics.state.loaded&&!CR.analytics.state.loading);
    await page.locator('.cu-summary').waitFor();
    check(width+' three groups',await page.locator('.cu-summary-group').count()===3);
    check(width+' 7 preserved/detail metrics',await page.locator('.cu-summary .cu-metric-link').count()===7);
    check(width+' summary values use readable dark cards',await page.locator('.cu-summary .cu-metric-link').evaluateAll(nodes=>nodes.every(n=>getComputedStyle(n).backgroundColor==='rgb(24, 24, 30)'&&getComputedStyle(n).color==='rgb(243, 241, 245)')));
    check(width+' no page overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
    await page.locator('.cu-summary-groups').focus();
    check(width+' carousel keyboard focus',await page.locator('.cu-summary-groups').evaluate(el=>el===document.activeElement));
    for(const target of ['Audience','Content','Business']){
      await page.getByRole('button',{name:'Explore '+target,exact:true}).click();
      check(width+' '+target+' drilldown',await page.getByRole('tabpanel',{name:target==='Business'?'Action & business':target,exact:true}).isVisible());
      await page.getByRole('tab',{name:'Overview',exact:true}).click();
    }
    await page.locator('.cad-body').evaluate(el=>el.scrollTop=0);
    await page.locator('.cu-summary-groups').evaluate(el=>el.scrollLeft=0);
    await page.screenshot({path:OUT+'/insights-'+width+'.png'});
    const original=await page.evaluate(()=>CR.analytics.state.data.traffic.totals.visitors);
    await page.evaluate(()=>CR.analytics.state.errors.totals={message:'Synthetic unavailable read'});
    await page.getByRole('tab',{name:'Audience',exact:true}).click();await page.getByRole('tab',{name:'Overview',exact:true}).click();
    check(width+' failed read hides old metric',await page.locator('.cu-summary').getByRole('button',{name:'Unique visitors: —. Open details',exact:true}).count()===1);
    check(width+' failure keeps evidence in state',await page.evaluate(()=>CR.analytics.state.data.traffic.totals.visitors)===original);
    await page.evaluate(()=>delete CR.analytics.state.errors.totals);
    await page.getByRole('tab',{name:'Audience',exact:true}).click();await page.getByRole('tab',{name:'Overview',exact:true}).click();
    check(width+' recovered read restores metric',await page.locator('.cu-summary').getByRole('button',{name:'Unique visitors: '+Number(original).toLocaleString()+'. Open details',exact:true}).count()===1);
    check(width+' no script errors',errors.length===0);
    await ctx.close();
  }
}finally{await writeFile(OUT+'/summary-results.json',JSON.stringify(checks,null,2));await browser.close();await new Promise(r=>server.close(r));}
