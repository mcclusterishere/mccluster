import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseErrorMetadata, readFailureDiagnostics, successfulReadDiagnostics} from '../src/analytics/read-diagnostics.js';

test('a PostgREST timeout includes actionable scoped metadata and no raw error', () => {
  const upstream = new Response(JSON.stringify({
    code: '57014', message: "SECRET: select * from auth.users; bearer = shhh",
    details: "sql and private email"
  }), {status:500,headers:{'x-request-id':'trace_ABC123'}});
  const meta = databaseErrorMetadata(upstream, {code:'57014',message:'SECRET'});
  const parsed = readFailureDiagnostics(Object.assign(new Error('private error'), {...meta, detail:{secret:'private body'}}),8111.5);
  assert.deepEqual(parsed,{status:'failed',reason:'timeout',error_code:'57014',upstream_http_status:500,
    request_id:'trace_ABC123',elapsed_ms:8112});
  assert.doesNotMatch(JSON.stringify(parsed),/SECRET|auth\.users|shhh|private|bearer/);
});

test('request ids and error codes must be explicitly syntactically safe', () => {
  const upstream = new Response('',{status:401,headers:{'cf-ray':'oops<secret>'}});
  const meta = databaseErrorMetadata(upstream,{code:'DROP TABLE users'});
  const parsed = readFailureDiagnostics({...meta},500000);
  assert.equal(parsed.error_code,null);
  assert.equal(parsed.request_id,null);
  assert.equal(parsed.upstream_http_status,401);
  assert.equal(parsed.reason,'authorization');
  assert.equal(parsed.elapsed_ms,120000);
});

test('missing source, transport failure and successful nullable read remain distinct', () => {
  assert.equal(readFailureDiagnostics({db_code:'PGRST205',upstream_status:404},10).reason,'missing_source');
  assert.equal(readFailureDiagnostics(Object.assign(new TypeError('fetch failed'),{detail:'credentials'}),23).reason,'unavailable');
  assert.deepEqual(successfulReadDiagnostics(10,true),{status:'not_applicable',elapsed_ms:10});
  assert.deepEqual(successfulReadDiagnostics(10),{status:'ready',elapsed_ms:10});
});
