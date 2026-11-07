import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalPortfolioUrl} from '../test-portfolio-postgres.mjs';
const good={PORTFOLIO_CANONICAL_ACK:'disposable-supabase-reset',NATIVE_TEST_DATABASE_URL:'postgresql://postgres:postgres@127.0.0.1:54322/postgres'};
test('portfolio native proof refuses unacknowledged, remote and noncanonical connections',()=>{
  assert.equal(canonicalPortfolioUrl(good).hostname,'127.0.0.1');
  assert.throws(()=>canonicalPortfolioUrl({...good,PORTFOLIO_CANONICAL_ACK:''}));
  for(const url of ['postgresql://postgres:secret@db.example.com:54322/postgres','postgresql://postgres:postgres@127.0.0.1:5432/postgres','postgresql://postgres:postgres@127.0.0.1:54322/real_data','postgresql://service_role:secret@127.0.0.1:54322/postgres','postgresql://postgres:postgres@127.0.0.1:54322/postgres?host=db.example.com'])assert.throws(()=>canonicalPortfolioUrl({...good,NATIVE_TEST_DATABASE_URL:url}));
});
