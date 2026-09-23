import { chromium } from "playwright";
import { spawn } from "node:child_process";
import http from "node:http";

const PORT=8942,B=`http://127.0.0.1:${PORT}/`;
const waitServer=()=>new Promise((resolve,reject)=>{
  let n=60;const ping=()=>http.get(B,()=>resolve()).on("error",()=>--n<0?reject(new Error("server did not start")):setTimeout(ping,250));ping();
});
const server=spawn("python3",["-m","http.server",String(PORT)],{stdio:"ignore"});
const results=[];
const check=(name,ok,detail="")=>{results.push({name,ok,detail});console.log(`${ok?"✓":"✗"} ${name}${detail?" · "+detail:""}`);};
try{
  await waitServer();
  const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(B+"equity-uprise-building-core-v2-3d.html",{waitUntil:"domcontentloaded",timeout:60000});
  await page.waitForFunction(()=>/Working stack loaded/.test(document.querySelector("#status")?.textContent||""),null,{timeout:120000});
  check("viewer reaches ready state",true);

  async function timedClick(selector,label,maxMs=10000){
    const out=await page.evaluate(({selector})=>{
      const el=document.querySelector(selector);if(!el)return{missing:true,ms:null};
      const t=performance.now();el.click();return{missing:false,ms:performance.now()-t};
    },{selector});
    check(label,!out.missing&&out.ms<maxMs,`handler=${out.ms?.toFixed(1)}ms max=${maxMs}ms`);
    return out;
  }

  await timedClick('[data-f="1"]',"Floor 1 isolation interaction");
  check("Floor 1 active",await page.locator('[data-f="1"]').evaluate(el=>el.classList.contains("active")));
  await timedClick('[data-f="facade"]',"Facade isolation interaction");
  check("Facade active",await page.locator('[data-f="facade"]').evaluate(el=>el.classList.contains("active")));
  await timedClick('[data-f="stack"]',"Stack restore interaction");
  check("Stack active",await page.locator('[data-f="stack"]').evaluate(el=>el.classList.contains("active")));

  await timedClick("#services","Services expose interaction",10000);
  check("Services exposed",/Exposed/.test(await page.locator("#services").innerText()));
  await timedClick("#services","Services hide interaction",10000);
  check("Services hidden",/Off/.test(await page.locator("#services").innerText()));

  await timedClick("#wire","Wireframe enable interaction",5000);
  check("Wireframe enabled",/Solid/.test(await page.locator("#wire").innerText()));
  await timedClick("#wire","Wireframe disable interaction",5000);
  check("Solid restored",/Wireframe/.test(await page.locator("#wire").innerText()));

  await timedClick("#sunmode","Solar mode interaction",2000);
  check("Solar advances to Day",/Day/.test(await page.locator("#sunmode").innerText()));
  await timedClick("#labs","Lab panel open interaction",2000);
  await page.locator("#labPanel").waitFor({state:"visible",timeout:15000});
  check("Lab panel opens",await page.locator("#labPanel").isVisible());

  check("no page errors",errors.length===0,errors.join(" | "));
  await browser.close();

  const failed=results.filter(x=>!x.ok);
  console.log(JSON.stringify({passed:results.length-failed.length,failed:failed.length,results},null,2));
  if(failed.length)process.exitCode=1;
}finally{
  server.kill("SIGTERM");
}
