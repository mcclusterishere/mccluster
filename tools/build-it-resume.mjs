/* Build the recruiter-focused IT résumé artifacts from resume-it-support.html.
 * The HTML page is canonical. This renders the PDF, derives the ATS-friendly
 * DOCX through scripts/resume-docx.py, and stamps both against visible text.
 */
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { stampOf } from "./resume-stamp.mjs";

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PW_MODULE||"playwright");
const ROOT=path.dirname(new URL(import.meta.url).pathname).replace(/\/tools$/,"");
const PORT=8935, BASE=`http://127.0.0.1:${PORT}/`;
const PAGE="resume-it-support.html";
const DIR=path.join(ROOT,"assets","resume");
const PDF=path.join(DIR,"matthew-mccluster-resume-it-support.pdf");
const DOCX=path.join(DIR,"matthew-mccluster-resume-it-support.docx");
const STAMP=PDF+".stamp";

function waitForServer(tries=50){
  return new Promise((resolve,reject)=>{
    const ping=n=>http.get(BASE,()=>resolve()).on("error",()=>n<=0?reject(new Error("server never came up")):setTimeout(()=>ping(n-1),200));
    ping(tries);
  });
}

if(import.meta.url===`file://${process.argv[1]}`){
  const server=spawn("python3",["-m","http.server",String(PORT)],{cwd:ROOT,stdio:"ignore"});
  try{
    await waitForServer();
    const browser=await chromium.launch({args:["--no-sandbox"],...(process.env.PW_CHROME?{executablePath:process.env.PW_CHROME}:{})});
    const page=await browser.newPage();
    const errs=[]; page.on("pageerror",e=>errs.push(String(e).slice(0,160)));
    await page.goto(BASE+PAGE,{waitUntil:"networkidle",timeout:30000});
    await page.waitForTimeout(900);
    if(errs.length) throw new Error("the page errored, refusing to print it: "+errs.join(" | "));
    await page.emulateMedia({media:"print"});
    mkdirSync(DIR,{recursive:true});
    await page.pdf({path:PDF,format:"Letter",printBackground:false,preferCSSPageSize:true,displayHeaderFooter:false});
    await browser.close();

    execFileSync("python3",["scripts/resume-docx.py",PAGE,path.relative(ROOT,DOCX)],{cwd:ROOT,stdio:"inherit"});
    const stamp=await stampOf(readFileSync(path.join(ROOT,PAGE),"utf8"));
    writeFileSync(STAMP,stamp+"\n");
    console.log(`wrote ${path.relative(ROOT,PDF)} (${(readFileSync(PDF).length/1024).toFixed(0)} KB)`);
    console.log(`wrote ${path.relative(ROOT,DOCX)}`);
    console.log("stamp",stamp);
  } finally { server.kill(); }
}
