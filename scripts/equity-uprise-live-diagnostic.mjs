import fs from "node:fs/promises";
import { chromium } from "playwright";

const URL = "https://matthew.mccluster.org/equity-uprise-building-core-v2-3d.html";
await fs.mkdir("diagnostic-artifacts",{recursive:true});
const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const events=[];
const core=[];
page.on("pageerror",e=>events.push("PAGEERROR "+e.message));
page.on("console",m=>{ if(m.type()==="error") events.push("CONSOLE "+m.text()); });
page.on("requestfailed",r=>events.push("REQUESTFAILED "+r.url()+" "+(r.failure()?.errorText||"")));
page.on("response",r=>{
  const u=r.url();
  if(/equity-uprise-preview|equity-uprise-building-core-v2-3d|cdn\.jsdelivr\.net\/npm\/three/.test(u))
    core.push({status:r.status(),url:u});
});
let loaded=false;
let navStatus=null;
try{
  const res=await page.goto(URL,{waitUntil:"domcontentloaded",timeout:60000});
  navStatus=res?.status()??null;
  try{
    await page.waitForFunction(()=>/Working stack loaded/.test(document.querySelector("#status")?.textContent||""),null,{timeout:45000});
    loaded=true;
  }catch{}
  const probe=await page.evaluate(async()=>{
    const moduleUrl="/equity-uprise-preview/lab-runtime/equity-uprise-viewer-lab-integration.mjs";
    let moduleFetch={ok:false,status:null,error:null};
    try{const r=await fetch(moduleUrl,{cache:"no-cache"});moduleFetch={ok:r.ok,status:r.status,error:null};}catch(e){moduleFetch.error=e.message;}
    return {
      status:document.querySelector("#status")?.textContent||null,
      canvas:document.querySelectorAll("canvas").length,
      labs:!!document.querySelector("#labs"),
      serviceStatus:document.querySelector("#serviceStatus")?.textContent||null,
      solarStatus:document.querySelector("#solarStatus")?.textContent||null,
      moduleFetch
    };
  });
  await page.screenshot({path:"diagnostic-artifacts/live.png",fullPage:true});
  const out={navStatus,loaded,probe,events,core};
  console.log(JSON.stringify(out,null,2));
  await fs.writeFile("diagnostic-artifacts/diagnostic.json",JSON.stringify(out,null,2));
  if(!loaded || navStatus!==200 || probe.canvas!==1 || events.some(x=>/PAGEERROR|REQUESTFAILED/.test(x))) process.exitCode=1;
}catch(e){
  events.push("FATAL "+(e.stack||e.message));
  console.log(JSON.stringify({navStatus,loaded,events,core},null,2));
  await fs.writeFile("diagnostic-artifacts/diagnostic.json",JSON.stringify({navStatus,loaded,events,core},null,2));
  try{await page.screenshot({path:"diagnostic-artifacts/live-FAIL.png",fullPage:true});}catch{}
  process.exitCode=1;
}
await browser.close();
