/* Paired presentations use exact pinned SVG paths. All annotations reference original atom/bond classes. */
import { escapeHTML as e, renderExample, bindExample, lessonFor } from './worked-example.mjs';
import { FAMILIES } from './engine.mjs';
export function structureAnswer(q, picked, ok, catalog, override = null) {
  if (!q.svg) return '';
  const lesson=override || lessonFor(q.id);
  const molecule=catalog.molecules.find(m=>m.id===q.id.replace(/^family:/,''));
  const otherFamily=Object.values(FAMILIES).find(f=>f.label===picked);
  return `<section class="mr-answer" data-answer-lesson="${e(lesson?.questionId || '')}" aria-label="Structure answer and explanation">
    <h3 tabindex="-1" data-answer-title>${ok?'Correct':'Let’s work it through'} · ${e(q.answer)}</h3>
    <p>You chose ${e(picked)}. ${ok?'Your answer is accepted.':`The answer is ${e(q.answer)}.`}</p>
    ${!ok && q.id.startsWith('family:') && otherFamily?`<p>${e(picked)} means: ${e(otherFamily.rule)} Here: ${e(q.explain)}</p>`:''}
    <figure class="mr-answer-diagram" role="img" aria-label="${e(lesson?lesson.summary:'Answer structure: '+(molecule?.name||q.answer))}">${q.svg}<figcaption>Same structure as the question · select a feature or atom</figcaption></figure>
    ${lesson?`<div role="group" aria-label="Highlight structure feature">${lesson.features.map((f,i)=>`<button type="button" class="mr-btn" data-highlight="${e(f.id)}" aria-pressed="false">${i+1} · ${e(f.label)}</button>`).join('')}</div><p data-anchor-feedback role="status"></p>
    <details class="mr-atoms"><summary>Locate an atom and its hydrogens</summary><p>C labels number the parent. X labels identify carbons outside it; element labels identify the other atoms. Select one to see its arrow.</p><div role="group" aria-label="Atoms in the structure">${lesson.graph.atoms.map(a=>`<button type="button" class="mr-btn mr-btn--quiet" data-atom="${a.id}" aria-pressed="false">${e(lesson.labels[a.id])} · ${e(a.element)} · ${a.hydrogens} H</button>`).join('')}</div></details><p data-atom-feedback role="status"></p>`:''}
    ${molecule?.aliases.length?`<p>Also accepted in Name It: ${molecule.aliases.map(e).join(', ')}.</p>`:''}
    ${lesson?renderExample({id:lesson.questionId,answer:lesson.name,picked:!q.id.startsWith('family:')&&!ok?picked:null},catalog,lesson):`<p>${e(q.explain)}</p><p class="mr-coverage">Deeper annotations have not been reviewed for this structure.</p>`}
    <button type="button" class="mr-btn" data-continue>Continue</button>
  </section>`;
}
const point = path => {
  const match=path.getAttribute('d').match(/^M\s*([-\d.]+)[ ,]+([-\d.]+)\s*L\s*([-\d.]+)[ ,]+([-\d.]+)/);
  if(!match) throw new Error('Unrecognized original bond path; annotation needs review.');
  return {start:{x:+match[1],y:+match[2]},end:{x:+match[3],y:+match[4]}};
};
export function anchorForAtom(svg, lesson, atomId) {
  const atom=lesson.graph.atoms[atomId];
  if(!atom) throw new Error('Unknown annotation atom.');
  // Written element/H labels are paths tagged to their RDKit atom. Point to the actual glyph box.
  const glyphs=[...svg.querySelectorAll(`path.atom-${atomId}`)].filter(p=>![...p.classList].some(c=>c.startsWith('bond-')));
  if(glyphs.length) {
    const bounds=glyphs.map(p=>p.getBBox());
    const x=Math.min(...bounds.map(b=>b.x)),y=Math.min(...bounds.map(b=>b.y));
    return {x:(x+Math.max(...bounds.map(b=>b.x+b.width)))/2,y:(y+Math.max(...bounds.map(b=>b.y+b.height)))/2,kind:'written atom label'};
  }
  const bonds=lesson.graph.bonds.filter(b=>b.a===atomId||b.b===atomId).sort((a,b)=>(a.order===1?0:a.aromatic?1:2)-(b.order===1?0:b.aromatic?1:2));
  const bond=bonds[0];
  const paths=[...svg.querySelectorAll(`path.bond-${bond.id}`)];
  if(!paths.length) throw new Error('Original bond anchor is missing.');
  // Ethene's isolated double bond is drawn symmetrically around the atom centers.
  if(lesson.questionId==='m8') {
    const ends=paths.map(p=>point(p)[bond.a===atomId?'start':'end']);
    return {x:ends.reduce((n,p)=>n+p.x,0)/ends.length,y:ends.reduce((n,p)=>n+p.y,0)/ends.length,kind:'implicit carbon'};
  }
  // In this pinned deck, the first multiple/aromatic path is the primary bond. Single bonds
  // to labeled heteroatoms may be split into two colored segments; take the actual far endpoint.
  const p=bond.order===1 && bond.b===atomId?paths.at(-1):paths[0];
  return {...point(p)[bond.a===atomId?'start':'end'],kind:'implicit carbon'};
}
export function bindStructureAnswer(host, override = null) {
  host = host.matches('.mr-answer') ? host : host.querySelector('.mr-answer');
  if (!host) return;
  const lesson=override || lessonFor(host.dataset.answerLesson || host.querySelector('[data-answer-lesson]')?.dataset.answerLesson);
  bindExample(host,override);
  if(!lesson) return;
  const svg=host.querySelector('.mr-answer-diagram svg'),ns='http://www.w3.org/2000/svg';
  const originals=new Map([...svg.querySelectorAll('path[class*="bond-"]')].map(p=>[p,p.getAttribute('style')]));
  const originalViewBox=svg.getAttribute('viewBox');
  svg.dataset.originalViewbox=originalViewBox;
  // Reserve a caption strip ABOVE the drawing. Every original coordinate/path stays unchanged.
  svg.setAttribute('viewBox','0 -60 500 290');
  const overlay=document.createElementNS(ns,'g');overlay.setAttribute('aria-hidden','true');overlay.setAttribute('data-annotation-overlay','');svg.append(overlay);
  const create=(tag,attrs)=>{const el=document.createElementNS(ns,tag);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,value);return el;};
  function selectAtom(id) {
    const atom=lesson.graph.atoms[id],anchor=anchorForAtom(svg,lesson,id);
    overlay.replaceChildren();
    const x1=250,y1=-18,dx=anchor.x-x1,dy=anchor.y-y1,len=Math.hypot(dx,dy),ux=dx/len,uy=dy/len;
    overlay.append(create('line',{x1,y1,x2:anchor.x,y2:anchor.y,stroke:'#354957','stroke-width':2,'stroke-dasharray':'5 4'}));
    overlay.append(create('circle',{cx:anchor.x,cy:anchor.y,r:9,fill:'none',stroke:'#172b39','stroke-width':2}));
    overlay.append(create('polygon',{points:`${anchor.x},${anchor.y} ${anchor.x-8*ux+4*uy},${anchor.y-8*uy-4*ux} ${anchor.x-8*ux-4*uy},${anchor.y-8*uy+4*ux}`,fill:'#172b39'}));
    const text=create('text',{x:250,y:-28,fill:'#172b39','font-size':32,'font-family':'system-ui','text-anchor':'middle'});
    text.textContent=`${lesson.labels[id]} · ${atom.element} · ${atom.hydrogens} H`;overlay.append(text);
    overlay.dataset.atomId=id;overlay.dataset.anchorX=anchor.x;overlay.dataset.anchorY=anchor.y;
    host.querySelectorAll('[data-atom]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.atom)===id)));
    const neighbors=lesson.graph.bonds.filter(b=>b.a===id||b.b===id).map(b=>`${lesson.labels[b.a===id?b.b:b.a]} (${b.aromatic?'aromatic':b.order===1?'single':b.order===2?'double':'triple'} bond)`);
    host.querySelector('[data-atom-feedback]').textContent=`Arrow: ${lesson.labels[id]}, ${anchor.kind}. ${atom.hydrogens} hydrogen${atom.hydrogens===1?'':'s'} attached. Connected to ${neighbors.join(', ')}. In the uncharged Lewis model: bond order ${atom.lewisBondOrderSum} to other atoms + ${atom.hydrogens} H = valence ${atom.lewisBondOrderSum+atom.hydrogens}.`;
  }
  host.querySelectorAll('[data-atom]').forEach(b=>b.onclick=()=>selectAtom(Number(b.dataset.atom)));
  host.querySelectorAll('[data-highlight]').forEach(button=>button.onclick=()=>{
    const feature=lesson.features.find(f=>f.id===button.dataset.highlight);
    for(const [p,style] of originals) {p.setAttribute('style',style);if(feature.bonds.some(id=>p.classList.contains('bond-'+id))){p.style.strokeWidth='7px';p.style.stroke=feature.id==='parent'?'#006b55':'#9c3b00';}}
    host.querySelectorAll('[data-highlight]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    host.querySelector('[data-anchor-feedback]').textContent=feature.text+' The selected bond paths are thicker. '+(feature.bonds.length?'':'This parent has one atom and no internal bond.');
    selectAtom(feature.atoms[0]);
  });
  host.querySelector('[data-highlight]').click();
}
