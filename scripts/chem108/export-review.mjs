// Portable, read-only review artifact using production renderers. No auth bypass or learner writes.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
const require=createRequire(import.meta.url),root=resolve(new URL('../../',import.meta.url).pathname);
const read=p=>readFileSync(resolve(root,p),'utf8');
const paths=['engine.mjs','validated-graphs.mjs','lesson-authoring.mjs','worked-example.mjs','structure-answer.mjs'];
const code=paths.map(p=>(p==='structure-answer.mjs'?'const e=escapeHTML;\n':'')+read('js/game-hub/chem108/'+p).replace(/^import .*;\n/gm,'').replace(/^export \{.*;\n/gm,'').replace(/^export /gm,'')).join('\n');
const molecules=require(resolve(root,'js/game-hub/chem108/data/data.js')).molecules;
const script=code+'\nconst catalog = '+JSON.stringify({molecules})+`;\n
const selector=document.querySelector('[data-select]'),pick=document.querySelector('[data-pick]'),target=document.querySelector('[data-preview]');
selector.innerHTML=catalog.molecules.map(m=>'<option value="'+m.id+'">'+escapeHTML(m.name)+'</option>').join('');
function render(){const m=catalog.molecules.find(x=>x.id===selector.value),chosen=pick.value;target.innerHTML='<details open><summary>Question drawing · name this structure</summary><figure class="mr-answer-diagram" role="img" aria-label="Original question drawing">'+m.svg+'</figure></details>'+structureAnswer({...m,answer:m.name},chosen,chosen===m.name,catalog);bindStructureAnswer(target);target.querySelector('[data-continue]').remove();}
function select(){const m=catalog.molecules.find(x=>x.id===selector.value);pick.innerHTML=catalog.molecules.filter(x=>x.deck===m.deck).map(x=>'<option '+(x.id===m.id?'selected':'')+'>'+escapeHTML(x.name)+'</option>').join('');render();}
selector.onchange=select;pick.onchange=render;selector.value='m27';select();
`;
const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Molecule Rush · 49-structure review</title><style>'+read('css/game-hub.css')+'\nbody.gh-body{padding-bottom:24px}.gh{padding-top:24px}label{display:grid;gap:8px}select{width:100%;min-height:44px;padding:8px;background:#101820;border:1px solid #788a92;border-radius:6px}summary{cursor:pointer;min-height:44px;padding:12px 0}h1{font-size:28px} [data-preview]{display:grid;gap:24px}</style><body class="gh-body"><main class="gh"><h1>Molecule Rush · Review copy</h1><p>All 49 original structures. This is an unscored, offline review copy, not your live Game Hub. Nothing is saved to your learner account. Formal charge is unspecified in course metadata; the uncharged SMILES model supplies the atom audit. Molecule-specific discovery history and instructor review remain pending.</p><label>Structure<select data-select></select></label><label>Example response to compare<select data-pick></select></label><div data-preview></div></main><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
const dest=resolve(process.argv[2]||'/tmp/chem108-evidence/molecule-rush-49-structure-review.html');mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,html);console.log(dest+' ('+Buffer.byteLength(html)+' bytes)');
