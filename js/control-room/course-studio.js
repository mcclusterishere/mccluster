/* Native owner Control slot. Only the authenticated Worker decides who can read or
   mutate a course; no course, answer, or queued job is saved in the browser. */
(function (root) {
  'use strict';
  const base = '/v1/prim3/learning/course-studio';
  const states = {queued:'Queued', running:'Building', ready:'Ready', failed:'Build failed'};
  const arr = value => Array.isArray(value) ? value : [];
  const count = value => Number.isInteger(value) && value >= 0 ? value : 0;
  function el(tag, content, cls) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (content != null) node.textContent = content;
    return node;
  }
  function button(title, fn, primary) {
    const b = el('button', title, 'cr-btn' + (primary ? ' cr-btn--primary' : ''));
    b.type = 'button'; b.onclick = fn; return b;
  }
  function sourceLink(source) {
    const a = el('a', source.title || 'Read source');
    a.href = source.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  }
  function secureLink(value) {
    if (typeof value !== 'string') return false;
    try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch (_) { return false; }
  }
  function readings(rows) { return arr(rows).filter(s => s?.title && secureLink(s.url)); }
  function panel(title) {
    const p = el('section', null, 'cs-panel');
    p.append(el('h3',title)); return p;
  }
  // Keep references scoped to this mount, never cache a private response across navigation.
  const resets = new WeakMap();
  function invalidate() { const host = document.querySelector('[data-course-studio]'); if (host) resets.get(host)?.(); }
  root.addEventListener('mcc:auth-changed', invalidate);
  root.addEventListener('storage', e => { if (e.key === null || e.key === 'mccdb_session') invalidate(); });
  function render() {
    return '<section class="cs-studio" data-course-studio aria-label="Private study desk"><header><p class="cs-label">Private study desk</p><p>Turn your course readings into a study brief and short practice rounds.</p></header><p role="status" data-cs-status>Checking owner access…</p><div data-cs-body></div></section>';
  }
  function bind(surface, {request}) {
    const host = surface.querySelector('[data-course-studio]');
    if (!host || host.dataset.bound) return;
    host.dataset.bound = '1';
    const body = host.querySelector('[data-cs-body]'), note = host.querySelector('[data-cs-status]');
    let active = true, generation = 0, timer = 0, selected = null, busy = false;
    const valid = n => active && host.isConnected && n === generation;
    const stop = () => { clearTimeout(timer); timer = 0; };
    function invalidateMount() {
      stop(); active = false; generation++; selected = null; body.replaceChildren();
      note.textContent = 'Your session changed. Reopen Course Studio to verify access.';
    }
    resets.set(host, invalidateMount);
    function failure(e, msg) {
      if (e?.status === 401 || e?.status === 403) {
        invalidateMount(); note.textContent = 'Owner access required. No private course records are available.'; return true;
      }
      note.textContent = msg; return false;
    }
    async function call(path, opts) {
      const result = await request(base + path, opts);
      if (result?.ok !== true) throw Error('Studio unavailable');
      return result;
    }
    const post = (path, data) => call(path, {method:'POST',body:data});
    const field = (form,name,label,limit,required=true) => {
      const l = el('label',label), input = el('input');
      input.name = name; input.required = required; input.maxLength = limit;
      input.autocomplete = 'off'; l.append(input); form.append(l); return input;
    };
    function plan(cadence) {
      const years=count(cadence?.years), exams=count(cadence?.exams_per_year), badges=count(cadence?.badges_per_month);
      const p=panel('Four-year credential plan');
      if (years && exams && badges) p.append(el('p', exams + ' certification exams per year × ' + years + ' years = ' + (exams*years) + ' planned exam attempts. ' +
          badges + (badges===1?' badge':' badges') + ' per month = ' + (badges*12*years) + ' badge targets over the same period.'));
      p.append(el('p','A badge documents a skill or completed activity. A certification is issued by its provider under separate requirements, often an exam. These targets and practice scores do not award either.'),
        el('p','For credit, keep the syllabus, credential record and issuer’s assessment details. Ask your school which requirement it would satisfy before counting any credits.'));
      return p;
    }
    function createPanel(list) {
      const p=panel('Add a course'), f=el('form', null,'cs-form');
      f.autocomplete='off'; p.append(f);
      const school=field(f,'school','School',120), code=field(f,'course_code','Course code',32),
            title=field(f,'title','Course title',160), term=field(f,'term','Term (optional)',64,false);
      const sources=el('fieldset'), legend=el('legend','Supported public readings'); sources.append(legend);
      const available=readings(list.readings);
      sources.append(el('p', available.length ? 'Choose readings yourself, or ask for suggestions based on your course title and code.' : 'No supported readings are available yet.'));
      if (available.length) {
        const result=el('p'); result.setAttribute('role','status');
        const normalized=s=>String(s||'').toLowerCase().replace(/([a-z])([0-9])/g,'$1 $2').replace(/([0-9])([a-z])/g,'$1 $2').replace(/[^a-z0-9]+/g,' ').trim();
        const suggest=button('Suggest readings',()=>{
          const query=' '+normalized(code.value+' '+title.value)+' ';
          const matches=[];
          available.forEach((s,i)=>{
            const terms=[s.topic,...arr(s.keywords)].map(normalized).filter(Boolean);
            const matched=terms.find(t=>query.includes(' '+t+' '));
            if(matched){ sources.querySelectorAll('input[name=source_urls]')[i].checked=true; matches.push(s.title+' ('+matched+')'); }
          });
          result.textContent=matches.length?'Selected by topic: '+matches.join('; ')+'. Review the selections before building.':
            'No reviewed reading matches this course title or code. Select a relevant reading manually, or leave this course unbuilt.';
        }); sources.append(suggest,result);
      }
      available.forEach(s => {
        const row=el('div',null,'cs-reading'), label=el('label'), box=el('input');
        box.type='checkbox'; box.name='source_urls'; box.value=s.url;
        label.append(box,el('span',s.title)); const link=sourceLink(s); link.textContent='Read'; link.setAttribute('aria-label','Read '+s.title);
        row.append(label,link); sources.append(row);
      });
      const submit=el('button','Build study game','cr-btn cr-btn--primary'); submit.type='submit'; submit.disabled=!available.length;
      f.append(sources,submit);
      let previous='', key='';
      f.onsubmit=async event => {
        event.preventDefault(); if (busy || !active) return;
        const urls=Array.from(f.querySelectorAll('input[name=source_urls]:checked'), n=>n.value);
        if (!urls.length) { note.textContent='Choose a public reading first.'; sources.querySelector('input')?.focus(); return; }
        const payload={school:school.value.trim(),course_code:code.value.trim(),title:title.value.trim(),term:term.value.trim(),source_urls:urls};
        if (!payload.school || !payload.course_code || !payload.title) {note.textContent='Enter a school, course code and course title.'; return;}
        const signature=JSON.stringify(payload);
        if (signature!==previous) { key=crypto.randomUUID(); previous=signature; }
        const n=++generation; busy=true; submit.disabled=true; note.textContent='Saving course…';
        try {
          const {id}=await post('',{...payload, request_id:key});
          if (!valid(n)) return;
          if (typeof id!=='string'||!id) throw Error('Missing course record');
          await detail(id,true);
        } catch(e) { if(valid(n)) failure(e,'Could not confirm the course was saved. Check your connection and try the same form again.'); }
        finally {busy=false; submit.disabled=!available.length;}
      };
      return p;
    }
    function label(c) {return [c.school,c.course_code,c.term].filter(Boolean).join(' · ');}
    function progress(c) {return count(c.completed) + ' of ' + count(c.total) + ' rounds complete';}
    function listView(data) {
      const library=panel('Your courses'), rows=arr(data.courses);
      if (!rows.length) library.append(el('p','No courses yet. Add one below to build your first study game.'));
      rows.forEach(c => {
        const b=button('',()=>{if(!busy) detail(c.id,true);}); b.className='cs-course';
        b.append(el('strong',c.title),el('span',label(c)),el('span',(states[c.state]||'Status unknown')+(c.state==='ready'?' · '+progress(c):'')));
        library.append(b);
      });
      const timeline=button('Degree timeline',()=>{
        if(!active||busy||!root.CR.degreeTimeline)return;
        stop(); selected=null; const n=++generation;
        const mount=el('div',null,'cs-timeline'); body.replaceChildren(mount); note.textContent='';
        root.CR.degreeTimeline.mount(mount,{call,back:home,openCourse:id=>detail(id,true),valid:()=>valid(n)&&mount.isConnected,
          denied:e=>failure(e,'Unable to open the timeline.')});
      });
      const degree=panel('Plan your degree'); degree.append(el('p','Map classes, exams and credentials to the requirements of each school.'),timeline);
      body.replaceChildren(degree,library,createPanel(data),plan(data.cadence));
    }
    async function home() {
      stop(); selected=null; const n=++generation; body.replaceChildren(); note.textContent='Loading courses…';
      try {
        const data=await call('');
        if (!valid(n)) return;
        if (!Array.isArray(data.courses)||!Array.isArray(data.readings)) throw Error('Incomplete catalog');
        listView(data); note.textContent='';
      } catch(e) {if(valid(n)&&!failure(e,'Course Studio is unavailable. Your course list could not be loaded.')) body.append(button('Try again',home));}
    }
    function cite(url,allowed) {
      const source=allowed.find(s=>s.url===url);
      return source?sourceLink(source):el('span','Source unavailable');
    }
    function back() {return button('All courses',()=>{if(!busy)home();});}
    function detailView(data) {
      const c=data.course, bundle=data.bundle, answers=arr(data.answers), p=panel(c.title), pending=['queued','running'].includes(c.state);
      p.append(el('p',label(c)),el('p',states[c.state]||'Status unknown','cs-label'));
      const content=[back(),p]; body.replaceChildren(...content);
      if (pending) {
        p.append(el('p',c.state==='queued'?'Course saved. Waiting for the study game to be built.':'Building the brief and practice rounds from your readings.'),
          el('p','You can leave and return to this course.'),button('Check status',()=>detail(c.id)));
        timer=setTimeout(()=>{if(valid(generation)&&selected===c.id)detail(c.id);},6000); return;
      }
      if (c.state==='failed') {
        p.append(el('p','The build did not finish. Retry this course without adding it again.'),button('Retry build',()=>mutate('/retry',{},'Could not confirm the retry. Check status before trying again.'),true),
          button('Check status',()=>detail(c.id))); return;
      }
      if (c.state!=='ready'||!bundle) {
        p.append(el('p','No study bundle was returned.'),button('Check status',()=>detail(c.id))); return;
      }
      const sources=readings(bundle.sources), rounds=arr(bundle.rounds), brief=panel('Study brief');
      arr(bundle.brief).forEach(line=>{const para=el('p',line.text);para.append(' ',cite(line.source,sources));brief.append(para);});
      if (!arr(bundle.brief).length) brief.append(el('p','No cited brief was returned.'));
      const practice=panel('Practice rounds'); body.append(brief,practice);
      const total=count(c.total), done=count(c.completed);
      practice.append(el('p',progress(c)+' · '+count(c.score)+' correct','cs-score'));
      if (total) {const meter=el('progress'); meter.max=total; meter.value=done; meter.setAttribute('aria-label','Rounds completed'); practice.append(meter);}
      const next=rounds.findIndex((_,i)=>!answers.some(a=>a.round===i));
      if (rounds.length && next===-1) practice.append(el('p','Practice complete. Review your answers and revisit the readings below.'));
      if (next>=0) {
        const r=rounds[next], group=el('fieldset'); group.append(el('legend','Round '+(next+1)+' of '+rounds.length),el('p',r.prompt));
        arr(r.choices).forEach((choice,i)=>group.append(button(choice,()=>mutate('/answers',{round:next,choice:i},'Could not confirm your answer. Reload this course to check your saved progress.'))));
        group.append(cite(r.source,sources)); practice.append(group);
      }
      if (answers.length) {
        const review=panel('Answer review'); answers.forEach(a=>{
          const r=rounds[a.round]; if(!r)return;
          const block=el('article'); block.append(el('h4','Round '+(a.round+1)+': '+(a.correct?'Correct':'Incorrect')),el('p',r.prompt),el('p','Your answer: '+(r.choices[a.choice]??'Unavailable')),el('p',a.explanation),cite(r.source,sources)); review.append(block);
        }); body.append(review);
      }
      const references=panel('Readings');
      references.append(el('p','The credits below apply to the source readings. The practice questions are separate Course Studio exercises.'));
      sources.forEach(s=>{
        const item=el('article'), title=el('p'); title.append(sourceLink(s)); item.append(title);
        if(s.attribution)item.append(el('p',s.attribution));
        if(s.license){
          const license=el('p','License: ');
          if(secureLink(s.license_url))license.append(sourceLink({title:s.license,url:s.license_url}));
          else license.append(String(s.license));
          item.append(license);
        }
        references.append(item);
      });body.append(references);
    }
    async function detail(id,enter=false) {
      if (typeof id!=='string'||!id||!host.isConnected||!active) return;
      selected=id; stop(); const n=++generation;
      if(enter) {body.replaceChildren(back()); note.textContent='Opening course…';}
      try {
        const data=await call('/'+encodeURIComponent(id)); if(!valid(n))return;
        if(data.course?.id!==id)throw Error('Missing course');
        note.textContent=''; detailView(data);
      } catch(e){ if(valid(n)&&!failure(e,'Could not load the latest course data.'))body.replaceChildren(back(),button('Reload course',()=>detail(id,true))); }
    }
    async function mutate(path,payload,message) {
      if (busy||!selected||!active)return;
      const id=selected,n=++generation; busy=true; stop(); note.textContent='Saving…';
      host.querySelectorAll('button').forEach(b=>{b.disabled=true;});
      try {await post('/'+encodeURIComponent(id)+path,payload); if(valid(n))await detail(id);}
      catch(e){if(valid(n)&&!failure(e,message)) body.replaceChildren(back(),button('Reload course',()=>detail(id,true)));}
      finally {busy=false;}
    }
    home();
  }
  root.CR = root.CR || {}; root.CR.courseStudio={render,bind};
})(window);
