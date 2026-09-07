import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const sourcePath=resolve(here,'..','src','index.js');

async function source(){return readFile(sourcePath,'utf8')}

test('public health remains minimal',async()=>{
  const text=await source();
  const block=text.match(/if \(path === '\/health'[\s\S]*?\n\s*}\n/);
  assert.ok(block,'health route not found');
  assert.match(block[0],/ok:\s*true/);
  assert.match(block[0],/service:\s*'mccluster'/);
  assert.doesNotMatch(block[0],/supabase_project|durable_object|products|project_ref/i);
});

test('internal and status routes require house-owner authorization',async()=>{
  const text=await source();
  assert.match(text,/if \(path === '\/internal\/here-tenant-agent'[\s\S]*?await requireHouseOwner\(request, env\)/);
  assert.match(text,/if \(path === '\/v1\/status'[\s\S]*?await requireHouseOwner\(request, env\)/);
  assert.match(text,/role=eq\.owner/);
  assert.match(text,/slug=eq\.mccluster/);
});

test('public app registry exposes only explicit safe fields',async()=>{
  const text=await source();
  const apps=text.match(/if \(path === '\/v1\/apps'[\s\S]*?return reply\(request, env, \{ apps: rows \|\| \[\] \}\);/);
  assert.ok(apps,'apps route not found');
  assert.match(apps[0],/select=app_key,name,product_family,kind,bundle_id,public_url/);
  assert.doesNotMatch(apps[0],/oauth_client_id|settings/);
});
