/* Gated browser client for audio-only rooms. No recording, transcription,
   background media, or microphone request on load/listen/join.
   The user's explicit "Speak" gesture is the ONLY getUserMedia call. */
(function(w,d){
  'use strict';
  var M=w.MCC_MNET, ROOT='/v1/mnet/audio', current=null, self=null, mic=null, sendPc=null,
      receives=new Map(), poll=null, refreshing=false;
  if(!M || typeof M.api!=='function')return;
  function $(id){return d.getElementById(id);}
  function api(path,body){return M.api(ROOT+path,body===undefined?undefined:{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}
  function at(path){return '/rooms/'+current.id+path;}
  function note(s){if($('mnAudioNote'))$('mnAudioNote').textContent=s||'';}
  function roomNote(s){if($('mnAudioRoomNote'))$('mnAudioRoomNote').textContent=s||'';}
  function btn(txt,fn){var b=d.createElement('button');b.type='button';b.textContent=txt;b.onclick=fn;return b;}
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
    panel.innerHTML='<header><div><small>Audio only · Nothing is recorded</small><h2>Conversations</h2>'+
      '<p>Listen live or request a microphone. The mic stays off until you tap Speak.</p></div>'+
      '<button id="mnAudioReload" type="button">Refresh</button></header>'+
      '<div id="mnAudioRooms"></div>'+
      '<details id="mnAudioStart" hidden><summary>Start an audio room</summary>'+
      '<form id="mnAudioForm"><label>Title <input id="mnAudioTitle" maxlength="120" required></label>'+
      '<label>Category <select id="mnAudioCategory" required></select></label>'+
      '<label>Country (optional, chosen by you) <input id="mnAudioCountry" maxlength="2" pattern="[A-Z]{2}" placeholder="US"></label>'+
      '<button type="submit">Create audio room</button></form></details>'+
      '<p id="mnAudioNote" role="status"></p>';
    anchor.parentNode.insertBefore(panel,anchor);
    var dlg=d.createElement('dialog');dlg.id='mnAudioDialog';dlg.className='mn-audio-dialog';
    dlg.setAttribute('aria-label','Audio room');
    dlg.innerHTML='<header><div><small>Audio only · No recording</small><h2 id="mnAudioName"></h2></div>'+
      '<button id="mnAudioClose" type="button" aria-label="Leave audio room">×</button></header>'+
      '<p id="mnAudioRoomNote" role="status"></p>'+
      '<div class="mn-audio-actions"><button id="mnAudioSpeak" type="button" hidden>Speak</button>'+
      '<button id="mnAudioListen" type="button" hidden>Play audio</button>'+
      '<button id="mnAudioEnd" type="button" hidden>End room</button>'+
      '<button id="mnAudioLeave" type="button">Leave room</button></div>'+
      '<h3>People</h3><div id="mnAudioPeople"></div><h3>Live audio</h3><div id="mnAudioPlayers"></div>';
    d.body.appendChild(dlg);
    $('mnAudioReload').onclick=rooms;$('mnAudioLeave').onclick=leave;$('mnAudioClose').onclick=leave;
    $('mnAudioSpeak').onclick=speak;$('mnAudioEnd').onclick=endRoom;
    $('mnAudioListen').onclick=function(){receives.forEach(function(r){if(r.audio)void r.audio.play().catch(function(){});});};
    $('mnAudioForm').onsubmit=function(e){e.preventDefault();void create();};
    rooms();eligible();
  }
  async function eligible(){
    try{var grant=await M.api('/v1/mnet/live/eligibility');
      if(!grant?.can_host || !Array.isArray(grant.allowed_categories))return;
      var select=$('mnAudioCategory');
      grant.allowed_categories.filter(function(s){return /^[a-z0-9_-]{1,64}$/.test(s);}).forEach(function(key){
        var opt=d.createElement('option');opt.value=key;opt.textContent=key;select.appendChild(opt);
      });$('mnAudioStart').hidden=!select.options.length;
    }catch(_){}
  }
  async function rooms(){
    try{var data=await api('/rooms'),list=$('mnAudioRooms');list.replaceChildren();
      if(!data?.rooms?.length){list.textContent='No conversation is on air right now.';return;}
      data.rooms.forEach(function(r){if(!r?.id||!r?.title)return;
        var b=btn(r.title+' · '+(r.country_code||'Global')+' · Listen',function(){void join(r);});
        b.className='mn-audio-card';list.appendChild(b);
      });note('');
    }catch(e){note(e.message||'Room directory unavailable');}
  }
  async function create(){
    try{var country_code=$('mnAudioCountry').value.trim().toUpperCase()||null;
      var data=await api('/rooms',{title:$('mnAudioTitle').value.trim(),
        category_key:$('mnAudioCategory').value,country_code:country_code});
      if(!data?.room)throw Error('Create failed');
      await join(data.room);
    }catch(e){note(e.message||'Unable to create room');}
  }
  async function join(r){
    if(current)await leave();
    try{await api('/rooms/'+r.id+'/join',{});
      current=r;self=null;$('mnAudioName').textContent=r.title||'Room';
      $('mnAudioDialog').showModal();await refresh();
      poll=setInterval(function(){if(!d.hidden)void refresh();},12000);
    }catch(e){roomNote(e.message||'Could not join room');note('Sign in to listen or host.');}
  }
  async function refresh(){
    if(!current||refreshing)return;
    refreshing=true;var room=current;
    try{
      var out=await Promise.all([api(at('/self')),api(at('/members')),api(at('/publications'))]);
      if(current!==room)return;
      self=out[0];var members=out[1].members||[],publications=out[2].publications||[];
      $('mnAudioSpeak').hidden=!['host','speaker'].includes(self.role);
      $('mnAudioSpeak').textContent=mic?'Mute microphone':'Speak';
      $('mnAudioEnd').hidden=!self.host;
      var host=$('mnAudioPeople');host.replaceChildren();
      members.forEach(function(p){
        var line=d.createElement('div');line.className='mn-audio-person';
        var name=d.createElement('span');name.textContent=(p.id===self.id?'You':p.id.slice(0,8))+
          ' · '+p.role+(p.muted?' · muted':'');
        line.appendChild(name);
        if(self.host&&p.id!==self.id){
          line.appendChild(btn(p.role==='speaker'?'Move to audience':'Invite to speak',async function(){
            try{await api(at('/speaker'),{target_m_uid:p.id,allow:p.role!=='speaker'});await refresh();}
            catch(e){roomNote(e.message||'Speaker change failed');}
          }));
          line.appendChild(btn('Remove',async function(){
            if(!w.confirm('Remove this member from the audio room?'))return;
            try{await api(at('/kick'),{target_m_uid:p.id});await refresh();}
            catch(e){roomNote(e.message||'Removal failed');}
          }));
        }host.appendChild(line);
      });
      var active=new Set();
      publications.forEach(function(p){
        if(p.participant_id===self.id)return;
        active.add(p.participant_id);
        if(!receives.has(p.participant_id))void receive(p.participant_id,room);
      });
      receives.forEach(function(v,k){if(!active.has(k)){v.pc.close();if(v.audio)v.audio.remove();receives.delete(k);}});
      roomNote(mic?'Microphone live. Tap Mute to stop sharing.':'Listening only. Your microphone is off.');
    }catch(e){roomNote('Connection status unavailable: '+(e.message||''));}
    finally{refreshing=false;}
  }
  async function receive(publisher,room){
    if(!current||receives.has(publisher))return;
    var pc=makePc(),item={pc,audio:null};receives.set(publisher,item);
    try{
      var audio=d.createElement('audio');audio.controls=true;audio.autoplay=true;audio.playsInline=true;
      audio.setAttribute('aria-label','Incoming audio from '+publisher.slice(0,8));
      pc.ontrack=function(ev){audio.srcObject=new MediaStream([ev.track]);audio.play().catch(function(){
        if($('mnAudioListen'))$('mnAudioListen').hidden=false;
      });};
      var created=await api('/rooms/'+room.id+'/subscribe',{publisher_m_uid:publisher});
      if(current!==room)throw Error('Room changed');
      await pc.setRemoteDescription(created.sessionDescription);
      await pc.setLocalDescription(await pc.createAnswer());await ice(pc);
      await api('/rooms/'+room.id+'/answer',{subscription_id:created.subscription_id,
        answer:{type:'answer',sdp:pc.localDescription.sdp}});
      item.audio=audio;$('mnAudioPlayers').appendChild(audio);
    }catch(e){pc.close();receives.delete(publisher);roomNote(e.message||'Audio playback unavailable');}
  }
  async function speak(){
    if(!current||!self||!['host','speaker'].includes(self.role))return;
    if(mic){
      mic.getTracks().forEach(function(t){t.stop();});mic=null;
      if(sendPc)sendPc.close();sendPc=null;$('mnAudioSpeak').textContent='Speak';
      try{await api(at('/mic'),{unmute:false});roomNote('Microphone off');}
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
      await api(at('/mic'),{unmute:true});
      var result=await api(at('/publish'),{offer:{type:'offer',sdp:pc.localDescription.sdp},mid:sender.mid||'0'});
      await pc.setRemoteDescription(result.sessionDescription);
      if(!current)throw Error('Room was closed');
      mic=stream;sendPc=pc;$('mnAudioSpeak').textContent='Mute microphone';
      roomNote('Your microphone is now live.');
    }catch(e){
      if(stream)stream.getTracks().forEach(function(t){t.stop();});if(pc)pc.close();
      if(current)await api(at('/mic'),{unmute:false}).catch(function(){});
      roomNote('Microphone not enabled: '+(e.message||''));}
  }
  function localClose(){
    if(poll)clearInterval(poll);poll=null;
    if(mic)mic.getTracks().forEach(function(t){t.stop();});mic=null;
    if(sendPc)sendPc.close();sendPc=null;
    receives.forEach(function(r){r.pc.close();if(r.audio)r.audio.remove();});receives.clear();
    current=null;self=null;var dialog=$('mnAudioDialog');if(dialog?.open)dialog.close();
  }
  async function leave(){
    var room=current;localClose();
    if(room)try{await api('/rooms/'+room.id+'/leave',{});}
      catch(e){note('Stopped on this device; server cleanup unconfirmed. '+(e.message||''));}
  }
  async function endRoom(){
    if(!current||!self?.host)return;
    var room=current;localClose();
    try{var result=await api('/rooms/'+room.id+'/end',{});
      note(result.cleanup_pending?'Room ended; server media cleanup requires attention.':'Audio room ended.');
      await rooms();
    }catch(e){note('Could not end room: '+(e.message||''));}
  }
  w.addEventListener('pagehide',function(){
    var room=current;localClose();
    if(room)void api('/rooms/'+room.id+'/leave',{}).catch(function(){});
  });
  function boot(){api('/status').then(function(r){if(r?.enabled===true)mount();}).catch(function(){});}
  if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})(window,document);
