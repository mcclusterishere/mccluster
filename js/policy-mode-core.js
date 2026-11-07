/* Policy presentation reuses canonical owner/live checks; it grants no API access. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MCC_POLICY_CORE=factory();})(typeof self!=='undefined'?self:this,function(){
  'use strict';
  function create({verifyOwner,show,studio,paint}){
    let epoch=0,state={active:false,view:'globe',busy:false,message:'Checking Policy preview access…'};
    function render(){paint({...state});}
    function revoke(){++epoch;state={...state,active:false,busy:false,message:'Policy preview requires current owner access.'};render();}
    async function activate(){
      const run=++epoch;let allowed=false;try{allowed=await verifyOwner();}catch(_){}
      if(run!==epoch)return false;
      if(!allowed){revoke();return false;}
      state={...state,active:true,busy:false,message:'Owner preview. Globe and community feed use existing public content. Audit publication is not connected.'};
      show(state.view);render();return true;
    }
    function select(view){
      if(!state.active||!['globe','feed'].includes(view))return false;
      state.view=view;show(view);render();return true;
    }
    async function live(){
      if(!state.active||state.busy)return false;
      const run=++epoch;state.busy=true;state.message='Checking live access…';render();
      try{
        if(!await verifyOwner()){if(run===epoch)revoke();return false;}
        if(run!==epoch)return false;
        const result=await studio(()=>run===epoch&&state.active);
        if(run!==epoch)return false;
        state.message=result&&result.opened?'Live studio opened. You are not broadcasting until you start and the connection succeeds.':result&&result.message||'Live studio is unavailable.';
        return !!(result&&result.opened);
      }catch(_){if(run===epoch)state.message='Live studio could not open. Try again.';return false;}
      finally{if(run===epoch){state.busy=false;render();}}
    }
    return {activate,select,live,revoke};
  }
  return {create};
});
