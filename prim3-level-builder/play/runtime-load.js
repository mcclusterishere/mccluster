(function(){
  'use strict';
  const embedded=document.getElementById('prim3-embedded-level');
  if(!embedded&&new URLSearchParams(location.search).get('customLevel')!=='1')return;
  try{
    const text=embedded?embedded.textContent:sessionStorage.getItem('prim3.builder.test.v1');
    if(!text||text.length>600000)throw new Error('The test level is missing. Open Level Forge and choose Test level again.');
    const doc=JSON.parse(text),check=window.P3LevelModel.validate(doc,{playable:true});
    if(!check.ok)throw new Error(check.errors.join(' '));
    window.P3Level=window.P3LevelModel.compile(doc);window.P3CustomLevelDoc=doc;
    document.body.classList.add('white-industrial');
  }catch(error){window.P3CustomLevelError=error.message||'Unable to load this level.';}
})();
