import fs from "node:fs/promises";
import { chromium } from "playwright";

const LIVE="https://matthew.mccluster.org/equity-uprise-building-core-v2-3d.html";
const results=[];
const add=(name,ok,detail="")=>{results.push({name,ok:!!ok,detail:String(detail||"")});console.log(`${ok?"✓":"✗"} ${name}${detail?" · "+detail:""}`);};
const must=(name,cond,detail="")=>add(name,!!cond,detail);

const browser=await chromium.launch({headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});

async function open(url,viewport={width:1440,height:1000}){
  const ctx=await browser.newContext({viewport});
  const page=await ctx.newPage();
  const errors=[], failed=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("requestfailed",r=>{
    const u=r.url();
    if(/matthew\.mccluster\.org\/equity-uprise-preview|cdn\.jsdelivr\.net\/npm\/three/i.test(u))
      failed.push(u+" :: "+(r.failure()?.errorText||"failed"));
  });
  const res=await page.goto(url,{waitUntil:"domcontentloaded",timeout:60000});
  must("document 200: "+new URL(url).search,!!res&&res.status()===200,res?.status());
  await page.locator("canvas").waitFor({state:"visible",timeout:30000});
  await page.waitForFunction(()=>/Working stack loaded/.test(document.querySelector("#status")?.textContent||""),null,{timeout:60000});
  must("stack loaded: "+new URL(url).search,/Working stack loaded/.test(await page.locator("#status").innerText()));
  return {ctx,page,errors,failed};
}
async function closeCase(label,caseObj){
  must(label+": no page errors",caseObj.errors.length===0,caseObj.errors.join(" | "));
  must(label+": no core request failures",caseObj.failed.length===0,caseObj.failed.join(" | "));
  await caseObj.ctx.close();
}

{
  const c=await open(LIVE);
  const p=c.page;
  must("normal default lab panel closed",await p.locator("#labPanel").isHidden());
  must("normal stack active",/active/.test(await p.locator('[data-f="stack"]').getAttribute("class")||""));
  must("normal solar resolved",!/syncing/.test(await p.locator("#solarStatus").innerText()));

  await p.locator('[data-f="1"]').click();
  must("floor 1 isolation active",/active/.test(await p.locator('[data-f="1"]').getAttribute("class")||""));
  await p.locator('[data-f="facade"]').click();
  must("facade isolation active",/active/.test(await p.locator('[data-f="facade"]').getAttribute("class")||""));
  await p.locator('[data-f="stack"]').click();
  must("stack restored",/active/.test(await p.locator('[data-f="stack"]').getAttribute("class")||""));

  await p.locator("#services").click();
  must("services exposes",/Exposed/.test(await p.locator("#services").innerText()));
  must("services status exposed",/EXPOSED/.test(await p.locator("#serviceStatus").innerText()));
  await p.locator("#services").click();
  must("services hides",/Off/.test(await p.locator("#services").innerText()));

  await p.locator("#wire").click();
  must("wireframe toggles",/Solid/.test(await p.locator("#wire").innerText()));
  await p.locator("#wire").click();
  must("solid restores",/Wireframe/.test(await p.locator("#wire").innerText()));

  await p.locator("#sunmode").click();
  must("sun Day",/Day/.test(await p.locator("#sunmode").innerText()));
  await p.locator("#sunmode").click();
  must("sun Night",/Night/.test(await p.locator("#sunmode").innerText()));
  await p.locator("#sunmode").click();
  must("sun Auto restored",/Auto/.test(await p.locator("#sunmode").innerText()));

  await p.locator("#labs").click();
  await p.locator("#labPanel").waitFor({state:"visible",timeout:15000});
  must("lab panel opens",await p.locator("#labPanel").isVisible());
  must("lab catalog complete enough",await p.locator("#labSelect option").count()===14,await p.locator("#labSelect option").count());
  must("difficulty policy has 3 levels",await p.locator("#labDifficulty option").count()===3,await p.locator("#labDifficulty option").count());
  await closeCase("normal controls",c);
}

{
  const c=await open(LIVE+"?lab=IT-LAB-039&difficulty=FOUNDATION");
  const p=c.page;
  await p.waitForFunction(()=>/RUNNING · SANDBOX/.test(document.querySelector("#labScenario")?.textContent||""),null,{timeout:60000});
  const scenario=await p.locator("#labScenario").innerText();
  let guidance=await p.locator("#labGuidance").innerText();
  must("Foundation correct IT039 scenario",/Cross-System Building Incident Response/.test(scenario),scenario);
  must("Foundation SANDBOX visible",/SANDBOX/.test(scenario),scenario);
  must("Foundation objectives visible",!/Objectives Hidden by difficulty/.test(guidance),guidance);
  must("Foundation faults visible",!/Fault view Hidden by difficulty/.test(guidance),guidance);
  must("Foundation 8 actions",await p.locator("#labActions button").count()===8,await p.locator("#labActions button").count());
  const before=guidance.match(/Hints\s+(\d+)\/(\d+)/);
  must("Foundation hint available",!(await p.locator("#labHint").isDisabled()),guidance);
  await p.locator("#labHint").click();
  await p.waitForFunction(()=>/Supported hint usage recorded/.test(document.querySelector("#labMessage")?.textContent||""),null,{timeout:10000});
  guidance=await p.locator("#labGuidance").innerText();
  const after=guidance.match(/Hints\s+(\d+)\/(\d+)/);
  must("Foundation hint decrements",!!before&&!!after&&Number(after[1])===Number(before[1])-1,`${before?.[0]} -> ${after?.[0]}`);
  await p.locator("#labReset").click();
  await p.waitForFunction(()=>/CREATED · SANDBOX/.test(document.querySelector("#labScenario")?.textContent||""),null,{timeout:10000});
  must("Foundation reset -> CREATED",/CREATED · SANDBOX/.test(await p.locator("#labScenario").innerText()));
  must("Foundation reset baseline message",/canonical simulated baseline restored/.test(await p.locator("#labMessage").innerText()));
  await p.locator("#labStart").click();
  await p.waitForFunction(()=>/RUNNING · SANDBOX/.test(document.querySelector("#labScenario")?.textContent||""),null,{timeout:10000});
  must("Foundation restart works",/RUNNING/.test(await p.locator("#labScenario").innerText()));
  await closeCase("IT039 Foundation",c);
}

