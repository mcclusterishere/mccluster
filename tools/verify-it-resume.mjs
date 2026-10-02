/* Verify the recruiter-focused IT résumé binaries match the canonical page. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { stampOf } from "./resume-stamp.mjs";

const ROOT=path.dirname(new URL(import.meta.url).pathname).replace(/\/tools$/,"");
const PAGE=path.join(ROOT,"resume-it-support.html");
const PDF=path.join(ROOT,"assets","resume","matthew-mccluster-resume-it-support.pdf");
const DOCX=path.join(ROOT,"assets","resume","matthew-mccluster-resume-it-support.docx");
const STAMP=PDF+".stamp";
const fails=[];
const check=(label,ok,why="")=>{console.log((ok?"  ok   ":"  FAIL ")+label+(ok?"":"\n         "+why));if(!ok)fails.push(label)};

check("IT résumé PDF exists",existsSync(PDF),"run: node tools/build-it-resume.mjs");
if(existsSync(PDF)) check(`IT résumé PDF has content (${(statSync(PDF).size/1024).toFixed(0)} KB)`,statSync(PDF).size>8000,"suspiciously small PDF");
check("IT résumé DOCX exists",existsSync(DOCX),"run: node tools/build-it-resume.mjs");
if(existsSync(DOCX)){
  let text="";
  try{text=execFileSync("python3",["-c",`import zipfile,re,sys
x=zipfile.ZipFile(sys.argv[1]).read('word/document.xml').decode('utf8')
print(re.sub(r'<[^>]+>','',x))`,DOCX],{encoding:"utf8"})}catch{}
  check("IT résumé DOCX is readable",text.length>500,"could not read word/document.xml");
  check("IT résumé DOCX carries core technical evidence",/IPC Systems/.test(text)&&/Robert Half/.test(text)&&/Southern Connecticut State University/.test(text)&&/telematics/i.test(text));
  check("IT résumé DOCX excludes unsupported training attribution",!/instructed new team members|trains new team members/i.test(text));
}
check("IT résumé stamp exists",existsSync(STAMP),"run: node tools/build-it-resume.mjs");
if(existsSync(STAMP)){
  const want=await stampOf(readFileSync(PAGE,"utf8")),got=readFileSync(STAMP,"utf8").trim();
  check("IT résumé PDF/DOCX match the page",want===got,`page is ${want}, artifacts were built from ${got}`);
}
const html=readFileSync(PAGE,"utf8");
check("IT résumé page links PDF and DOCX",/matthew-mccluster-resume-it-support\.pdf/.test(html)&&/matthew-mccluster-resume-it-support\.docx/.test(html));
console.log(`\n${fails.length} failed`);
process.exit(fails.length?1:0);
