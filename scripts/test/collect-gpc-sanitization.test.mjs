import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = await readFile(new URL('../../supabase/functions/collect/index.ts', import.meta.url), 'utf8');
const compiled = stripTypeScriptTypes(source, { mode: 'strip' });

async function collect({ headers = {}, body }) {
  let handler;
  const calls = [];
  const ctx = {
    Deno: { env: { get: name => name === 'SUPABASE_URL' ? 'https://local.test.supabase.co' : 'not-a-real-secret' },
      serve: fn => { handler = fn; } },
    Response, Request, Headers, TextEncoder, URL, console,
    fetch: async (url, init = {}) => {
      const href = String(url);
      calls.push({ href, method: init.method || 'GET', body: init.body });
      if (href.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: '123e4567-e89b-42d3-a456-426614174000' }), {status:200});
      if (href.endsWith('/rest/v1/events')) return new Response('', {status:201});
      throw new Error('Unexpected egress: ' + href);
    }
  };
  vm.runInNewContext(compiled, ctx, {filename:'collect.ts',timeout:2500});
  assert.equal(typeof handler, 'function');
  const request = new Request('https://api.mccluster.org/functions/v1/collect', {
    method:'POST',
    headers: { 'content-type':'application/json', authorization:'Bearer synthetic-valid-token',
      'user-agent':'synthetic-private-agent', 'cf-connecting-ip':'203.0.113.66', ...headers },
    body: JSON.stringify(body ?? {
      device_id:'persistent-device', session_id:'persistent-session',
      events:[{name:'page_view',path:'/profile/private?email=person@example.test',
        referrer:'https://example.test/?auth=token',
        props:{email:'person@example.test',lat:41.2,token:'dontstore',track:'music'}}]
    })
  });
  const response = await handler(request);
  return {response, calls, rows: calls.find(x=>x.href.endsWith('/rest/v1/events'))?.body
    ? JSON.parse(calls.find(x=>x.href.endsWith('/rest/v1/events')).body) : []};
}

for (const header of [{ 'sec-gpc': '1' }, { dnt:'1' }]) {
  test('privacy signal '+JSON.stringify(header)+' retains only anonymous aggregate event attributes', async () => {
    const {response,rows,calls} = await collect({headers:header});
    assert.equal(response.status,200);
    assert.equal(rows.length,1);
    assert.equal(rows[0].name,'page_view');
    for (const key of ['uid','ip','device_id','session_id','user_agent','referrer','latitude','longitude','city','postal']) {
      assert.equal(rows[0][key],null,key);
    }
    assert.equal(rows[0].path,'/');
    assert.deepEqual(JSON.parse(JSON.stringify(rows[0].props)),{});
    assert.equal(calls.filter(x=>x.href.endsWith('/auth/v1/user')).length,0,'no identity lookup under opt-out');
  });
}
test('without privacy signal the existing event contract is preserved', async () => {
  const {response,rows,calls} = await collect({});
  assert.equal(response.status,200);
  assert.equal(rows.length,1);
  assert.equal(rows[0].uid,'123e4567-e89b-42d3-a456-426614174000');
  assert.equal(rows[0].device_id,'persistent-device');
  assert.equal(rows[0].session_id,'persistent-session');
  assert.match(rows[0].path,/profile\/private/);
  assert.equal(rows[0].props.email,'person@example.test');
  assert.equal(calls.filter(x=>x.href.endsWith('/auth/v1/user')).length,1);
});