{
  const c=await open(LIVE+"?lab=IT-LAB-039&difficulty=EXPERT");
  const p=c.page;
  await p.waitForFunction(()=>/RUNNING · SANDBOX/.test(document.querySelector("#labScenario")?.textContent||""),null,{timeout:60000});
  const g=await p.locator("#labGuidance").innerText();
  const a=await p.locator("#labAssessment").innerText();
  const labels=await p.locator("#labActions button").allInnerTexts();
  must("Expert objectives hidden",/Objectives Hidden by difficulty/.test(g),g);
  must("Expert faults hidden",/Fault view Hidden by difficulty/.test(g),g);
  must("Expert hints 0/0",/Hints 0\/0 remaining/.test(g),g);
  must("Expert hint disabled",await p.locator("#labHint").isDisabled());
  must("Expert actions ID-only",labels.length===8&&labels.every(x=>/^039-[a-z0-9-]+$/i.test(x.trim())),labels.join(" | "));
  must("assessment ceiling Demonstrated",/Automation ceiling: Demonstrated/.test(a),a);
  must("assessment does not auto-award higher levels",!/Verified|Applied|Mentor/.test(a),a);
  await closeCase("IT039 Expert",c);
}

{
  const c=await open(LIVE+"?lab=blocked_stair_a&difficulty=FOUNDATION");
  const p=c.page;
  await p.waitForFunction(()=>/RUNNING · SANDBOX/.test(document.querySelector("#labScenario")?.textContent||""),null,{timeout:60000});
  const s=await p.locator("#labScenario").innerText();
  must("blocked stair correct scenario",/Blocked Stair A/.test(s),s);
  must("blocked stair five actions",await p.locator("#labActions button").count()===5,await p.locator("#labActions button").count());
  must("blocked stair system state modeled",!/Modeled systems at baseline/.test(await p.locator("#labSystems").innerText()),await p.locator("#labSystems").innerText());
  await closeCase("blocked stair",c);
}

{
  const c=await open(LIVE+"?lab=EU-PSC-VITA-INTAKE-V1&difficulty=TECHNICIAN");
  const p=c.page;
  await p.waitForFunction(()=>/RUNNING · SANDBOX/.test(document.querySelector("#labScenario")?.textContent||""),null,{timeout:60000});
  const s=await p.locator("#labScenario").innerText();
  const panel=await p.locator("#labPanel").innerText();
  must("VITA correct scenario",/VITA\/TCE Intake/.test(s),s);
  must("VITA public-service family",/PUBLIC_SERVICE/.test(s),s);
  must("VITA seven actions",await p.locator("#labActions button").count()===7,await p.locator("#labActions button").count());
  must("VITA no obvious real PII",!/\b\d{3}-\d{2}-\d{4}\b|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/i.test(panel),panel);
  await closeCase("public VITA",c);
}

{
  const c=await open(LIVE,{width:390,height:844});
  const p=c.page;
  must("mobile canvas visible",await p.locator("canvas").isVisible());
  must("mobile HUD visible",await p.locator(".hud").isVisible());
  await p.locator("#labs").click();
  await p.locator("#labPanel").waitFor({state:"visible",timeout:15000});
  const box=await p.locator("#labPanel").boundingBox();
  must("mobile lab panel visible",await p.locator("#labPanel").isVisible());
  must("mobile lab panel within width",!!box&&box.x>=0&&box.x+box.width<=390.5,JSON.stringify(box));
  must("mobile lab panel below full viewport height",!!box&&box.height<844,JSON.stringify(box));
  await closeCase("mobile",c);
}

await browser.close();
const report={target:LIVE,generated_at:new Date().toISOString(),total:results.length,passed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results};
await fs.mkdir("interaction-artifacts",{recursive:true});
await fs.writeFile("interaction-artifacts/results.json",JSON.stringify(report,null,2));
await fs.writeFile("interaction-artifacts/summary.md",[
  "# Equity Uprise live interaction acceptance",
  "",
  `Target: ${LIVE}`,
  `Passed: ${report.passed}/${report.total}`,
  `Failed: ${report.failed}`,
  "",
  ...results.map(x=>`- ${x.ok?"PASS":"FAIL"} — ${x.name}${x.detail?" — "+x.detail:""}`)
].join("\n"));
console.log(`RESULT ${report.passed}/${report.total} passed; ${report.failed} failed`);
if(report.failed)process.exit(1);
