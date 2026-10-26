/* Move the existing composer, with its listeners and state, into a native dialog.
   There is still one composer and one canonical posting/delivery path. */
(function(w,d){'use strict';
 function init(){
  var composer=d.getElementById('mnComposer'),openButton=d.getElementById('mnComposeOpen');if(!composer||!openButton)return;
  var marker=d.createComment('World composer position'),dialog=d.createElement('dialog'),heading=d.createElement('h2'),close=d.createElement('button'),header=d.createElement('header');
  composer.before(marker);dialog.id='mnComposerDialog';dialog.className='mn-composer-dialog';dialog.setAttribute('aria-labelledby','mnComposerTitle');
  heading.id='mnComposerTitle';heading.textContent='Create a post';close.type='button';close.className='mn-composer-dialog__close';close.textContent='Close';
  header.className='mn-composer-dialog__head';header.append(heading,close);dialog.append(header);d.body.append(dialog);
  var focusReturn=null,historyKey=null,restoring=false;
  function finish(noFocus){if(!dialog.open)return;restoring=true;dialog.close();marker.after(composer);composer.classList.remove('is-open');d.body.classList.remove('mn-composer-open');var target=focusReturn;focusReturn=null;historyKey=null;if(!noFocus&&target&&target.isConnected)target.focus({preventScroll:true});w.dispatchEvent(new Event('mcc:composition-save'));queueMicrotask(function(){restoring=false;});}
  function requestClose(){if(!dialog.open)return;if(history.state?.mccComposer===historyKey)history.back();else finish();}
  function open(trigger){
   if(restoring||dialog.open||composer.hidden)return;
   focusReturn=trigger||d.activeElement;if(focusReturn===d.getElementById('mnPostBody'))focusReturn=openButton;historyKey=crypto.randomUUID();history.pushState(Object.assign({},history.state,{mccComposer:historyKey}),'',location.href);
   dialog.append(composer);composer.classList.add('is-open');d.body.classList.add('mn-composer-open');dialog.showModal();d.getElementById('mnPostBody').focus();
  }
  close.onclick=requestClose;openButton.onclick=function(){open(openButton);};dialog.addEventListener('cancel',function(e){e.preventDefault();requestClose();});
  w.addEventListener('popstate',function(){if(dialog.open&&history.state?.mccComposer!==historyKey)finish();});
  w.addEventListener('mcc:auth-changed',function(){if(history.state?.mccComposer===historyKey){var next=Object.assign({},history.state);delete next.mccComposer;history.replaceState(next,'',location.href);}finish(true);});
  w.MCC_WORLD_OVERLAY={open:open,close:requestClose,isOpen:function(){return dialog.open;}};
 }
 if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',init);else init();
})(window,document);
