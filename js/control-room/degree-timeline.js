/* Private Course Studio panel. Drafts and imports live only in the mounted
   browser view. Only the normalized plan record crosses the owner API. */
(function(root){
  'use strict';
  const KINDS={exam:'CLEP / other exam',course:'Course / paid class',badge:'Badge',certification:'Certification',task:'Task'};
  const STATUS={planned:'Planned',studying:'In progress',passed:'Passed',completed:'Completed'};
  const CREDIT={proposed:'Proposed',preapproved:'Preapproved (not posted)',posted:'Posted (dated evidence recorded)'};
  const EVIDENCE={'':'Not recorded',degree_audit:'Degree audit',transcript:'Transcript',registrar:'Registrar confirmation'};
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ID=/^[a-z0-9_-]{1,64}$/i;
  const sensitive=/[<>]|https?:\/\/|(?:bearer\s+\S+|eyJ[\w-]+\.)|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b|\b\d{3}-\d{2}-\d{4}\b|\b(?:access_token|refresh_token|password|authorization)\s*[:=]/i;
  const norm=x=>String(x).normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
  const fmtDate=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:'UTC'});
  const monthFmt=new Intl.DateTimeFormat('en-US',{year:'numeric',month:'long',timeZone:'UTC'});
  const printable=d=>fmtDate.format(new Date(d+'T00:00:00Z'));
  const today=()=>new Date().toISOString().slice(0,10);
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  const h=(title,level='h3')=>el(level,title);
  const panel=(title)=>{const p=el('section',null,'cs-panel');p.append(h(title));return p;};
  const b=(text,fn,primary=false)=>{const n=el('button',text,'cr-btn'+(primary?' cr-btn--primary':''));n.type='button';n.onclick=fn;return n;};
  const focus=n=>{n.tabIndex=-1;n.focus();};
  const clone=v=>structuredClone(v);
  const array=v=>Array.isArray(v)?v:[];
  function bad(message){throw Error(message);}
  function txt(v,max,label,optional=false){
    if(v==null&&optional)return '';
    if(typeof v!=='string'||v.length>max||/[\x00-\x1f\x7f]/.test(v)||sensitive.test(v)||(!optional&&!v.trim()))bad(label+' is missing, too long, or contains unsupported text.');
    return v.trim();
  }
  function date(v,label,optional=false){
    if((v==null||v==='')&&optional)return '';
    if(typeof v!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(v))bad(label+' must be an actual date between 2000 and 2099.');
    const d=new Date(v+'T00:00:00Z');
    if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==v||v.startsWith('0000'))bad(label+' must be an actual date.');
    return v;
  }
  function object(o,label){if(!o||typeof o!=='object'||Array.isArray(o))bad(label+' must be a record.');return o;}
  function list(l,limit,label){if(!Array.isArray(l)||l.length>limit)bad(label+' must be a list of at most '+limit+'.');return l;}
  function exact(v,choices,label){if(typeof v!=='string'||!Object.hasOwn(choices,v))bad(label+' is unsupported.');return v;}
  function amount(v,max,label){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>max||Math.abs(Math.round(v*100)-v*100)>1e-8)bad(label+' must be a nonnegative number with at most two decimal places.');return v;}
  function id(v){if(typeof v!=='string'||!ID.test(v))bad('Use short nonprivate IDs inside the file to link goals and milestones.');return v;}
  function unique(a,label){if(a.length!==new Set(a).size)bad(label+' cannot contain duplicates.');}
  function approved(d){return d.status==='preapproved'||d.status==='posted';}
  function eligible(i){return i.status==='passed'||i.status==='completed';}
  function safeHttps(u){try{const a=new URL(u);return a.protocol==='https:'&&!a.username&&!a.password;}catch(_){return false;}}
  function sanitize(raw,{importing=false}={}){
    object(raw,'Plan'); if(raw.version!==1)bad('Use a version 1 plan template.');
    const goals=list(raw.goals,20,'Goals').map(r=>{object(r,'Goal');return {id:id(r.id),label:txt(r.label,160,'Goal title'),school:txt(r.school,120,'Goal school')};});
    const items=list(raw.items,100,'Milestones').map(r=>{
      object(r,'Milestone');const i={id:id(r.id),label:txt(r.label,160,'Milestone title'),kind:exact(r.kind,KINDS,'Type'),
        start:date(r.start,'Start'),end:date(r.end,'Target date'),status:exact(r.status,STATUS,'Progress'),
        next_action:txt(r.next_action,400,'Next action',true),
        prerequisites:list(r.prerequisites??[],12,'Prerequisites').map(id),
        goal_ids:list(r.goal_ids??[],12,'Linked goals').map(id),
        destinations:list(r.destinations??[],8,'Destinations').map(d=>{
          object(d,'Destination');const destination={school:txt(d.school,120,'Destination school'),equivalent:txt(d.equivalent,120,'Equivalent',true),credits:d.credits==null?null:amount(d.credits,60,'Credit amount'),
            status:exact(d.status,CREDIT,'Credit status'),evidence_date:date(d.evidence_date,'Evidence date',true),
            evidence_type:exact(d.evidence_type??'',EVIDENCE,'Evidence type')};
          if(approved(destination)&&(!destination.equivalent||!destination.evidence_date||!destination.evidence_type||destination.evidence_date>today()))
            bad('Preapproved or posted credit requires an exact school equivalent and dated evidence (not a future date).');
          if(destination.status==='posted'&&(!eligible(r)||!(destination.credits>0)))bad('Credit can be marked posted only after passing or completing the milestone and entering a positive credit amount.');
          if(destination.status==='proposed'){destination.evidence_date='';destination.evidence_type='';}
          return destination;
        })};
      if(i.end<i.start)bad('A target date cannot be before its start date.');
      if(i.status==='passed'&&!['exam','certification'].includes(i.kind))bad('Passed applies to exams and certifications. Use Completed for this milestone.');
      const linked=r.study_course_id;
      // Imports cannot supply persistent IDs for another system. Link a private practice course in the on-screen editor instead.
      if(!importing&&linked){
        if(typeof linked!=='string'||!UUID.test(linked))bad('The linked practice course is not available to this owner.');
        i.study_course_id=linked;
      }
      unique(i.prerequisites,'Prerequisites');unique(i.goal_ids,'Linked goals');unique(i.destinations.map(d=>norm(d.school)),'Destination schools');
      return i;
    });
    unique(goals.map(g=>g.id),'Goal IDs');unique(items.map(i=>i.id),'Milestone IDs');
    const byId=new Map(items.map(i=>[i.id,i])), byGoal=new Set(goals.map(g=>g.id));
    const seen=new Set(),path=new Set();
    function check(i){
      if(path.has(i.id))bad('Prerequisites cannot form a loop.');
      if(seen.has(i.id))return; path.add(i.id);
      i.prerequisites.forEach(key=>{if(!byId.has(key))bad('A prerequisite must refer to a milestone in this plan.');check(byId.get(key));});
      if(i.goal_ids.some(key=>!byGoal.has(key)))bad('A goal link must refer to a goal in this plan.');
      path.delete(i.id);seen.add(i.id);
    }
    items.forEach(check);
    const plan={version:1,goals,items};
    if(raw.budget!=null){object(raw.budget,'Budget');plan.budget={amount_usd:amount(raw.budget.amount_usd,100000,'Budget amount'),note:txt(raw.budget.note,400,'Budget note')};}
    if(importing){
      const gids=new Map(goals.map(g=>[g.id,crypto.randomUUID()])), iids=new Map(items.map(i=>[i.id,crypto.randomUUID()]));
      goals.forEach(g=>g.id=gids.get(g.id)); items.forEach(i=>{i.id=iids.get(i.id);i.goal_ids=i.goal_ids.map(x=>gids.get(x));i.prerequisites=i.prerequisites.map(x=>iids.get(x));});
    }
    return plan;
  }
  function field(parent,caption,v='',{type='text',maxLength,required=false,options,min,max,step}={}){
    const label=el('label',caption);const n=el(options?'select':'input');n.setAttribute('aria-label',caption);label.append(n);parent.append(label);
    if(options){for(const [key,val] of options){const option=el('option',val);option.value=key;n.append(option);}}
    else {n.type=type;n.autocomplete='off';if(maxLength)n.maxLength=maxLength;if(min!=null)n.min=min;if(max!=null)n.max=max;if(step!=null)n.step=step;}
    n.value=v??''; n.required=required; return n;
  }
  function checkbox(parent,text,checked=false){
    const label=el('label',null,'tl-check'), n=el('input'); n.type='checkbox'; n.checked=checked; label.append(n,el('span',text));parent.append(label);return n;
  }
  function figure(name,value,copy){
    const node=el('div',null,'tl-figure');node.append(el('span',name),el('strong',value),el('small',copy));return node;
  }
  function project(plan){
    const out=new Map();
    plan.items.forEach(item=>item.destinations.forEach(d=>{
      const school=norm(d.school); if(!out.has(school))out.set(school,{school:d.school,sets:new Map(),proposed:0,preapproved:0});
      const entry=out.get(school), eq=norm(d.equivalent).replace(/[^\p{L}\p{N}]/gu,'');
      if(d.status!=='posted'){entry[d.status]++;return;}
      if(!eq)return;
      if(!entry.sets.has(eq))entry.sets.set(eq,{display:d.equivalent,credits:new Set()});entry.sets.get(eq).credits.add(d.credits);
    }));
    return [...out.values()].map(s=>{
      let sum=0;const conflicts=[];
      for(const {display,credits} of s.sets.values()){if(credits.size===1)sum+=Number([...credits][0]);else conflicts.push(display);}
      return {...s,posted_credits:Math.round(sum*100)/100,conflicts};
    });
  }
  function evidenceChanged(old,next){
    const shape=p=>p.items.flatMap(i=>i.destinations.filter(approved).map(d=>JSON.stringify([i.id,norm(d.school),d.equivalent,d.credits,d.status,d.evidence_date,d.evidence_type]))).sort().join('\n');
    return shape(old)!==shape(next);
  }
  function mount(host,{call,back,openCourse,valid,denied}){
    let state,mode='term',busy=false,serial=0;
    const title=h('Degree timeline'), actions=el('div',null,'tl-actions'), body=el('div',null,'tl-body'), note=el('p');note.setAttribute('role','status');note.setAttribute('data-tl-status','');
    const exit=b('Back to Course Studio',()=>{if(!busy){serial++;back();}});
    actions.append(exit); host.replaceChildren(actions,title,el('p','Private planning. Schools decide whether a course or exam meets their requirements. Nothing here syncs with a registrar or awards credit.'),note,body);
    focus(title);
    const notify=t=>{note.textContent=t;};
    const current=n=>valid()&&n===serial;
    function error(e,fallback){
      if(e?.status===401||e?.status===403){denied(e);return;}
      notify(fallback);
    }
    async function load(){
      const n=++serial;busy=true;body.replaceChildren();notify('Loading private timeline…');
      try {
        const res=await call('/timeline');
        if(!current(n))return;
        if(!Number.isSafeInteger(res.revision)||res.revision<0||res.plan?.version!==1||!Array.isArray(res.plan.goals)||!Array.isArray(res.plan.items))bad('Invalid timeline result');
        state={revision:res.revision,plan:res.plan,links:array(res.links),practice:array(res.practice)};
        draw();notify('');
      } catch(e){if(current(n)){error(e,'The private timeline could not be loaded.');if(valid())body.append(b('Retry timeline',load));}}
      finally{if(current(n))busy=false;}
    }
    async function save(next,confirmed){
      if(busy||!valid())return;
      const n=++serial;
      const change=evidenceChanged(state.plan,next);
      if(change&&!confirmed){notify('Confirm the dated school evidence before saving.');return;}
      busy=true;notify('Saving private plan…');
      const lock=[...body.querySelectorAll('button,input,select,textarea')].filter(x=>!x.disabled);lock.forEach(x=>x.disabled=true);
      try {
        const saved=await call('/timeline',{method:'PUT',body:{expected_revision:state.revision,plan:next,...(change?{confirm_evidence:true}:{})}});
        if(!current(n))return;
        if(!Number.isSafeInteger(saved.revision)||saved.revision<=state.revision)bad('Unconfirmed update');
        state={...state,revision:saved.revision,plan:saved.plan??next,links:saved.links??state.links,practice:saved.practice??state.practice};
        draw();notify('Private timeline saved.');focus(title);
      }catch(e){
        if(current(n)&&(e?.status===409)){
          notify('A newer plan was saved elsewhere. Your draft has not been saved. Reload the latest plan before applying your changes again.');
          if(!body.querySelector('[data-tl-conflict]')){
            const reload=b('Discard draft and reload latest plan',load);reload.setAttribute('data-tl-conflict','');body.prepend(reload);
          }
        } else if(current(n))error(e,'The save could not be confirmed. Check your connection and try again, or reopen Timeline to check what was saved.');
      }finally{if(current(n)){busy=false;lock.forEach(x=>x.disabled=false);}}
    }
    function box(parent,caption){
      const f=el('fieldset'), l=el('legend',caption);f.append(l);parent.append(f);return f;
    }
    function checks(f,rows,selected,label){
      if(!rows.length)f.append(el('p','None available yet.'));
      const choices=rows.map(r=>[r.id,checkbox(f,label(r),selected.includes(r.id))]);
      return ()=>choices.filter(([,c])=>c.checked).map(([id])=>id);
    }
    function edit(titleText,fn){
      if(busy)return;
      notify('');
      const p=panel(titleText), f=el('form',null,'tl-form');f.autocomplete='off';p.append(f);
      const done=fn(f);
      const row=el('div',null,'tl-actions'), submit=b('Save '+titleText.toLowerCase(),null,true);
      submit.type='submit';row.append(submit,b('Cancel',()=>{if(!busy){draw();notify('');focus(title);}}));f.append(row);
      f.onsubmit=e=>{
        e.preventDefault();if(busy||!valid())return;
        try{const {next,confirmed}=done();save(sanitize(next),confirmed);}
        catch(err){notify(err.message);}
      };
      body.replaceChildren(p);focus(p.querySelector('h3'));
    }
    function goal(g){
      edit('Goal',f=>{
        const label=field(f,'Degree, minor or other goal',g?.label,{required:true,maxLength:160});
        const school=field(f,'Goal school',g?.school,{required:true,maxLength:120});
        return ()=>{const next=clone(state.plan), value={id:g?.id??crypto.randomUUID(),label:label.value,school:school.value};
          next.goals=g?next.goals.map(x=>x.id===g.id?value:x):[...next.goals,value];return {next};};
      });
    }
    function budget(){
      edit('Budget note',f=>{
        const amount=field(f,'Conditional amount (USD)',state.plan.budget?.amount_usd,{type:'number',min:0,max:100000,step:.01});
        const note=field(f,'If and when this budget applies',state.plan.budget?.note,{maxLength:400});
        f.append(el('p','Leave the amount blank to remove this planning note. This does not spend money or create a commitment.'));
        return ()=>{const next=clone(state.plan);if(amount.value==='')delete next.budget;else next.budget={amount_usd:Number(amount.value),note:note.value};return {next};};
      });
    }
    function milestone(row){
      edit('Milestone',f=>{
        const label=field(f,'Milestone name',row?.label,{required:true,maxLength:160});
        const kind=field(f,'Type',row?.kind??'exam',{options:Object.entries(KINDS)});
        const status=field(f,'Self-reported progress',row?.status??'planned',{options:Object.entries(STATUS)});
        const statusOptions=()=>{
          const pass=status.querySelector('[value=passed]');
          pass.disabled=!['exam','certification'].includes(kind.value);
          if(pass.disabled&&status.value==='passed')status.value='completed';
        };kind.addEventListener('change',statusOptions);statusOptions();
        const start=field(f,'Start date',row?.start,{type:'date',required:true});
        const end=field(f,'Target date',row?.end,{type:'date',required:true});
        const nextAction=field(f,'Next action',row?.next_action,{maxLength:400});
        const prereq=checks(box(f,'Prerequisites'),state.plan.items.filter(i=>i.id!==row?.id),array(row?.prerequisites),i=>i.label);
        const goals=checks(box(f,'Linked goals'),state.plan.goals,array(row?.goal_ids),g=>g.label+' · '+g.school);
        const options=[['','None'],...state.practice.map(c=>[c.id,c.title])];
        if(row?.study_course_id&&!state.practice.some(c=>c.id===row.study_course_id))options.push([row.study_course_id,'Existing linked course (not listed)']);
        const linked=field(f,'Optional Course Studio practice',row?.study_course_id??'',{options});
        const schools=box(f,'Destination schools'), stack=el('div',null,'tl-destinations'), records=[];
        schools.append(el('p','Add one record per destination school. Add an exact course equivalent and dated evidence for preapproved or posted credit.'),stack);
        const confirm=checkbox(f,'I checked the dated transcript, degree audit or registrar confirmation for any change to preapprovals or postings.');
        const add=b('Add destination',()=>addSchool());schools.append(add);
        function addSchool(d={}){
          const p=box(stack,'Credit destination'); const s=field(p,'Destination school',d.school,{required:true,maxLength:120});
          const eq=field(p,'Exact course equivalent',d.equivalent,{maxLength:120});
          const units=field(p,'Credits (blank if unknown)',d.credits,{type:'number',min:0,max:60,step:.01});
          const st=field(p,'Credit status',d.status??'proposed',{options:Object.entries(CREDIT)});
          const dt=field(p,'Evidence date',d.evidence_date,{type:'date',max:today()});
          const evidence=field(p,'Evidence type',d.evidence_type??'',{options:Object.entries(EVIDENCE)});
          p.addEventListener('input',()=>confirm.checked=false);
          const read=()=>({school:s.value,equivalent:eq.value,credits:units.value===''?null:Number(units.value),status:st.value,evidence_date:dt.value,evidence_type:evidence.value});
          p.append(b('Remove destination',()=>{p.remove();records.splice(records.indexOf(read),1);add.disabled=false;confirm.checked=false;add.focus();}));
          records.push(read);add.disabled=records.length>=8;if(!d.school) s.focus();
        }
        array(row?.destinations).forEach(addSchool);
        return ()=>{
          const next=clone(state.plan), value={id:row?.id??crypto.randomUUID(),label:label.value,kind:kind.value,start:start.value,end:end.value,
            status:status.value,next_action:nextAction.value,prerequisites:prereq(),goal_ids:goals(),destinations:records.map(fn=>fn())};
          if(linked.value)value.study_course_id=linked.value;
          next.items=row?next.items.map(i=>i.id===row.id?value:i):[...next.items,value];return {next,confirmed:confirm.checked};
        };
      });
    }

    function timeline(plan,{preview=false}={}){
      const p=panel('Milestones');
      if(!plan.items.length){p.append(el('p','No milestones yet. Add a class, exam, badge, certification or task.'));return p;}
      const items=new Map(plan.items.map(i=>[i.id,i])), goals=new Map(plan.goals.map(g=>[g.id,g]));
      const groups=new Map(), order=[...plan.items].sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end)||a.label.localeCompare(b.label));
      order.forEach(item=>{
        const [year,month]=item.start.split('-');const term=Math.floor((Number(month)-1)/4);
        const key=mode==='month'?monthFmt.format(new Date(item.start+'T00:00:00Z')):`${['Jan – Apr','May – Aug','Sep – Dec'][term]} ${year}`;
        if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
      });
      if(!preview){
        const tool=el('div',null,'tl-actions');
        for(const [id,label] of [['term','By term'],['month','By month']]){
          const btn=b(label,()=>{mode=id;draw();body.querySelector('[aria-pressed=true]')?.focus();});btn.setAttribute('aria-pressed',String(mode===id));tool.append(btn);
        }
        p.append(tool,el('p','Grouped by start date. Term ranges are planning periods, not your school’s academic calendar.'));
      }
      for(const [term,rows] of groups){
        const group=el('section',null,'tl-term'), cards=el('ul',null,'tl-track');group.append(h(term,'h4'),cards);p.append(group);
        rows.forEach(i=>{
          const item=el('li',null,'tl-stage');
          const blocked=array(i.prerequisites).map(id=>items.get(id)).filter(x=>x&&!eligible(x));
          item.append(el('p',KINDS[i.kind]+' · '+STATUS[i.status],'cs-label'),h(i.label,'h5'),el('p',printable(i.start)+' to '+printable(i.end)));
          if(i.next_action)item.append(el('p','Next: '+i.next_action));
          if(i.prerequisites?.length)item.append(el('p', 'Prerequisites: '+i.prerequisites.map(id=>items.get(id)?.label||'Unavailable').join(', ')));
          if(blocked.length)item.append(el('p','Still needs: '+blocked.map(x=>x.label).join(', '),'tl-warning'));
          if(i.goal_ids?.length)item.append(el('p','Goals: '+i.goal_ids.map(id=>goals.get(id)?.label||'Unavailable').join(', ')));
          const practice=state.practice.find(c=>c.id===i.study_course_id);
          if(practice){
            item.append(el('p','Practice only: '+practice.title+' · '+(practice.total?String(practice.completed||0)+' of '+practice.total+' rounds complete':'No practice rounds available yet')+'.'));
            if(!preview)item.append(b('Open linked practice',()=>{if(!busy){serial++;openCourse(practice.id);}}));
          }
          if(i.destinations.length){
            const school=el('ul',null,'tl-credit-list');
            for(const d of i.destinations){
              const dest=el('li');dest.append(el('strong',d.school),el('p',(d.equivalent||'Equivalent unconfirmed')+' · '+(d.credits===null?'Credits unknown':d.credits+' credits')+' · '+CREDIT[d.status]));
              if(d.evidence_date&&d.evidence_type)dest.append(el('p',EVIDENCE[d.evidence_type]+' · '+printable(d.evidence_date)));
              school.append(dest);
            }
            item.append(school);
          }
          if(!preview)item.append(b('Edit '+i.label,()=>milestone(i)));
          cards.append(item);
        });
      }
      return p;
    }
    function overview(plan,preview=false){
      const nodes=[], stats=el('div',null,'tl-figures');
      const count=kind=>plan.items.filter(i=>i.kind===kind), earned=rows=>rows.filter(eligible).length;
      const exams=count('exam'),courses=count('course'),credentials=[...count('badge'),...count('certification')];
      stats.append(figure('Exams',earned(exams)+' / '+exams.length,'Passed/completed · self-reported'),
        figure('Classes',earned(courses)+' / '+courses.length,'Completed · self-reported'),
        figure('Credentials',earned(credentials)+' / '+credentials.length,'Badge/certification milestones · self-reported'));
      nodes.push(stats);
      const upNext=panel('Next actions');
      const pending=plan.items.filter(i=>!eligible(i)&&i.next_action).sort((a,b)=>a.end.localeCompare(b.end)||a.label.localeCompare(b.label));
      if(!pending.length)upNext.append(el('p','Add a next action to a milestone to see it here.'));
      else {
        const next=el('ol');
        pending.forEach(i=>{
          const missing=i.prerequisites.filter(id=>!eligible(plan.items.find(x=>x.id===id)||{}));
          const item=el('li',i.next_action+' · '+i.label+' · by '+printable(i.end)+(missing.length?' · prerequisite not complete':''));
          next.append(item);
        });
        upNext.append(next);
      }
      nodes.push(upNext);
      const goals=panel('Degree and minor goals');
      if(!plan.goals.length)goals.append(el('p','No goals yet.'));
      plan.goals.forEach(g=>{
        const group=el('article'); const linked=plan.items.filter(i=>i.goal_ids?.includes(g.id));
        group.append(h(g.label,'h4'),el('p',g.school+' · '+earned(linked)+' of '+linked.length+' linked milestones finished (self-reported)'));
        if(!preview)group.append(b('Edit '+g.label,()=>goal(g)));goals.append(group);
      });
      nodes.push(goals);
      const credit=panel('Institution credit');
      credit.append(el('p','No credits are awarded here. Only dated postings you recorded are counted, separately for each destination. Proposed and preapproved credits do not count.'));
      const totals=project(plan);
      if(!totals.length)credit.append(el('p','No destination school records yet.'));
      totals.forEach(s=>{
        const group=el('article');
        group.append(h(s.school,'h4'),el('p',s.posted_credits+' posted credits · '+s.preapproved+' preapproved · '+s.proposed+' proposed'));
        if(s.conflicts.length)group.append(el('p','Conflicting units excluded for: '+s.conflicts.join(', ')+'. Check the institution’s record.','tl-warning'));
        const verified=state.links.find(x=>norm(x.school)===norm(s.school)&&safeHttps(x.url));
        if(verified&&!preview){const a=el('a','Official school information');a.href=verified.url;a.target='_blank';a.rel='noopener noreferrer';group.append(a);}
        credit.append(group);
      });nodes.push(credit);
      if(plan.budget){
        const p=panel('Conditional budget');
        p.append(el('p',new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(plan.budget.amount_usd)+(plan.budget.note?' · '+plan.budget.note:'')));nodes.push(p);
      }
      nodes.push(timeline(plan,{preview}));return nodes;
    }
    function draw(){
      const tools=el('div',null,'tl-actions');
      tools.append(b('Add milestone',()=>milestone(),true),b('Add goal',()=>goal()),b('Budget note',budget),b('Import plan JSON',importPlan));
      body.replaceChildren(tools,...overview(state.plan));
    }
    function importPlan(){
      if(busy)return;
      notify('');
      const p=panel('Import plan JSON'), f=el('div',null,'tl-form');
      p.append(el('p','Paste a version 1 plan or choose a JSON file saved on this device. Nothing is sent when you open or preview it. Use only goals and planning milestones: no transcripts, student IDs, names of individuals or account details.'),f);
      const file=field(f,'Choose local JSON file','',{type:'file'}); file.accept='.json,application/json';
      const caption=el('label','Paste plan JSON'), input=el('textarea');input.rows=6; input.autocomplete='off';input.spellcheck=false;caption.append(input);f.append(caption);
      f.append(el('p','Unknown fields and linked practice-course IDs are left out. Import replaces the current plan only after you review and choose Save.'));
      const example=b('Insert empty template',()=>{input.value=JSON.stringify({version:1,goals:[],items:[]},null,2);});
      const cancel=b('Cancel',()=>{draw();notify('');focus(title);});
      const preview=b('Preview import',async()=>{
        if(busy||!valid())return;
        try{
          const raw=input.value, chosen=file.files[0];
          if(raw.trim()&&chosen)bad('Choose a local file or paste JSON, not both.');
          if(chosen?.size>262144||raw.length>262144)bad('The plan file is too large (limit 256 KB).');
          const source=raw.trim()?raw:chosen?await chosen.text():'';
          if(!f.isConnected||!valid())return;
          if(!source.trim())bad('Paste JSON or choose a file first.');
          let parsed;try{parsed=JSON.parse(source);}catch(_){bad('This is not valid plan JSON.');}
          const next=sanitize(parsed,{importing:true});
          input.value='';file.value='';notify('');
          importPreview(next);
        }catch(e){if(valid())notify(e.message);}
      },true);
      file.onchange=()=>{if(file.files.length)input.value='';};
      input.oninput=()=>{if(input.value)file.value='';};example.addEventListener('click',()=>file.value='');
      const row=el('div',null,'tl-actions');row.append(example,preview,cancel);f.append(row);body.replaceChildren(p);focus(p.querySelector('h3'));
    }
    function importPreview(next){
      const p=panel('Review import');
      p.append(el('p',next.goals.length+' goals and '+next.items.length+' milestones. Saving replaces your current timeline ('+state.plan.goals.length+' goals and '+state.plan.items.length+' milestones). Do not save if the preview contains private details beyond your plan.'));
      const reviewed=checkbox(p,'I reviewed this preview and want to replace my current plan.');
      const evidence=evidenceChanged(state.plan,next)?checkbox(p,'I checked the dated transcript, degree audit or registrar confirmation for any changes to preapprovals or postings in this plan.'):null;
      const tools=el('div',null,'tl-actions');
      const saveButton=b('Save imported plan',()=>save(next,!!evidence?.checked),true);
      const verify=()=>{saveButton.disabled=!reviewed.checked||Boolean(evidence&&!evidence.checked);};
      reviewed.onchange=verify;if(evidence)evidence.onchange=verify;
      tools.append(saveButton,b('Discard preview',()=>{draw();notify('');focus(title);}));p.append(tools);verify();
      body.replaceChildren(...overview(next,true),p);focus(p.querySelector('h3'));
    }
    load();
  }
  root.CR=root.CR||{};root.CR.degreeTimeline={mount};
})(window);
