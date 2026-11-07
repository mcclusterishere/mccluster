/* Local section navigation only. Routes, editors and authorization stay in CR.nav. */
(function(root){
 'use strict';root.CR=root.CR||{};
 var definitions={
  sell:[['Orders & payments',['orders','payments']],['Store & music',['store','music']]],
  create:[['Make',['projects','clipping','song-test']],['Publish',['publish','front-page']],['Build worlds',['level-forge']]],
  system:[['Health & activity',['overview','observability','workload']],['Operate',['command','resources','apps']],['Build & programs',['build','uprise']]]
 };
 function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function groups(section){
  if(!section||!definitions[section.id])return [];
  var used=new Set(),out=definitions[section.id].map(function(g){return {label:g[0],items:g[1].map(function(id){return section.items.find(function(x){return x.id===id;});}).filter(function(x){if(!x)return false;used.add(x.id);return true;})};}).filter(function(g){return g.items.length;});
  // Future registry destinations stay reachable without updating this presentation map.
  var rest=section.items.filter(function(x){return !used.has(x.id);});
  while(rest.length)out.push({label:'More tools'+(out.some(function(g){return g.label==='More tools';})?' '+(out.length+1):''),items:rest.splice(0,3)});
  return out;
 }
 function render(entry){
  var all=groups(entry.section);if(!all.length)return null;
  var selected=all.find(function(g){return g.items.some(function(x){return x.id===entry.item.id;});})||all[0];
  return '<div class="cr-local-groups"><nav class="cr-local-categories" aria-label="'+esc(entry.section.label)+' categories">'+all.map(function(g){var on=g===selected;return '<a href="'+esc(g.items[0].route)+'" data-nav-route="'+esc(g.items[0].route)+'"'+(on?' aria-current="true"':'')+'><strong>'+esc(g.label)+'</strong><small>'+g.items.length+' destinations</small></a>';}).join('')+'</nav><nav class="cr-local-items" aria-label="'+esc(selected.label)+' views">'+selected.items.map(function(it){return '<a href="'+esc(it.route)+'" data-nav-route="'+esc(it.route)+'"'+(it.id===entry.item.id?' aria-current="page"':'')+'>'+esc(it.label)+'</a>';}).join('')+'</nav></div>';
 }
 root.CR.sectionGroups={groups:groups,render:render};
})(typeof window==='undefined'?globalThis:window);
