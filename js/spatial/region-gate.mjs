export function eligibleView(view,{active=false}={}) {
  if(!view||![view.lon,view.lat,view.height].every(Number.isFinite))return false;
  const distance=Math.hypot((view.lon+73.1897895)*111320*Math.cos(41.1804834*Math.PI/180),(view.lat-41.1804834)*111320);
  return view.height>=0&&view.height<=(active?2600:1800)&&distance<=(active?1100:800);
}
// Abort and generation identity are both needed: sources may resolve after abort.
export function regionGate({load,attach,detach,onError=()=>{}}){
  let generation=0,controller=null,value=null,wanted=false,failed=false;
  return {
    update({owner,entered,view}){
      const next=owner&&entered&&eligibleView(view,{active:!!value||!!controller});
      if(!next){wanted=false;failed=false;generation++;controller?.abort();controller=null;if(value){detach(value);value=null;}return;}
      wanted=true;if(value||controller||failed)return;const token=++generation,c=new AbortController();controller=c;
      Promise.resolve().then(()=>load(c.signal)).then(result=>{if(token!==generation||c.signal.aborted||!wanted)return;controller=null;value=result;attach(result);}).catch(error=>{if(token!==generation||c.signal.aborted)return;controller=null;wanted=false;failed=true;if(value){detach(value);value=null;}onError(error);});
    },
    dispose(){this.update({owner:false});},
    status(){return {loading:!!controller,attached:!!value,generation};}
  };
}
