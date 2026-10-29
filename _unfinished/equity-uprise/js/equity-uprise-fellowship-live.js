(function(){
  "use strict";
  if(!/\/fellowship\.html$/.test(location.pathname))return;

  var SUPA=window.MCC_SUPA||null;
  var ANSWERS_KEY="eu-fellowship";
  var RECORD_KEY="mcc_fellowship_record";
  var busy=false;

  function answers(){try{return JSON.parse(localStorage.getItem(ANSWERS_KEY)||"{}");}catch(e){return{};}}
  function split(v){return String(v||"").split(", ").map(function(x){return x.trim();}).filter(Boolean);}
  function token(){var el=document.querySelector('[name="cf-turnstile-response"]');return window.EU_TURNSTILE_TOKEN||(el&&el.value)||"";}
  function endpoint(slug){return SUPA&&SUPA.url?SUPA.url+"/functions/v1/"+slug:"";}
  function headers(){
    var h={"Content-Type":"application/json"};
    if(SUPA&&SUPA.key)h.apikey=SUPA.key;
    return (SUPA&&SUPA.token?SUPA.token():Promise.resolve(null)).catch(function(){return null;}).then(function(t){if(t)h.Authorization="Bearer "+t;return h;});
  }
  function invoke(slug,body){
    if(!SUPA||!SUPA.url||!SUPA.key)return Promise.reject(new Error("The live intake is not configured yet."));
    return headers().then(function(h){return fetch(endpoint(slug),{method:"POST",headers:h,body:JSON.stringify(body)});})
      .then(function(r){return r.json().catch(function(){return{};}).then(function(j){if(!r.ok||j.error)throw new Error(j.error||("Request failed ("+r.status+")"));return j;});});
  }
  function applicationPayload(a){
    return {
      action:"fellowship",
      name:a.name||"",
      preferred_name:a.prefname||"",
      email:a.email||"",
      phone:a.phone||"",
      location:a.citystate||"",
      occupation:a.occupation||"",
      policy_interests:split(a.priorities),
      skills:a.talent?[a.talent]:[],
      availability:{modes:split(a.availability)},
      responses:a,
      consent:{contact_preference:a.consent||"",email_opt_in:/yes|email|announcement/i.test(a.consent||"")},
      stakeholder_types:["fellowship-applicant"],
      expertise_tags:a.talent?[a.talent]:[],
      cohort:"next-cohort",
      initiative_ids:[],
      turnstile_token:token()
    };
  }
  function mailFallback(a){
    var body="EQUITY UPRISE · POLICY FELLOWSHIP APPLICATION\n\n"+Object.keys(a).map(function(k){return k+": "+a[k];}).join("\n\n");
    location.href="mailto:matthew@mccluster.org?subject="+encodeURIComponent("Policy Fellowship: "+(a.name||"new fellow"))+"&body="+encodeURIComponent(body);
  }
  function statusBox(message,error){
    var input=document.getElementById("chatInput");
    if(!input)return null;
    var old=input.querySelector("[data-eu-live-status]");if(old)old.remove();
    var p=document.createElement("p");p.className="euhonest";p.setAttribute("data-eu-live-status","1");p.textContent=message;if(error)p.style.color="#a33";input.prepend(p);return p;
  }
  function markReviewButton(){
    var card=document.querySelector("#chatInput .chat__review");
    if(!card)return;
    var input=document.getElementById("chatInput");
    var send=input&&input.querySelector("button.btn--ruby");
    if(send&&!send.dataset.euPolicySubmit){send.dataset.euPolicySubmit="1";send.textContent="Submit to Equity Uprise →";}
  }
  function renderSlots(appId,bookingToken,result){
    var input=document.getElementById("chatInput");if(!input)return;
    var prior=input.querySelector("[data-eu-slots]");if(prior)prior.remove();
    var wrap=document.createElement("div");wrap.className="chat__review";wrap.setAttribute("data-eu-slots","1");
    var slots=(result&&result.slots)||[];
    wrap.innerHTML="<h3>Choose an interview time</h3><p>These are derived from the live calendar. Selecting one places a hold for review; the final calendar invitation is issued after approval.</p>";
    if(!slots.length){wrap.innerHTML+="<p>No interview slots are open in this window yet.</p>";input.appendChild(wrap);return;}
    var chips=document.createElement("div");chips.className="chat__chips";
    slots.slice(0,16).forEach(function(s){
      var b=document.createElement("button");b.type="button";b.className="chat__chip";
      var d=new Date(s.start);b.textContent=d.toLocaleString(undefined,{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
      b.addEventListener("click",function(){
        if(busy)return;busy=true;b.textContent="Holding…";
        invoke("eu-calendar",{action:"request",application_id:appId,booking_token:bookingToken,start:s.start,end:s.end,turnstile_token:token()})
          .then(function(j){statusBox("Interview time requested. Equity Uprise will approve it and the calendar invitation will carry the final time.");wrap.remove();try{var rec=JSON.parse(localStorage.getItem(RECORD_KEY)||"{}");rec.interview_request_id=j.request_id;rec.interview_state=j.state||"held";localStorage.setItem(RECORD_KEY,JSON.stringify(rec));}catch(e){}})
          .catch(function(e){statusBox(e.message||"That slot could not be held. Refresh availability and try again.",true);b.textContent=d.toLocaleString(undefined,{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});})
          .finally(function(){busy=false;});
      });
      chips.appendChild(b);
    });
    wrap.appendChild(chips);input.appendChild(wrap);
  }
  function loadSlots(appId,bookingToken){
    statusBox("Checking the live calendar…");
    return invoke("eu-calendar",{action:"availability",application_id:appId,booking_token:bookingToken,days:14,turnstile_token:token()})
      .then(function(j){statusBox("Application received. Pick a live interview window below.");renderSlots(appId,bookingToken,j);})
      .catch(function(e){statusBox("Application received, but live scheduling is not available yet: "+e.message,true);});
  }
  function submitLive(button){
    if(busy)return;var a=answers();busy=true;button.disabled=true;button.textContent="Submitting…";statusBox("Writing your application to the Equity Uprise record…");
    invoke("eu-intake",applicationPayload(a)).then(function(j){
      var rec={submitted_at:new Date().toISOString(),answers:a,application_id:j.application_id,stage:j.stage||"submitted",booking_token:j.booking_token||null};
      try{localStorage.setItem(RECORD_KEY,JSON.stringify(rec));}catch(e){}
      if(j.duplicate&&!j.booking_token){statusBox("An active application already exists for this email. It was not duplicated. Equity Uprise will continue from the existing record.");button.textContent="Application already on file";return;}
      localStorage.removeItem(ANSWERS_KEY);button.textContent="Received ✓";
      if(j.booking_token)loadSlots(j.application_id,j.booking_token);else statusBox("Application received. Equity Uprise will follow up about interview scheduling.");
    }).catch(function(e){
      statusBox("The live intake could not accept this application: "+(e.message||"unknown error"),true);button.disabled=false;button.textContent="Retry secure submission";
      var fallback=document.createElement("button");fallback.type="button";fallback.className="btn btn--ghost";fallback.style.marginLeft=".6rem";fallback.textContent="Send by email instead";fallback.addEventListener("click",function(){mailFallback(a);});button.parentNode.insertBefore(fallback,button.nextSibling);
    }).finally(function(){busy=false;});
  }

  var disclosure=document.querySelector(".manifesto .euhonest");
  if(disclosure)disclosure.innerHTML="<strong>How this works.</strong> Your unfinished answers stay in this browser while you type. When you submit, the terminal sends the completed application to the Equity Uprise intake and creates a reviewable fellowship record. If live intake is unavailable, you can still send the same record by email or download your own copy. <strong>A person reviews every application.</strong>";

  document.addEventListener("click",function(e){
    var b=e.target&&e.target.closest?e.target.closest("[data-eu-policy-submit]"):null;
    if(!b)return;e.preventDefault();e.stopImmediatePropagation();submitLive(b);
  },true);
  var observer=new MutationObserver(markReviewButton);observer.observe(document.getElementById("chatInput")||document.body,{childList:true,subtree:true});markReviewButton();
})();
