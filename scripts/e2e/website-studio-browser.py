"""Offline Chromium DOM/media checks, real handlers via local fixture bridge.
No browser network access, cloud mutation, real account or physical-device claim.
Modules are flattened for this restricted environment; Node tests import them normally.
"""
import json,pathlib,urllib.request,urllib.error,re,base64
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[2];results=[]
def check(name,condition):
    assert condition,name
    results.append(name)
def module(path):
    text=(root/path).read_text()
    text=re.sub(r'^import .*?;\n','',text,flags=re.M)
    return re.sub(r'\bexport (?=(?:async )?function|const|class)','',text)
def bridge(payload):
    req=urllib.request.Request('http://127.0.0.1:8789'+payload['path'],data=payload.get('body','').encode() if payload.get('body') else None,headers={**payload.get('headers',{}),'origin':'https://matthew.mccluster.org'},method=payload.get('method','GET'))
    try:
        with urllib.request.urlopen(req) as r:return {'status':r.status,'data':json.loads(r.read())}
    except urllib.error.HTTPError as e:return {'status':e.code,'data':json.loads(e.read())}
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    page=browser.new_page(viewport={'width':390,'height':844});page.set_default_timeout(7000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.expose_function('fixtureApi',bridge)
    html=(root/'website-studio.html').read_text();html=re.sub(r'<script\b[^>]*>.*?</script>','',html,flags=re.S);html=re.sub(r'<link\b[^>]*>','',html)
    page.set_content(html);page.add_style_tag(content=(root/'css/website-studio.css').read_text())
    blobs={n:base64.b64encode((root/'verification/media'/n).read_bytes()).decode() for n in ['audio.m4a','video.mp4','desktop.mp4','phone.mp4','poster.jpg','panorama.jpg']}
    page.evaluate("""files=>{window.fixtureMedia={};for(const [name,data]of Object.entries(files)){const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));window.fixtureMedia[name]=URL.createObjectURL(new Blob([bytes],{type:name.endsWith('.jpg')?'image/jpeg':name.endsWith('.m4a')?'audio/mp4':'video/mp4'}));}
    if(!crypto.randomUUID)crypto.randomUUID=()=> 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';window.MCC={session:()=>window.__signed?{access_token:'owner-A'}:null,user:async()=>window.__signed?{id:'test'}:null,refreshIfNeeded:async()=>{},signInWithPassword:async()=>{window.__signed=true},signUpWithPassword:async()=>{window.__signed=true;return {session:true}}};
    window.fixtureRemap=value=>{if(Array.isArray(value))return value.map(window.fixtureRemap);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,window.fixtureRemap(v)]));if(typeof value==='string'&&value.startsWith('https://zmnhbrjyhxzhkxmhkexs.supabase.co/storage/'))return window.fixtureMedia[value.split('?')[0].split('/').pop()]||value;return value;};
    window.fetch=async(url,options={})=>{if(!String(url).startsWith('https://api.mccluster.org/v1/'))throw Error('External networking forbidden in offline test');const r=await window.fixtureApi({path:String(url).replace('https://api.mccluster.org',''),method:options.method||'GET',body:options.body||'',headers:options.headers||{}});return new Response(JSON.stringify(window.fixtureRemap(r.data)),{status:r.status,headers:{'content-type':'application/json'}});};
    // about:blank has no sessionStorage; test only the editor's non-secret intent slot.
    Object.defineProperty(window,'sessionStorage',{value:{setItem(){},removeItem(){},getItem(){return null}}});
    }""",blobs)
    page.evaluate('()=>{'+module('js/website-studio/contract.mjs')+';window.fixtureContract={assertDocument,renderPlan};}')
    page.evaluate('()=>{'+module('js/website-studio/panorama.mjs')+';window.fixturePanorama=panorama;}')
    page.evaluate('()=>{const renderPlan=window.fixtureContract.renderPlan;const panorama=window.fixturePanorama;'+module('js/website-studio/renderer.mjs')+';window.testRender=renderWebsite;}')
    page.evaluate('()=>{const assertDocument=window.fixtureContract.assertDocument;const renderWebsite=window.testRender;'+module('js/website-studio/editor.mjs')+'}')
    page.click('#useTemplate');page.wait_for_selector('#auth',state='visible');check('account required to claim template',True)
    page.fill('#email','test@example.test');page.fill('#password','test-pass-123');page.locator('#authForm button').click();page.wait_for_timeout(500);print('AUTH_STATUS',page.locator('#status').text_content());page.wait_for_selector('#editor',state='visible')
    check('three editor tiles',page.locator('#tiles .ws-card').count()==3);page.fill('#title','Test studio — saved work')
    for i,uid in enumerate(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc']):page.locator('#tiles .ws-card').nth(i).get_by_label('Your uploaded media').select_option(uid)
    page.select_option('#mode','cinematic');page.locator('#tiles .ws-card').nth(0).get_by_label('Scroll transition').select_option('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');page.click('#save');page.wait_for_timeout(500);print('SAVE_STATUS',page.locator('#status').text_content());page.wait_for_function("document.querySelector('#status').textContent.includes('revision 1')")
    check('authenticated handler saves draft',True);check('390px editor has no overflow',page.evaluate('document.documentElement.scrollWidth===document.documentElement.clientWidth'))
    page.screenshot(path=str(root/'verification/editor-390.png'),full_page=True)
    page.click('#preview');page.wait_for_selector('.ws-content',state='visible');check('three real preview content sections',page.locator('.ws-content').count()==3);check('native audio and video players',page.locator('.ws-content audio').count()==1 and page.locator('.ws-content video').count()==1);check('transition is distinct from content',page.locator('.ws-transition').count()==1)
    sec=page.locator('.ws-transition');top=sec.evaluate('(e)=>e.getBoundingClientRect().top+scrollY');height=sec.evaluate('(e)=>e.offsetHeight')
    page.evaluate('(x)=>scrollTo(0,x)',top+(height-844)*.8);page.wait_for_timeout(800);forward=page.locator('.ws-transition video').evaluate('(v)=>v.currentTime')
    page.evaluate('(x)=>scrollTo(0,x)',top+(height-844)*.2);page.wait_for_timeout(800);back=page.locator('.ws-transition video').evaluate('(v)=>v.currentTime');check('actual converted video scrubs both directions',forward>back+.2)
    page.get_by_role('button',name='Enter 360 experience').click();page.wait_for_selector('.ws-immersive')
    if page.locator('.ws-immersive canvas').count():
        check('explicit panorama entry',True);page.locator('.ws-immersive canvas').press('ArrowRight')
    else:
        print('360 fallback:',page.locator('.ws-immersive').text_content())
        check('360 unavailable-device fallback is visible', '360 viewing is unavailable' in page.locator('.ws-immersive').text_content())
    page.get_by_role('button',name='Exit 360').click();check('360 exit restores page',page.locator('.ws-immersive').count()==0)
    page.click('#back');page.click('#publish');page.wait_for_selector('#published a');check('handler confirms published revision',True);check('password cleared',page.input_value('#password')=='')
    public=bridge({'path':'/v1/creator-sites/studio/public/site-11111111111141118111111111111111'});check('anonymous published read returns same saved title',public['data']['document']['title']=='Test studio — saved work')
    page.evaluate("p=>{document.body.innerHTML='<main id=publicHost></main>';window.testRender(document.getElementById('publicHost'),window.fixtureRemap(p),{reducedMotion:true});}",public['data']);check('reduced motion omits transitions, retains three tiles',page.locator('.ws-transition').count()==0 and page.locator('.ws-content').count()==3);check('public renderer has no horizontal overflow',page.evaluate('document.documentElement.scrollWidth===document.documentElement.clientWidth'));check('no uncaught JavaScript errors',not errors)
    browser.close()
(root/'verification/browser-tests.json').write_text(json.dumps({'checks':len(results),'passed':results,'cloud':'mocked','browser':'offline Chromium 390px','physical_device_tested':False,'module_resolution_tested_in':'Node'},indent=2))
print(json.dumps({'passed':len(results),'checks':results},indent=2))
