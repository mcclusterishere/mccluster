/* Audio-only rooms on the World's Live view, Clubhouse style: a stage of up
   to four speakers, everyone else listening, hands raised to the host.
   No recording, transcription, background media, or microphone request on
   load, listen or join. The person's own "Speak" tap is the ONLY
   getUserMedia call.
   Signed out, a visitor can listen to a room in the country their
   connection is in (the server decides, owner 2026-10-20); every other
   region's conversations, raising a hand and speaking take signing in.
   People are shown by display name; the server never sends member ids. */
(function(w,d){
  'use strict';
  var M=w.MCC_MNET, ROOT='/v1/mnet/audio', BASE='https://api.mccluster.org'+ROOT,
      status=null, place=null, current=null, you=null, pass=null, mic=null, sendPc=null,
      receives=new Map(), poll=null, refreshing=false, beat=0;
  if(!M || typeof M.api!=='function')return;
  function $(id){return d.getElementById(id);}
  function signedIn(){try{var s=w.MCC&&w.MCC.session&&w.MCC.session();return !!(s&&s.access_token);}catch(_){return false;}}
  function read(r){
    return r.text().then(function(t){var b=null;try{b=t?JSON.parse(t):null;}catch(_){}
      if(!r.ok)throw Object.assign(Error(b&&b.error||'Audio room unavailable'),{status:r.status,data:b});
      return b;});
  }
  function open(path,body,auth){
    return fetch(BASE+path,{method:body===undefined?'GET':'POST',credentials:'omit',cache:'no-store',
      headers:Object.assign(auth?{authorization:'Bearer '+auth}:{},body===undefined?{}:{'content-type':'application/json'}),
      body:body===undefined?undefined:JSON.stringify(body)}).then(read);
  }
  // A visitor's room calls carry their listening pass; a member's carry their session.
  function call(path,body){
    if(pass)return open(path,body,pass);
    return M.api(ROOT+path,body===undefined?undefined:{method:'POST',body:body});
  }
  function at(path){return '/rooms/'+current.id+path;}
  function wantsSignIn(e){return !!(e&&e.data&&e.data.detail&&e.data.detail.sign_in);}
  function askSignIn(){if(typeof M.signIn==='function')M.signIn('rooms');else w.location.assign('account.html');}
  function note(s){if($('mnAudioNote'))$('mnAudioNote').textContent=s||'';}
  function roomNote(s){if($('mnAudioRoomNote'))$('mnAudioRoomNote').textContent=s||'';}
  function el(tag,cls,text){var e=d.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function btn(txt,fn,cls){var b=el('button',cls,txt);b.type='button';b.onclick=fn;return b;}
  function placeName(code){
    if(!code)return 'Everywhere';
    try{return new Intl.DisplayNames([navigator.language||'en'],{type:'region'}).of(code)||code;}catch(_){return code;}
  }
  function initials(name){return String(name||'?').trim().split(/\s+/).slice(0,2).map(function(x){return x.charAt(0);}).join('').toUpperCase()||'?';}
  function face(p){
    var f=el('span','mn-audio-face');f.setAttribute('aria-hidden','true');
    if(p.avatar_url&&/^https:\/\//.test(p.avatar_url)){var img=el('img');img.alt='';img.src=p.avatar_url;img.loading='lazy';
      img.onerror=function(){img.remove();f.dataset.initials=initials(p.display_name);};f.appendChild(img);}
    else f.dataset.initials=initials(p.display_name);
    return f;
  }
  function visitorCountry(){return status&&status.visitors&&status.visitors.listen?status.visitors.country||null:null;}
  function canEnter(r){return signedIn()||(!!visitorCountry()&&r.visitors_may_listen&&r.country_code===visitorCountry());}
  function makePc(){return new RTCPeerConnection({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}]});}
  function ice(pc){
    if(pc.iceGatheringState==='complete')return Promise.resolve();
    return new Promise(function(ok,bad){
      var timeout=setTimeout(function(){pc.removeEventListener('icegatheringstatechange',ready);bad(Error('ICE timed out'));},12000);
      function ready(){if(pc.iceGatheringState==='complete'){
        clearTimeout(timeout);pc.removeEventListener('icegatheringstatechange',ready);ok();
      }}
      pc.addEventListener('icegatheringstatechange',ready);ready();
    });
  }
  function mount(){
    var anchor=$('mnLiveTrack');if(!anchor || $('mnAudioDoor'))return;
    var panel=d.createElement('section');panel.id='mnAudioDoor';panel.className='mn-audio';
    panel.setAttribute('aria-labelledby','mnAudioTitleHead');
    panel.innerHTML='<header><div><small>Audio only · Nothing is recorded</small><h2 id="mnAudioTitleHead">Conversations</h2>'+
      '<p>Listen live and raise your hand to talk. Your microphone stays off until you tap Speak.</p></div>'+
      '<button id="mnAudioReload" type="button">Refresh</button></header>'+
      '<div class="mn-audio-place"><p id="mnAudioPlace"></p><button id="mnAudioPlaceSignIn" type="button" hidden>Sign in</button></div>'+
      '<div id="mnAudioRooms"></div>'+
      '<details id="mnAudioStart" hidden><summary>Start a conversation</summary>'+
      '<form id="mnAudioForm"><label>Title <input id="mnAudioTitle" maxlength="120" required></label>'+
      '<label>Category <select id="mnAudioCategory" required></select></label>'+
      '<label>Where <select id="mnAudioWhere"></select></label>'+
      '<label class="mn-audio-check"><input id="mnAudioVisitors" type="checkbox" checked> Let people there listen before they sign in</label>'+
      '<button type="submit">Go live</button></form></details>'+
      '<p id="mnAudioNote" role="status"></p>';
    anchor.parentNode.insertBefore(panel,anchor);
    var dlg=d.createElement('dialog');dlg.id='mnAudioDialog';dlg.className='mn-audio-dialog';
    dlg.setAttribute('aria-labelledby','mnAudioName');
    dlg.innerHTML='<header><div><small id="mnAudioWhereNow">Audio only · No recording</small><h2 id="mnAudioName"></h2></div>'+
      '<button id="mnAudioClose" type="button" aria-label="Leave audio room">×</button></header>'+
      '<p id="mnAudioRoomNote" role="status"></p>'+
      '<div class="mn-audio-actions"><button id="mnAudioSpeak" type="button" hidden>Speak</button>'+
      '<button id="mnAudioHand" type="button" hidden aria-pressed="false">Raise hand</button>'+
      '<button id="mnAudioListen" type="button" hidden>Play audio</button>'+
      '<button id="mnAudioSignIn" type="button" hidden>Sign in to talk</button>'+
      '<button id="mnAudioEnd" type="button" hidden>End room</button>'+
      '<button id="mnAudioLeave" type="button">Leave quietly</button></div>'+
      '<h3>On stage</h3><div id="mnAudioStage" class="mn-audio-stage"></div>'+
      '<p id="mnAudioCount" class="mn-audio-count"></p>'+
      '<section id="mnAudioHandsWrap" hidden><h3>Raised hands</h3><div id="mnAudioHands"></div></section>'+
      '<div id="mnAudioPlayers" hidden></div>';
    d.body.appendChild(dlg);
    $('mnAudioReload').onclick=rooms;$('mnAudioLeave').onclick=leave;$('mnAudioClose').onclick=leave;
    dlg.addEventListener('cancel',function(e){e.preventDefault();void leave();});
    $('mnAudioSpeak').onclick=speak;$('mnAudioEnd').onclick=endRoom;$('mnAudioHand').onclick=hand;
    $('mnAudioSignIn').onclick=function(){void leave().then(askSignIn);};
    $('mnAudioPlaceSignIn').onclick=askSignIn;
    $('mnAudioListen').onclick=function(){receives.forEach(function(r){if(r.audio)void r.audio.play().catch(function(){});});
      $('mnAudioListen').hidden=true;};
    $('mnAudioForm').onsubmit=function(e){e.preventDefault();void create();};
    // A signed-out visitor starts where their connection is.
    if(!signedIn()&&visitorCountry())place={code:visitorCountry(),name:placeName(visitorCountry())};
    rooms();eligible();
  }
  // The globe says which country is in view; the room list follows it.
  w.addEventListener('message',function(ev){
    var m=ev.data||{};
    if(ev.origin!==location.origin||m.type!=='hu:country'||!$('mnAudioDoor'))return;
    var code=m.country&&/^[A-Z]{2}$/.test(String(m.country.code||'').toUpperCase())?String(m.country.code).toUpperCase():null;
    var next=code?{code:code,name:typeof m.country.name==='string'?m.country.name.slice(0,80):placeName(code)}
      :(!signedIn()&&visitorCountry()?{code:visitorCountry(),name:placeName(visitorCountry())}:null);
    if((next&&next.code)===(place&&place.code))return;
    place=next;paintWhere();rooms();
  });
  function paintPlace(count){
    var line=$('mnAudioPlace'),door=$('mnAudioPlaceSignIn'),home=visitorCountry(),where=place?placeName(place.code):'the world';
    var live=count?count+(count===1?' conversation':' conversations')+' live in '+where+'.':'No one is talking live in '+where+' right now.';
    if(signedIn()){line.textContent=live;door.hidden=true;return;}
    if(!home){line.textContent=live+' Sign in to join a conversation.';door.hidden=false;return;}
    line.textContent=live+(place&&place.code!==home?' You can listen in '+placeName(home)+'; sign in to join conversations here.'
      :' Sign in to join conversations in other regions.');
    door.hidden=false;
  }
  async function eligible(){
    if(!signedIn())return;
    try{var grant=await M.api('/v1/mnet/live/eligibility');
      if(!grant||!grant.can_host || !Array.isArray(grant.allowed_categories))return;
      var select=$('mnAudioCategory');
      grant.allowed_categories.filter(function(s){return /^[a-z0-9_-]{1,64}$/.test(s);}).forEach(function(key){
        select.appendChild(new Option(key.replace(/[_-]+/g,' '),key));
      });$('mnAudioStart').hidden=!select.options.length;paintWhere();
    }catch(_){}
  }
  function paintWhere(){
    var select=$('mnAudioWhere');if(!select)return;
    var home=status&&status.visitors&&status.visitors.country,seen={},keep=select.value;
    select.replaceChildren();
    [place&&place.code,home].forEach(function(code){
      if(code&&!seen[code]){seen[code]=1;select.appendChild(new Option(placeName(code),code));}
    });
    select.appendChild(new Option('Everywhere (members only)',''));
    if(keep!==''&&seen[keep])select.value=keep;
  }
  async function rooms(){
    try{
      var data=await open('/rooms'+(place&&place.code?'?country='+encodeURIComponent(place.code):'')),list=$('mnAudioRooms');
      var all=(data&&data.rooms||[]).filter(function(r){return r&&r.id&&r.title;});
      list.replaceChildren();paintPlace(all.length);
      all.forEach(function(r){
        var ok=canEnter(r),b=btn('',function(){if(ok)void join(r);else askSignIn();},'mn-audio-card');
        b.append(el('span','mn-audio-card__where','Live · '+placeName(r.country_code)),el('strong','',r.title),
          el('span','mn-audio-card__who',(r.host&&r.host.display_name||'Host')+' · '+r.speakers+' speaking · '+r.listeners+' listening'),
          el('span','mn-audio-card__go',ok?(signedIn()?'Join':'Listen'):'Sign in to join'));
        list.appendChild(b);
      });note('');
    }catch(e){note(e.message||'Room directory unavailable');}
  }
  async function create(){
    try{var where=$('mnAudioWhere').value||null;
      var data=await M.api(ROOT+'/rooms',{method:'POST',body:{title:$('mnAudioTitle').value.trim(),
        category_key:$('mnAudioCategory').value,country_code:where,visitors_may_listen:$('mnAudioVisitors').checked}});
      if(!data||!data.room)throw Error('Create failed');
      $('mnAudioTitle').value='';
      await join(data.room);
    }catch(e){note(e.message||'Unable to start the conversation');}
  }
  async function join(r){
    if(current)await leave();
    try{
      if(signedIn()){pass=null;await M.api(ROOT+'/rooms/'+r.id+'/join',{method:'POST',body:{}});}
      else{var seat=await open('/rooms/'+r.id+'/listen',{});pass=seat&&seat.pass||null;if(!pass)throw Error('Could not join room');}
      current=r;you=null;$('mnAudioName').textContent=r.title||'Room';
      $('mnAudioWhereNow').textContent='Live · '+placeName(r.country_code)+' · Audio only · No recording';
      $('mnAudioDialog').showModal();await refresh();
      poll=setInterval(tick,12000);
    }catch(e){pass=null;note(e.message||'Could not join room');if(wantsSignIn(e))$('mnAudioPlaceSignIn').hidden=false;}
  }
  function tick(){
    if(!current)return;
    // In the background, only check in, so the seat stays counted while the audio plays.
    if(d.hidden){if(Date.now()-beat>40000){beat=Date.now();void call(at('/self')).catch(function(){});}return;}
    void refresh();
  }
  function paintPerson(p,controls){
    var line=el('div','mn-audio-person');line.appendChild(face(p));
    var who=el('span','mn-audio-person__name',p.you?'You':p.display_name);
    if(p.role)who.appendChild(el('small','',(p.role==='host'?'Host':'Speaker')+(p.muted?' · muted':'')));
    line.appendChild(who);
    if(controls&&controls.length){var acts=el('div','mn-audio-person__acts');controls.forEach(function(c){acts.appendChild(c);});line.appendChild(acts);}
    return line;
  }
  async function hostAct(path,body,failed){
    try{await call(at(path),body);await refresh();}catch(e){roomNote(e.message||failed);}
  }
  function paint(s){
    var was=you;you=s.you||{};
    var speaker=you.role==='host'||you.role==='speaker';
    $('mnAudioSpeak').hidden=!speaker;$('mnAudioSpeak').textContent=mic?'Mute microphone':'Speak';
    $('mnAudioHand').hidden=you.visitor||you.role!=='listener';
    $('mnAudioHand').textContent=you.hand_raised?'Lower hand':'Raise hand';
    $('mnAudioHand').setAttribute('aria-pressed',you.hand_raised?'true':'false');
    $('mnAudioSignIn').hidden=!you.visitor;
    $('mnAudioEnd').hidden=!you.host;
    if(was&&was.role==='listener'&&you.role==='speaker')roomNote('The host invited you to speak. Tap Speak when you are ready.');
    if(!speaker&&mic)stopMic();
    var stage=$('mnAudioStage');stage.replaceChildren();
    (s.stage||[]).forEach(function(p){
      var c=[];
      if(you.host&&!p.you)c.push(
        btn('Move to audience',function(){void hostAct('/speaker',{target:p.participant_id,allow:false},'Speaker change failed');}),
        btn('Remove',function(){if(w.confirm('Remove '+p.display_name+' from this room?'))void hostAct('/kick',{target:p.participant_id},'Removal failed');}));
      stage.appendChild(paintPerson(p,c));
    });
    var n=Number(s.listeners)||0;
    $('mnAudioCount').textContent=n===1?'1 person listening':n+' people listening';
    var hands=s.hands||[],box=$('mnAudioHands');$('mnAudioHandsWrap').hidden=!(you.host&&hands.length);box.replaceChildren();
    hands.forEach(function(p){
      box.appendChild(paintPerson(p,[
        btn('Invite to speak',function(){void hostAct('/speaker',{target:p.participant_id,allow:true},'Invitation failed');}),
        btn('Remove',function(){if(w.confirm('Remove '+p.display_name+' from this room?'))void hostAct('/kick',{target:p.participant_id},'Removal failed');})]));
    });
  }
  async function refresh(){
    if(!current||refreshing)return;
    refreshing=true;var room=current;
    try{
      var out=await Promise.all([call(at('/stage')),call(at('/publications'))]);
      if(current!==room)return;
      beat=Date.now();paint(out[0]||{});
      var active=new Set();
      (out[1]&&out[1].publications||[]).forEach(function(p){
        if(!p||p.participant_id===you.participant_id)return;
        active.add(p.participant_id);
        if(!receives.has(p.participant_id))void receive(p.participant_id,room);
      });
      receives.forEach(function(v,k){if(!active.has(k)){v.pc.close();if(v.audio)v.audio.remove();receives.delete(k);}});
      if(!$('mnAudioRoomNote').textContent||/^(Listening|Microphone live)/.test($('mnAudioRoomNote').textContent))
        roomNote(mic?'Microphone live. Tap Mute to stop sharing.':'Listening. Your microphone is off.');
    }catch(e){
      if(current!==room)return;
      if(e.status===401||e.status===403||e.status===404){
        // The seat is gone: removed, the room ended, or a visitor pass ran out.
        localClose();note(e.message||'You left the room.');if(wantsSignIn(e))$('mnAudioPlaceSignIn').hidden=false;void rooms();
      }else roomNote('Connection status unavailable: '+(e.message||''));
    }
    finally{refreshing=false;}
  }
  async function receive(publisher,room){
    if(!current||receives.has(publisher))return;
    var pc=makePc(),item={pc:pc,audio:null};receives.set(publisher,item);
    try{
      var audio=d.createElement('audio');audio.autoplay=true;audio.playsInline=true;
      pc.ontrack=function(ev){audio.srcObject=new MediaStream([ev.track]);audio.play().catch(function(){
        if($('mnAudioListen'))$('mnAudioListen').hidden=false;
      });};
      var created=await call('/rooms/'+room.id+'/subscribe',{publisher:publisher});
      if(current!==room)throw Error('Room changed');
      await pc.setRemoteDescription(created.sessionDescription);
      await pc.setLocalDescription(await pc.createAnswer());await ice(pc);
      await call('/rooms/'+room.id+'/answer',{subscription_id:created.subscription_id,
        answer:{type:'answer',sdp:pc.localDescription.sdp}});
      item.audio=audio;$('mnAudioPlayers').appendChild(audio);
    }catch(e){pc.close();receives.delete(publisher);if(current===room)roomNote(e.message||'Audio playback unavailable');}
  }
  function stopMic(){
    if(mic)mic.getTracks().forEach(function(t){t.stop();});mic=null;
    if(sendPc)sendPc.close();sendPc=null;
    if($('mnAudioSpeak'))$('mnAudioSpeak').textContent='Speak';
  }
  async function speak(){
    if(!current||!you||!(you.role==='host'||you.role==='speaker'))return;
    if(mic){
      stopMic();
      try{await call(at('/mic'),{unmute:false});roomNote('Microphone off');}
      catch(e){roomNote('Local mic off; server disconnect needs a retry: '+(e.message||''));}
      return;
    }
    var stream=null,pc=null;
    try{
      // Only camera/microphone access in this file; invoked from a button.
      stream=await navigator.mediaDevices.getUserMedia({audio:{
        echoCancellation:true,noiseSuppression:true},video:false});
      pc=makePc();var sender=pc.addTransceiver(stream.getAudioTracks()[0],{direction:'sendonly'});
      await pc.setLocalDescription(await pc.createOffer());await ice(pc);
      await call(at('/mic'),{unmute:true});
      var result=await call(at('/publish'),{offer:{type:'offer',sdp:pc.localDescription.sdp},mid:sender.mid||'0'});
      await pc.setRemoteDescription(result.sessionDescription);
      if(!current)throw Error('Room was closed');
      mic=stream;sendPc=pc;$('mnAudioSpeak').textContent='Mute microphone';
      roomNote('Your microphone is now live.');
    }catch(e){
      if(stream)stream.getTracks().forEach(function(t){t.stop();});if(pc)pc.close();
      if(current)await call(at('/mic'),{unmute:false}).catch(function(){});
      roomNote('Microphone not enabled: '+(e.message||''));}
  }
  async function hand(){
    if(!current||!you||you.visitor||you.role!=='listener')return;
    var raise=!you.hand_raised;
    try{await call(at('/hand'),{raise:raise});you.hand_raised=raise;
      $('mnAudioHand').textContent=raise?'Lower hand':'Raise hand';$('mnAudioHand').setAttribute('aria-pressed',raise?'true':'false');
      roomNote(raise?'Hand raised. The host can invite you to speak.':'Hand lowered.');
    }catch(e){roomNote(e.message||'Could not raise your hand');}
  }
  function localClose(){
    if(poll)clearInterval(poll);poll=null;stopMic();
    receives.forEach(function(r){r.pc.close();if(r.audio)r.audio.remove();});receives.clear();
    current=null;you=null;var dialog=$('mnAudioDialog');if(dialog&&dialog.open)dialog.close();
    roomNote('');if($('mnAudioListen'))$('mnAudioListen').hidden=true;
  }
  async function leave(){
    var room=current,mine=pass;localClose();pass=null;
    if(!room)return;
    try{if(mine)await open('/rooms/'+room.id+'/leave',{},mine);else await M.api(ROOT+'/rooms/'+room.id+'/leave',{method:'POST',body:{}});}
    catch(e){note('Stopped on this device; server cleanup unconfirmed. '+(e.message||''));}
    void rooms();
  }
  async function endRoom(){
    if(!current||!you||!you.host)return;
    if(!w.confirm('End this conversation for everyone?'))return;
    var room=current;localClose();pass=null;
    try{var result=await M.api(ROOT+'/rooms/'+room.id+'/end',{method:'POST',body:{}});
      note(result&&result.cleanup_pending?'Room ended; server media cleanup requires attention.':'Conversation ended.');
      await rooms();
    }catch(e){note('Could not end room: '+(e.message||''));}
  }
  w.addEventListener('pagehide',function(){
    var room=current,mine=pass;localClose();pass=null;
    if(!room)return;
    if(mine)void fetch(BASE+'/rooms/'+room.id+'/leave',{method:'POST',keepalive:true,credentials:'omit',
      headers:{authorization:'Bearer '+mine,'content-type':'application/json'},body:'{}'}).catch(function(){});
    else void M.api(ROOT+'/rooms/'+room.id+'/leave',{method:'POST',body:{}}).catch(function(){});
  });
  function boot(){open('/status').then(function(r){if(r&&r.enabled===true){status=r;mount();}}).catch(function(){});}
  if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window,document);
