(function(root,doc){
  "use strict";
  var SB="https://zmnhbrjyhxzhkxmhkexs.supabase.co";
  var KEY="sb_publishable_kr5NujBZ1n518IUMDoa2dQ_tqQAJef4";
  var OFFER="end-racism-niggy-nigg-full";
  var buy=doc.getElementById("erBuyTrack"), status=doc.getElementById("erTrackStatus"), dl=doc.getElementById("erDownloadTrack"), preview=doc.getElementById("erTrackPreview");

  function tell(msg,bad){if(!status)return;status.textContent=msg||"";status.classList.toggle("is-bad",!!bad);}
  async function post(fn,body){
    var r=await fetch(SB+"/functions/v1/"+fn,{method:"POST",headers:{"content-type":"application/json",apikey:KEY},body:JSON.stringify(body),cache:"no-store"});
    var out=await r.json().catch(function(){return null;});
    if(!r.ok)throw new Error(out&&out.error||"Request failed");
    return out;
  }
  if(preview)preview.addEventListener("play",function(){
    if(root.MCC_TRACK)root.MCC_TRACK("end_racism_track_preview",{offer:OFFER});
  },{once:true});
  if(buy)buy.addEventListener("click",async function(){
    buy.disabled=true;tell("Opening secure checkout…");
    if(root.MCC_TRACK)root.MCC_TRACK("end_racism_track_checkout_open",{offer:OFFER});
    try{var out=await post("music-direct-checkout",{offer_key:OFFER});root.location.href=out.url;}
    catch(e){tell(e.message||"Checkout unavailable.",true);buy.disabled=false;}
  });

  var q=new URLSearchParams(root.location.search), sid=q.get("session_id");
  if(q.get("track_purchase")==="canceled")tell("Checkout canceled. The preview is still here.");
  if(q.get("track_purchase")==="success"&&sid){
    tell("Payment received. Unlocking your MP3…");
    post("music-direct-access",{session_id:sid}).then(function(out){
      if(!dl)return;
      dl.hidden=false;dl.href=out.url;dl.textContent="Download full MP3";
      tell("Paid. Your private download link is ready for 15 minutes.");
      if(root.MCC_TRACK)root.MCC_TRACK("end_racism_track_purchase_complete",{offer:OFFER});
      dl.addEventListener("click",function(){if(root.MCC_TRACK)root.MCC_TRACK("end_racism_track_download",{offer:OFFER});},{once:true});
    }).catch(function(e){tell((e.message||"Download is not ready.")+" Refresh this page to retry.",true);});
  }
})(window,document);
