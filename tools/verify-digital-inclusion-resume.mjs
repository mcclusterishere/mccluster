/* Verify the technology-education / digital-inclusion résumé binaries match the canonical page. */
import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { stampOf } from "./resume-stamp.mjs";

const ROOT=path.dirname(new URL(import.meta.url).pathname).replace(/\/tools$/,"");
const PAGE=path.join(ROOT,"resume-digital-inclusion.html");
const PDF=path.join(ROOT,"assets","resume","matthew-mccluster-resume-digital-inclusion.pdf");
const DOCX=path.join(ROOT,"assets","resume","matthew-mccluster-resume-digital-inclusion.docx");
const STAMP=PDF+".stamp";
const fails=[];
const check=(label,ok,why="")=>{console.log((ok?"  ok   ":"  FAIL ")+label+(ok?"":"\n         "+why));if(!ok)fails.push(label)};

check("digital-inclusion résumé PDF exists",existsSync(PDF),"run: node tools/build-digital-inclusion-resume.mjs");
if(existsSync(PDF)) check(`digital-inclusion résumé PDF has content (${(statSync(PDF).size/1024).toFixed(0)} KB)`,statSync(PDF).size>8000,"suspiciously small PDF");
check("digital-inclusion résumé DOCX exists",existsSync(DOCX),"run: node tools/build-digital-inclusion-resume.mjs");
if(existsSync(DOCX)){
  let text="";
  try{text=execFileSync("python3",["-c",`import zipfile,re,sys
x=zipfile.ZipFile(sys.argv[1]).read('word/document.xml').decode('utf8')
print(re.sub(r'<[^>]+>','',x))`,DOCX],{encoding:"utf8"})}catch{}
  check("digital-inclusion résumé DOCX is readable",text.length>500,"could not read word/document.xml");
  check("digital-inclusion résumé carries role evidence",/PRIM3/.test(text)&&/F\.R\.E\.E\.D\.O\.M\./.test(text)&&/The WorkPlace/.test(text)&&/Southern Connecticut State University/.test(text));
  check("digital-inclusion résumé keeps marketing cut free of Whip Equipped",!/Whip Equipped/.test(text),"this variant intentionally omits Whip Equipped");
}
check("digital-inclusion résumé stamp exists",existsSync(STAMP),"run: node tools/build-digital-inclusion-resume.mjs");
if(existsSync(STAMP)){
  const want=await stampOf(readFileSync(PAGE,"utf8")),got=readFileSync(STAMP,"utf8").trim();
  check("digital-inclusion résumé PDF/DOCX match the page",want===got,`page is ${want}, artifacts were built from ${got}`);
}
const html=readFileSync(PAGE,"utf8");
check("digital-inclusion résumé page links PDF and DOCX",/matthew-mccluster-resume-digital-inclusion\.pdf/.test(html)&&/matthew-mccluster-resume-digital-inclusion\.docx/.test(html));
console.log(`\n${fails.length} failed`);
process.exit(fails.length?1:0);