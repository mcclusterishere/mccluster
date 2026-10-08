import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendModels } from '../src/media/recommend.js';

function json(value,status=200){
  return new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
}

test('quality routing deterministically prefers the fresher verified premium model on a tie', async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url)=>{
    const href=String(url);
    assert.match(href,/media_models\?/);
    return json([
      {
        id:'old',provider:'fal',provider_model_id:'fal-ai/kling-video/v2.6/pro/text-to-video',
        capability:'text-to-video',enabled:true,commercial_use:true,health_state:'unknown',
        supports_reference_images:false,supports_first_last_frame:false,supports_native_audio:true,
        quality_profile:{tier:'premium',strength:'cinematic'},
        cost_hint:{verified_at:'2026-09-13'}
      },
      {
        id:'new',provider:'fal',provider_model_id:'fal-ai/kling-video/v3/pro/text-to-video',
        capability:'text-to-video',enabled:true,commercial_use:true,health_state:'unknown',
        supports_reference_images:false,supports_first_last_frame:false,supports_native_audio:true,
        quality_profile:{tier:'premium',strength:'cinematic + native audio'},
        cost_hint:{verified_at:'2026-09-27'}
      }
    ]);
  };
  try{
    const request=new Request('https://api.mccluster.org/v1/media/recommend',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({capability:'text-to-video',preference:'quality',required:{commercial_use:true},top_k:2})
    });
    const result=await recommendModels(request,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'secret'});
    assert.equal(result.candidates.length,2);
    assert.equal(result.candidates[0].model.id,'new');
    assert.equal(result.candidates[0].rationale.verified_at,'2026-09-27');
  }finally{
    globalThis.fetch=original;
  }
});

test('balanced routing still prefers high-tier models over premium when policy says balanced', async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>json([
    {
      id:'premium',provider:'fal',provider_model_id:'premium',capability:'text-to-video',
      commercial_use:true,health_state:'unknown',quality_profile:{tier:'premium'},cost_hint:{verified_at:'2026-09-27'}
    },
    {
      id:'high',provider:'fal',provider_model_id:'high',capability:'text-to-video',
      commercial_use:true,health_state:'unknown',quality_profile:{tier:'high'},cost_hint:{verified_at:'2026-09-27'}
    }
  ]);
  try{
    const request=new Request('https://api.mccluster.org/v1/media/recommend',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({capability:'text-to-video',preference:'balanced',required:{commercial_use:true},top_k:2})
    });
    const result=await recommendModels(request,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'secret'});
    assert.equal(result.candidates[0].model.id,'high');
    // Premium base (40) ties high + balanced bonus (32+8). The stable
    // deterministic tie-break then keeps the result reproducible.
    assert.equal(result.candidates[0].score,result.candidates[1].score);
  }finally{
    globalThis.fetch=original;
  }
});
