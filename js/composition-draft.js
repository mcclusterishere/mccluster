/* Local recovery only. Canonical media and delivery records remain on the server.
   Never store credentials, signed URLs or file bytes in this record. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(root);else root.MCCCompositionDraft=factory(root);})(typeof globalThis!=='undefined'?globalThis:this,function(root){
 'use strict';
 var TTL=7*86400000;
 function create(storage,namespace){
  if(!/^[a-z][a-z0-9-]{0,30}$/.test(namespace))throw new Error("Invalid draft namespace");
  function key(owner){return /^[0-9a-f-]{36}$/i.test(owner||'')?'mcc_composition_v2:'+namespace+':'+owner.toLowerCase():null;}
  function clear(owner){var k=key(owner);if(k)try{storage.removeItem(k);}catch(_){}}
  function read(owner){var k=key(owner);if(!k)return null;try{var x=JSON.parse(storage.getItem(k)||'null');if(!x||x.owner!==owner||!Number.isFinite(x.saved_at)||!x.data||typeof x.data!=='object'||Array.isArray(x.data)||Date.now()-x.saved_at>TTL||x.saved_at>Date.now()+60000){clear(owner);return null;}return x.data;}catch(_){return null;}}
  function write(owner,data){var k=key(owner);if(!k||!data||typeof data!=='object'||Array.isArray(data))return false;try{var value=JSON.stringify({owner:owner,saved_at:Date.now(),data:data});if(value.length>64000)return false;storage.setItem(k,value);return true;}catch(_){return false;}}
  return {read:read,write:write,clear:clear};
 }
 function browser(namespace){var storage=null;try{storage=root.localStorage;}catch(_){}return create(storage,namespace);}
 return {create:create,browser:browser};
});
