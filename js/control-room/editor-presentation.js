/* Presentation-only enhancement of existing nodes. No requests, writes or role decisions. */
(function(root){
 'use strict';root.CR=root.CR||{};
 var currentScope=null,preferences=new Map();
 function clear(){currentScope=null;preferences.clear();}
 function scope(id){if(currentScope!==id){clear();currentScope=id;}}
 function text(node){return node?node.textContent.trim():'';}
 function node(tag,label){var el=document.createElement(tag);if(label)el.textContent=label;return el;}
 function fold(panel,key,label,initial){
  if(panel.querySelector(':scope > [data-editor-fold]'))return;
  var head=panel.querySelector(':scope > header'),content=Array.from(panel.children).filter(function(el){return el!==head;});
  if(!head)return;
  var details=node('details');details.dataset.editorFold=key;details.className='cr-editor-fold';
  var summary=node('summary',label);details.append(summary);content.forEach(function(el){details.append(el);});panel.append(details);
  var failed=!!details.querySelector('.cr-source,[role="alert"],.cr-state--bad'),busy=!!details.querySelector('button:disabled');
  details.open=failed||busy||(preferences.has(key)?preferences.get(key):initial);
  details.addEventListener('toggle',function(){if(details.isConnected)preferences.set(key,details.open);});
  var close=node('button','Close details');close.type='button';close.className='cr-btn';close.addEventListener('click',function(){details.open=false;summary.focus();});details.append(close);
  // Native validation must never focus a hidden control.
  details.addEventListener('invalid',function(){details.open=true;},true);
 }
 function ledger(container,kind,key){
  var table=Array.from(container.querySelectorAll('.cro-card table')).find(function(t){return /Payment records|Renewal records/.test(text(t.closest('.cro-card').querySelector('h2')));});
  if(!table||table.dataset.editorLedger)return;table.dataset.editorLedger='true';
  var headings=Array.from(table.querySelectorAll('th')).map(text),stateIndex=headings.indexOf('State');if(stateIndex<0)return;
  var rows=Array.from(table.querySelectorAll('tbody tr'));
  function state(row){var cell=row.cells[stateIndex],select=cell.querySelector('select');return (select?select.value:text(cell.querySelector('.cr-state'))||text(cell)).toLowerCase().trim();}
  var attention=kind==='payments'?['due','pending','failed']:['upcoming','lapsed'];
  var matches={all:function(){return true;},attention:function(r){return attention.includes(state(r));},other:function(r){return !attention.includes(state(r));}};
  var wrap=table.closest('.cr-table-wrap'),details=node('details');details.className='cr-editor-ledger';details.dataset.editorFold=key;
  var summary=node('summary','Browse all '+rows.length+' loaded '+kind+' records');details.append(summary);wrap.before(details);details.append(wrap);
  var strip=node('div');strip.className='cr-editor-summary';strip.setAttribute('role','group');strip.setAttribute('aria-label','Loaded '+kind+' records');details.before(strip);
  var note=node('p',kind==='payments'?'Counts cover loaded records, not revenue or the full ledger. Verification labels and amounts remain on each record.':'Counts cover loaded records. Upcoming and lapsed use recorded states, not a new due-date calculation.');note.className='cr-muted';strip.before(note);
  var choice=preferences.get(key+':filter')||'all';
  function apply(next,open){choice=next;preferences.set(key+':filter',next);rows.forEach(function(r){r.hidden=!matches[next](r);});strip.querySelectorAll('button').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.filter===next));});if(open)details.open=true;}
  [['all','All'],['attention',kind==='payments'?'Due, pending or failed':'Upcoming or lapsed'],['other','Other states']].forEach(function(pair){var b=node('button',pair[1]+' · '+rows.filter(matches[pair[0]]).length);b.type='button';b.dataset.filter=pair[0];b.addEventListener('click',function(){apply(pair[0],true);});strip.append(b);});
  details.open=preferences.get(key)===true;details.addEventListener('toggle',function(){if(details.isConnected)preferences.set(key,details.open);});
  details.addEventListener('change',function(){apply('all',true);});
  apply(choice,false);
 }
 function enhance(container,options){
  if(!container||!container.isConnected||!options||!options.scope)return;
  scope(options.scope);var route=options.route||'',key=options.scope+':'+route+':';
  if(route==='#sell:payments:payments'||route==='#sell:payments:renewals')ledger(container,route.endsWith(':renewals')?'renewals':'payments',key+'records');
  if(route==='#create:publish:channels'){
   container.querySelectorAll('.cr-panel').forEach(function(panel){var title=text(panel.querySelector(':scope > header h2'));
    if(title==='Register an account'||title==='Open a campaign')fold(panel,key+title,title==='Register an account'?'Register account · fields and status':'Create campaign · fields and status',false);
    if(title==='Campaigns')fold(panel,key+title,'Campaign list · '+text(panel.querySelector('.cr-panel__meta')),false);
   });
  }
  if(route==='#system:resources'){
   container.querySelectorAll('.cr-panel').forEach(function(panel){var title=text(panel.querySelector(':scope > header h2'));if(!title)return;
    var props=Array.from(panel.querySelectorAll('.cr-prop')).slice(0,3).map(function(p){return text(p.querySelector('span'))+': '+text(p.querySelector('b'));});
    var desc=props.length?props.join(' · '):text(panel.querySelector('.cr-panel__meta'));
    fold(panel,key+title,(title==='Usage & access'?'Balance, spend, allowance and consumers':title)+' · '+desc,!!panel.querySelector('[data-action="load-resources"]'));
   });
  }
 }
 root.addEventListener('mcc:auth-changed',clear);root.addEventListener('storage',function(e){if(e.key===null||e.key==='mccdb_session')clear();});
 root.CR.editorPresentation={enhance:enhance,clear:clear};
})(window);
