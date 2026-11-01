/* Public episode identity only. No private manuscript, canon reveals or release claim. */
(function(w){
  'use strict';var pending;
  function load(){if(!pending)pending=fetch('data/story-index.json',{cache:'no-cache'}).then(function(r){if(!r.ok)throw new Error('Episode index unavailable');return r.json();}).catch(function(err){pending=null;throw err;});return pending;}
  function project(show,episode){return show+(episode?'-'+episode.toLowerCase():'');}
  function find(index,album,src){for(var show of index.shows||[])for(var ep of show.episodes||[])if((ep.tracks||[]).some(function(t){return t.album===album&&t.src===src;}))return{show:show,episode:ep};return null;}
  function bind(el,album,src){if(!el)return;var key=album+'|'+src;el.dataset.storyKey=key;el.hidden=true;el.removeAttribute('href');load().then(function(index){if(el.dataset.storyKey!==key)return;var found=find(index,album,src);if(!found)return;el.href='front.html?project='+project(found.show.id,found.episode.id);el.textContent=found.show.title+' · '+found.episode.id+' · '+found.episode.title+' — episode plan';el.hidden=false;}).catch(function(){});}
  w.MCC_STORIES={load:load,find:find,bind:bind,project:project};
})(window);
