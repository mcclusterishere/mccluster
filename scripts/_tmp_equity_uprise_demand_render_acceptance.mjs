import { chromium } from "playwright";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs/promises";

const PORT=8943,BASE=`http://127.0.0.1:${PORT}/`;
const results=[];
const check=(name,ok,detail="")=>{results.push({name,ok:!!ok,detail:String(detail||"")});console.log(`${ok?"✓":"✗"} ${name}${detail?" · "+detail:""}`)};
const waitServer=()=>new Promise((resolve,reject)=>{let n=80;const ping=()=>http.get(BASE,()=>resolve()).on("error",()=>--n<0?reject(new Error("server did not start")):setTimeout(ping,250));ping()});
const server=spawn("python3",["-m","http.server",String(PORT)],{stdio:"ignore"});
try{
 await waitServer();await fs.mkdir("acceptance-artifacts",{recursive:true});
 const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(BASE+"equity-uprise-building-core-v2-3d.html",{waitUntil:"domcontentloaded",timeout:60000});
 await page.waitForFunction(()=>/Working stack loaded/.test(document.querySelector("#status")?.textContent||""),null,{timeout:120000});
 check("viewer ready",true);

 async function pointer(selector,label,max=15000){
   const t=Date.now();await page.locator(selector).click({timeout:max});const ms=Date.now()-t;
   check(label,ms<max,`wall=${ms}ms max=${max}ms`);
 }
 await pointer('[data-f="1"]',"Floor 1 pointer click");
 check("Floor 1 active",await page.locator('[data-f="1"]').evaluate(el=>el.classList.contains("active")));
 await pointer('[data-f="facade"]',"Facade pointer click");
 check("Facade active",await page.locator('[data-f="facade"]').evaluate(el=>el.classList.contains("active")));
 await pointer('[data-f="stack"]',"Stack pointer click");
 check("Stack active",await page.locator('[data-f="stack"]').evaluate(el=>el.classList.contains("active")));
 await pointer("#services","Services expose pointer click");
 check("Services exposed",/Exposed/.test(await page.locator("#services").innerText()));
 await pointer("#services","Services hide pointer click");
 check("Services hidden",/Off/.test(await page.locator("#services").innerText()));
 await pointer("#wire","Wireframe pointer click",10000);
 check("Wireframe enabled",/Solid/.test(await page.locator("#wire").innerText()));
 await pointer("#wire","Solid pointer click",10000);
 check("Solid restored",/Wireframe/.test(await page.locator("#wire").innerText()));
 await pointer("#sunmode","Solar pointer click",10000);
 check("Solar Day",/Day/.test(await page.locator("#sunmode").innerText()));
 await pointer("#labs","Labs pointer click",10000);
 await page.locator("#labPanel").waitFor({state:"visible",timeout:10000});
 check("Lab panel opens",await page.locator("#labPanel").isVisible());

 const st=Date.now();await page.screenshot({path:"acceptance-artifacts/demand-render.png",fullPage:true,timeout:20000});const sms=Date.now()-st;
 check("Screenshot completes",sms<20000,`wall=${sms}ms`);
 check("No page errors",errors.length===0,errors.join(" | "));
 await browser.close();
 const failed=results.filter(x=>!x.ok);
 console.log(JSON.stringify({passed:results.length-failed.length,failed:failed.length,results},null,2));
 if(failed.length)process.exitCode=1;
}finally{server.kill("SIGTERM")}
