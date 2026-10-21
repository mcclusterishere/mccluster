import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

test('Analytics partial-source label shows safe per-key diagnostics and does not render arbitrary response data',async()=>{
  const source=await readFile('js/control-room/analytics.js','utf8');
  const context={window:{CR:{}},console};
  vm.createContext(context);
  vm.runInContext(source,context);
  const A=context.window.CR.analytics;
  A.init({
    supa:path=>Promise.resolve(String(path).startsWith('analytics_sites?')?[]:[]),
    request:path=>Promise.resolve(String(path).startsWith('/v1/analytics/business?')?{
      snapshot:{partial:true,read_errors:{postsTotal:'Data read unavailable'},
        read_diagnostics:{postsTotal:{status:'failed',reason:'timeout',error_code:'57014',upstream_http_status:500,request_id:'req-test',elapsed_ms:8111,
          sql:'<script>WRONG</script>'}}},
    }:{}),
  });
  const host={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]};
  A.mount(host);
  const deadline=Date.now()+3000;
  while(!A.state.loaded&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(A.state.loaded,true);
  assert.match(A.top(),/Partial data/);
  assert.match(host.innerHTML,/data source needs attention/);
  assert.match(host.innerHTML,/postsTotal/);
  assert.match(host.innerHTML,/57014/);
  assert.match(host.innerHTML,/HTTP 500/);
  assert.match(host.innerHTML,/timeout/);
  assert.match(host.innerHTML,/8111ms/);
  assert.match(host.innerHTML,/request req-test/);
  assert.doesNotMatch(host.innerHTML,/WRONG/);
  assert.doesNotMatch(host.innerHTML,/<script>/);
});
