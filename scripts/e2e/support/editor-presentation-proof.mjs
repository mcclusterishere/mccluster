export async function editorPresentationProof({page,goto,check,out,width}){
 await goto(page,'#sell:payments:payments');await page.locator('.cr-editor-summary').waitFor();
 check('payments summarize only loaded records',/All · 2/.test(await page.locator('.cr-editor-summary').innerText()));
 await page.getByRole('button',{name:'Due, pending or failed · 1',exact:true}).click();
 check('payment attention drills into original row',await page.locator('.cr-editor-ledger tbody tr:visible').count()===1&&/Site retainer/.test(await page.locator('.cr-editor-ledger tbody tr:visible').innerText()));
 await page.getByRole('button',{name:'All · 2',exact:true}).click();check('all payment evidence recoverable',await page.locator('.cr-editor-ledger tbody tr:visible').count()===2&&/owner recorded/.test(await page.locator('.cr-editor-ledger').innerText()));
 await page.screenshot({path:out+'/payments-'+width+'.png'});
 await page.getByRole('button',{name:'+ New payment',exact:true}).click();await page.locator('#wkTitle').waitFor();
 await page.getByRole('button',{name:'Create payment',exact:true}).click();check('existing payment validation remains visible',/A title is required/.test(await page.locator('#crSurface').innerText()));
 await page.getByRole('button',{name:'Cancel',exact:true}).click();check('existing cancel closes payment form',await page.locator('#wkTitle').count()===0);
 await goto(page,'#sell:payments:renewals');await page.locator('.cr-editor-summary').waitFor();await page.getByRole('button',{name:'Upcoming or lapsed · 2',exact:true}).click();
 check('renewal detail retains cadence amount and state',await page.locator('.cr-editor-ledger tbody tr:visible').count()===2&&/Cadence|monthly|annual/i.test(await page.locator('.cr-editor-ledger').innerText()));
 await page.goBack();await page.waitForTimeout(500);check('Back restores payment destination',await page.locator('#crSurface').getAttribute('data-cr-route')==='#sell:payments:payments');await page.goForward();await page.waitForTimeout(500);check('Forward restores renewal destination',await page.locator('#crSurface').getAttribute('data-cr-route')==='#sell:payments:renewals');
 await goto(page,'#create:publish:channels');
 const form=page.locator('.cr-panel').filter({has:page.getByRole('heading',{name:'Register an account',exact:true})});
 const summary=form.locator('summary');await summary.waitFor();check('registration starts collapsed',!await form.locator('details').getAttribute('open'));
 await summary.focus();await page.keyboard.press('Enter');await page.locator('#crAccExternal').fill('fixture-draft');await form.getByRole('button',{name:'Close details'}).click();await summary.focus();await page.keyboard.press('Enter');
 check('keyboard close/reopen preserves actual form fields',await page.locator('#crAccExternal').inputValue()==='fixture-draft');
 const controlsBefore=await page.locator('#crSurface input,#crSurface select,#crSurface textarea').count();await page.evaluate(()=>CR.editorPresentation.enhance(document.getElementById('crSurface'),{scope:'o1',route:'#create:publish:channels'}));
 check('repeated enhancement neither duplicates nor removes fields',await page.locator('#crSurface input,#crSurface select,#crSurface textarea').count()===controlsBefore&&await form.locator('details').count()===1);
 await page.screenshot({path:out+'/channels-'+width+'.png'});
 let writes=0,release;
 await page.route('https://api.mccluster.org/v1/social/accounts',async r=>{if(r.request().method()==='POST'){writes++;await new Promise(resolve=>release=resolve);return r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Fixture registration refused'})});}return r.fulfill({contentType:'application/json',body:JSON.stringify({accounts:[]})});});
 await form.getByRole('button',{name:'Register account',exact:true}).click();await page.waitForTimeout(100);check('pending original action stays expanded',await page.locator('#crAccExternal').isVisible());
 if(release){release();await page.waitForTimeout(600);check('server validation error stays reachable',/Fixture registration refused/.test(await page.locator('#crSurface').innerText())&&await page.locator('#crAccExternal').isVisible());check('one deliberate click sends one original mutation',writes===1);}else throw Error('Registration fixture did not receive original action');
 let resourceRelease;await page.route('https://api.mccluster.org/v1/compute/balance',async r=>{await new Promise(resolve=>resourceRelease=resolve);await r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture balance unavailable'})});});
 await goto(page,'#system:resources');check('resources retain explicit read action',await page.getByRole('button',{name:'Read platform state',exact:true}).isVisible());
 await page.getByRole('button',{name:'Read platform state',exact:true}).click();await page.waitForTimeout(100);await goto(page,'#create:publish:channels');if(!resourceRelease)throw Error('Resource fixture was not requested');resourceRelease();await page.waitForTimeout(400);check('late resource response keeps current route and editor',await page.locator('#crSurface').getAttribute('data-cr-route')==='#create:publish:channels'&&!(await page.locator('#crSurface').innerText()).includes('Fixture balance unavailable'));await goto(page,'#system:resources');check('resource failure expands its original evidence',await page.locator('.cr-source').filter({hasText:'Fixture balance unavailable'}).isVisible());
 check('resources expose four evidence sections',await page.locator('.cr-editor-fold').count()===4);
 for(const details of await page.locator('.cr-editor-fold').all()){await details.locator('summary').click();if(!await details.evaluate(x=>x.open))await details.locator('summary').click();check('resource evidence retains content',await details.locator(':scope > :not(summary)').count()>0);}
 await page.screenshot({path:out+'/resources-'+width+'.png'});
 check('presentation has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
 // A stale, detached render cannot replace current content: enhancement has no async fetch/cache.
 await goto(page,'#create:publish:channels');await page.evaluate(()=>{const detached=document.createElement('div');detached.innerHTML='<section class="cr-panel"><header><h2>Connections</h2></header><p>STALE FIXTURE</p></section>';CR.editorPresentation.enhance(detached,{scope:'old-org',route:'#system:resources'});});check('late detached content never enters current editor',!(await page.locator('#crSurface').innerText()).includes('STALE FIXTURE'));
 await page.route('https://api.mccluster.org/v1/workspaces/me',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({default_org_id:'o1',workspaces:[{org_id:'o1',slug:'mccluster',kind:'studio',role:'viewer',enabled:true,name:'Fixture workspace'}]})}));await page.reload();await page.waitForTimeout(1000);check('viewer role gains no owner registration or campaign form',await page.locator('#crAccExternal,#crCmpName').count()===0&&/Read only/.test(await page.locator('#crSurface').innerText()));
}
