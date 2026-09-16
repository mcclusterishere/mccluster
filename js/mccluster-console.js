(function(){
  'use strict';

  var $=function(s,r){return (r||document).querySelector(s)};
  var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
  var body=document.body;
  var composer=$('#ccComposer');
  var input=$('#ccInput');
  var thread=$('#ccThread');
  var title=$('#ccTitle');
  var project=$('#ccProjectName');
  var inspectorBody=$('#ccInspectorBody');
  var API=window.MCC_CONSOLE_API||'';

  var demoThreads={
    'sovereign-console':{
      title:'Build the sovereign console',project:'McCluster Core',
      messages:[
        {role:'user',html:'I want the whole McCluster backend to feel like one brutal, premium operating system — not a collection of admin pages.'},
        {role:'assistant',html:'<p><strong>Locked in.</strong> The chat becomes the command surface, not a support widget.</p><p>Projects, memory, jobs, assets, repositories and system state stay visible around the conversation so the interface feels like an operating room instead of a dashboard template.</p>',run:true,artifact:true}
      ]
    },
    'gpu-fabric':{
      title:'Blackwell GPU fabric',project:'McCluster Core',
      messages:[
        {role:'user',html:'Map the first Blackwell worker into the local generation fabric and keep the route sovereign by default.'},
        {role:'assistant',html:'<p>I would treat the GPU as a replaceable execution node behind a stable capability contract. The Console should show its health, queue pressure, loaded models and every asset produced from it.</p>',run:true}
      ]
    },
    'prim3':{
      title:'PRIM3 creature pipeline',project:'PRIM3',
      messages:[
        {role:'user',html:'Build a creature pipeline where concept art, 3D, animation and the playable preview all stay attached to one project thread.'},
        {role:'assistant',html:'<p>That belongs in one durable project lineage: brief → image concepts → selected source → GLB → animation → repo branch → preview deploy. The conversation references versions instead of copying giant files into history.</p>',artifact:true}
      ]
    }
  };

  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}

  function assistantBlock(m){
    var run=m.run?'<div class="cc-run"><div class="cc-run__head"><span class="cc-run__badge">Execution</span><span class="cc-run__title">McCluster Core</span><span class="cc-run__state">complete</span></div><div class="cc-run__steps"><div class="cc-step"><span class="cc-step__dot"></span><span>Context assembled</span><small>memory + project</small></div><div class="cc-step"><span class="cc-step__dot"></span><span>Core capabilities inspected</span><small>11 tools target</small></div><div class="cc-step"><span class="cc-step__dot"></span><span>Owner response prepared</span><small>OVH · local</small></div></div></div>':'';
    var artifact=m.artifact?'<div class="cc-artifact"><div class="cc-artifact__preview">LIVE ARTIFACT</div><div><div class="cc-artifact__label">Console design</div><div class="cc-artifact__title">McCluster sovereign workspace</div><div class="cc-artifact__meta">Versioned · project attached · owner only</div><div class="cc-artifact__actions"><button type="button">Open</button><button type="button">Inspect</button><button type="button">Fork</button></div></div></div>':'';
    return '<article class="cc-msg"><div class="cc-msg__avatar cc-msg__avatar--m"><img src="assets/img/m-mark.png" alt=""></div><div class="cc-msg__body"><div class="cc-msg__meta"><b>McCluster</b> · Qwen3 8B · Sovereign</div><div class="cc-msg__content">'+m.html+'</div>'+run+artifact+'</div></article>';
  }

  function userBlock(m){return '<article class="cc-msg cc-msg--user"><div class="cc-msg__body"><div class="cc-msg__meta">You</div><div class="cc-msg__content">'+m.html+'</div></div></article>'}

  function renderThread(id){
    var data=demoThreads[id]||demoThreads['sovereign-console'];
    title.textContent=data.title;
    project.textContent=data.project;
    var html='<div class="cc-date">Today · Owner workspace</div>';
    data.messages.forEach(function(m){html+=m.role==='assistant'?assistantBlock(m):userBlock(m)});
    thread.innerHTML=html;
    $$('.cc-thread').forEach(function(b){b.classList.toggle('is-current',b.getAttribute('data-thread')===id)});
    var scroller=$('.cc-scroll'); if(scroller) scroller.scrollTop=scroller.scrollHeight;
  }

  function appendUser(text){
    var wrap=document.createElement('div');
    wrap.innerHTML=userBlock({html:esc(text)});
    thread.appendChild(wrap.firstChild);
  }

  function appendAssistant(html,meta){
    var wrap=document.createElement('div');
    wrap.innerHTML=assistantBlock({html:html,run:!!(meta&&meta.run),artifact:!!(meta&&meta.artifact)});
    thread.appendChild(wrap.firstChild);
  }

  function scrollBottom(){var s=$('.cc-scroll');if(s)s.scrollTo({top:s.scrollHeight,behavior:'smooth'})}

  function submit(text){
    text=(text||'').trim(); if(!text)return;
    appendUser(text); input.value=''; input.style.height='auto'; scrollBottom();
    var waiting=document.createElement('article'); waiting.className='cc-msg'; waiting.id='ccWaiting'; waiting.innerHTML='<div class="cc-msg__avatar cc-msg__avatar--m"><img src="assets/img/m-mark.png" alt=""></div><div class="cc-msg__body"><div class="cc-msg__meta"><b>McCluster</b> · thinking locally</div><div class="cc-msg__content"><p style="color:var(--cc-dim)">Routing through McCluster Core…</p></div></div>';
    thread.appendChild(waiting); scrollBottom();

    if(!API){
      setTimeout(function(){
        if(waiting.parentNode)waiting.parentNode.removeChild(waiting);
        appendAssistant('<p><strong>Console shell is live.</strong> The UI is ready for the conversation/control API. Once that endpoint is wired, this same surface can stream local-model output, tool events, memory retrieval, jobs and artifacts without changing the design.</p>',{run:true});
        scrollBottom();
      },650);
      return;
    }

    fetch(API.replace(/\/$/,'')+'/chat',{method:'POST',headers:{'content-type':'application/json'},credentials:'include',body:JSON.stringify({message:text,project:project.textContent,conversation:title.textContent})})
      .then(function(r){if(!r.ok)throw new Error('chat '+r.status);return r.json()})
      .then(function(data){if(waiting.parentNode)waiting.parentNode.removeChild(waiting);appendAssistant('<p>'+esc(data.reply||data.message||'Done.')+'</p>',data);scrollBottom()})
      .catch(function(){if(waiting.parentNode)waiting.parentNode.removeChild(waiting);appendAssistant('<p>The Console API did not answer. Your message is still on screen; runtime wiring is the next backend step.</p>');scrollBottom()});
  }

  $$('.cc-thread').forEach(function(b){b.addEventListener('click',function(){renderThread(b.getAttribute('data-thread'))})});
  $$('.cc-project').forEach(function(b){b.addEventListener('click',function(){project.textContent=b.getAttribute('data-project')||b.textContent.trim()})});

  var railBtn=$('#ccRailToggle'),inspectBtn=$('#ccInspectorToggle'),scrim=$('#ccScrim');
  if(railBtn)railBtn.addEventListener('click',function(){body.classList.toggle('cc-rail-open');body.classList.remove('cc-inspector-open')});
  if(inspectBtn)inspectBtn.addEventListener('click',function(){body.classList.toggle('cc-inspector-open');body.classList.remove('cc-rail-open')});
  if(scrim)scrim.addEventListener('click',function(){body.classList.remove('cc-rail-open','cc-inspector-open')});

  $$('.cc-inspector__tabs button').forEach(function(btn){btn.addEventListener('click',function(){
    $$('.cc-inspector__tabs button').forEach(function(x){x.classList.remove('is-active')});btn.classList.add('is-active');
    var tab=btn.getAttribute('data-tab');
    if(tab==='context') inspectorBody.innerHTML=contextMarkup();
    if(tab==='memory') inspectorBody.innerHTML=memoryMarkup();
    if(tab==='run') inspectorBody.innerHTML=runMarkup();
  })});

  function contextMarkup(){return '<section class="cc-card cc-sovereign"><div class="cc-card__k">Execution policy</div><div class="cc-card__title">Sovereign required</div><div class="cc-card__meta">Local planner and tools. External specialist inference is blocked unless explicitly authorized.</div></section><section class="cc-card"><div class="cc-card__k">Context envelope</div><div class="cc-card__title">18.4k / 44k chars</div><div class="cc-meter"><span></span></div><div class="cc-card__row"><span>Project instructions</span><b>2.8k</b></div><div class="cc-card__row"><span>Conversation</span><b>9.7k</b></div><div class="cc-card__row"><span>Retrieved memory</span><b>3.1k</b></div><div class="cc-card__row"><span>Tool results</span><b>2.8k</b></div></section><section class="cc-card"><div class="cc-card__k">Attached project</div><div class="cc-card__title">McCluster Core</div><div class="cc-card__meta">Repos, assets, policy and execution history remain scoped to this project.</div></section><section class="cc-card"><div class="cc-card__k">Compute</div><div class="cc-node"><span class="cc-node__dot"></span><div><b>OVH Core · online</b><small>Qwen3 8B · local inference</small></div></div><div class="cc-node"><span class="cc-node__dot"></span><div><b>GPU Fabric · standby</b><small>specialist media worker</small></div></div></section>'}
  function memoryMarkup(){return '<section class="cc-card"><div class="cc-card__k">Memory ledger</div><div class="cc-card__title">4 memories in this turn</div><div class="cc-memory"><span class="cc-memory__pin"></span><div class="cc-memory__text">Projects are durable operating environments, not folders.<span class="cc-memory__src">Pinned · Console architecture</span></div></div><div class="cc-memory"><span class="cc-memory__pin"></span><div class="cc-memory__text">Prefer sovereign/local execution when a local capability exists.<span class="cc-memory__src">Project policy</span></div></div><div class="cc-memory"><span class="cc-memory__pin"></span><div class="cc-memory__text">The public Desk and the owner Console are separate products.<span class="cc-memory__src">Architecture decision</span></div></div><div class="cc-memory"><span class="cc-memory__pin"></span><div class="cc-memory__text">Conversation history must survive model replacement.<span class="cc-memory__src">Pinned · product invariant</span></div></div></section>'}
  function runMarkup(){return '<section class="cc-card"><div class="cc-card__k">Current runtime</div><div class="cc-card__title">Qwen3 8B</div><div class="cc-card__meta">OVH · local · no metered inference</div></section><section class="cc-card"><div class="cc-card__k">Last execution</div><div class="cc-card__row"><span>Duration</span><b>2.7s</b></div><div class="cc-card__row"><span>Tool calls</span><b>3</b></div><div class="cc-card__row"><span>External cost</span><b>$0.00</b></div><div class="cc-card__row"><span>Assets</span><b>1</b></div></section><section class="cc-card"><div class="cc-card__k">Node state</div><div class="cc-node"><span class="cc-node__dot"></span><div><b>Core broker healthy</b><small>control plane reachable</small></div></div><div class="cc-node"><span class="cc-node__dot"></span><div><b>Context service healthy</b><small>conversation state available</small></div></div></section>'}

  if(composer)composer.addEventListener('submit',function(e){e.preventDefault();submit(input.value)});
  if(input){input.addEventListener('input',function(){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,190)+'px'});input.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit(input.value)}})}
  var newBtn=$('#ccNew'); if(newBtn)newBtn.addEventListener('click',function(){title.textContent='Untitled conversation';thread.innerHTML='<div class="cc-date">New conversation</div>';input.focus();if(window.innerWidth<760)body.classList.remove('cc-rail-open')});

  renderThread('sovereign-console');
  inspectorBody.innerHTML=contextMarkup();
})();
