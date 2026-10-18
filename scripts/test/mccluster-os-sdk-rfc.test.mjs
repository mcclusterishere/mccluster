import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, ROOT), 'utf8');
const json = async (path) => JSON.parse(await read(path));

/*
 * Small dependency-free design-time smoke validator for RFC-001 fixtures.
 * This checks the supported subset of JSON Schema used by these examples.
 * It is NOT a replacement for an official JSON Schema 2020-12 validator
 * when implementing the production SDK or publishing a client package.
 */
function validate(value, schema, definitions, at = 'root') {
  if (Array.isArray(schema.allOf)) {
    for (const item of schema.allOf) validate(value, item, definitions, at + '.allOf');
  }
  if (schema.if) {
    let matched = true;
    try { validate(value, schema.if, definitions, at + '.if'); }
    catch { matched = false; }
    if (matched && schema.then) validate(value, schema.then, definitions, at + '.then');
    else if (!matched && schema.else) validate(value, schema.else, definitions, at + '.else');
  }
  if (schema.$ref) {
    assert.match(schema.$ref, /^#\/\$defs\/[A-Za-z]+$/);
    const key = schema.$ref.split('/').at(-1);
    assert.ok(definitions[key], 'Unknown definition: ' + key);
    return validate(value, definitions[key], definitions, at);
  }

  if (Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.filter((s) => {
      try { validate(value, s, definitions, at); return true; }
      catch { return false; }
    });
    assert.equal(matched.length, 1, at + ' must match exactly one envelope type');
  }

  if (Object.hasOwn(schema, 'const')) {
    assert.deepEqual(value, schema.const, at + ' violates const');
  }
  if (schema.enum) assert.ok(schema.enum.includes(value), at + ' violates enum');

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = value === null ? 'null'
      : Array.isArray(value) ? 'array'
      : Number.isInteger(value) ? 'integer'
      : typeof value;
    assert.ok(types.includes(actual) || (actual === 'integer' && types.includes('number')),
      at + ' has wrong type: ' + actual);
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined) assert.ok(value.length >= schema.minLength, at + ' below minLength');
    if (schema.maxLength !== undefined) assert.ok(value.length <= schema.maxLength, at + ' above maxLength');
    if (schema.pattern) assert.match(value, new RegExp(schema.pattern), at + ' violates pattern');
    if (schema.format === 'date-time') {
      assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
      assert.ok(Number.isFinite(Date.parse(value)), at + ' invalid ISO date-time');
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined) assert.ok(value >= schema.minimum, at + ' below minimum');
    if (schema.maximum !== undefined) assert.ok(value <= schema.maximum, at + ' above maximum');
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined) assert.ok(value.length >= schema.minItems, at + ' below minItems');
    if (schema.maxItems !== undefined) assert.ok(value.length <= schema.maxItems, at + ' above maxItems');
    if (schema.items) value.forEach((v, i) => validate(v, schema.items, definitions, at + '[' + i + ']'));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const field of schema.required || []) {
      assert.ok(Object.hasOwn(value, field), at + ' missing ' + field);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        assert.ok(Object.hasOwn(schema.properties || {}, key), at + ' unexpected ' + key);
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) validate(value[key], propertySchema, definitions, at + '.' + key);
    }
  }
}

test('SDK RFC owns no new scheduler, and describes review-only authority', async () => {
  const doc = await read('docs/control-plane/MCCLUSTER-OS-SDK-METACOGNITION-RFC-001.md');
  const canonical = await read('docs/control-plane/CANONICAL-ARCHITECTURE.md');
  const evalDoc = await read('docs/control-plane/sdk/evaluation-protocol-v1.md');
  assert.match(doc, /Status:\*\* PROPOSED/);
  assert.match(doc, /@mccluster\/task-queue/);
  assert.match(doc, /ops_agent_jobs/);
  assert.match(doc, /ops_objectives/);
  assert.match(doc, /ai_context/);
  assert.match(doc, /not a claim that its new SDK/);
  assert.match(doc, /OVH runtime recovery is an independent/);
  assert.match(canonical, /Products are workloads\. McCluster is the platform\./);
  assert.match(evalDoc, /no production agent is declared self-improving/i);
});

test('all synthetic RFC SDK envelopes match proposed schema subset', async () => {
  const schema = await json('docs/control-plane/sdk/contract-v1.schema.json');
  const fixtures = await json('docs/control-plane/sdk/contract-examples-v1.json');
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.$id, 'urn:mccluster:sdk:contract:v1');
  assert.equal(fixtures.status, 'synthetic_proposed_contract_examples');
  assert.equal(fixtures.examples.length, 5);
  for (const fixture of fixtures.examples) {
    validate(fixture.payload, schema, schema.$defs, fixture.name);
  }
});

test('request schema never grants tenant, role or privileges', async () => {
  const schema = await json('docs/control-plane/sdk/contract-v1.schema.json');
  const props = schema.$defs.CapabilityRequest.properties;
  for (const forbidden of ['tenant_id', 'org_id', 'role', 'isAdmin', 'is_owner', 'service_role', 'approved']) {
    assert.ok(!Object.hasOwn(props, forbidden), 'caller may not assert ' + forbidden);
  }
  assert.equal(schema.$defs.CapabilityRequest.additionalProperties, false);
  assert.equal(schema.$defs.ReflectionProposal.properties.proposal_only.const, true);
  assert.equal(schema.$defs.ExecutionReceipt.properties.deployment_sha.pattern, '^[a-f0-9]{40}$');
});

test('example active capability is rooted in canonical Core catalog', async () => {
  const catalog = await json('core/capabilities/catalog.json');
  const fixtures = await json('docs/control-plane/sdk/contract-examples-v1.json');
  const request = fixtures.examples.find((e) => e.payload.kind === 'capability.request').payload;
  const cap = catalog.capabilities.find((x) => x.id === request.capability);
  assert.ok(cap, 'sample capability must be defined by canonical catalog');
  assert.equal(cap.lifecycle, 'active');
});

test('unavailable approvals never masquerade as verified empty', async () => {
  const fixtures = await json('docs/control-plane/sdk/contract-examples-v1.json');
  const reflection = fixtures.examples.find((e) => e.payload.kind === 'reflection.proposal').payload;
  const failure = fixtures.examples.find((e) => e.payload.kind === 'error.response').payload;
  assert.equal(reflection.decision, 'abstain');
  assert.equal(reflection.source_status, 'unavailable');
  assert.equal(reflection.proposal_only, true);
  assert.equal(failure.code, 'SOURCE_UNAVAILABLE');
  assert.equal(failure.source_status, 'unavailable');
});

test('nonterminal execution receipts require a durable non-null job identifier', async()=>{
 const schema=await json('docs/control-plane/sdk/contract-v1.schema.json');
 const good=(await json('docs/control-plane/sdk/contract-examples-v1.json')).examples.find(x=>x.payload.kind==='execution.receipt').payload;
 for(const state of ['queued','running','awaiting_approval']){
   const broken={...good,state,job_id:null};
   assert.throws(()=>validate(broken,schema,schema.$defs),'queued receipt with no id must fail');
   delete broken.job_id;
   assert.throws(()=>validate(broken,schema,schema.$defs),'missing durable ID must fail');
   validate({...good,state,job_id:'synthetic-queued-job'},schema,schema.$defs);
 }
});
test('evaluations cannot report pass after a critical violation or omit required metrics',async()=>{
 const schema=await json('docs/control-plane/sdk/contract-v1.schema.json');
 const good=(await json('docs/control-plane/sdk/contract-examples-v1.json')).examples.find(x=>x.payload.kind==='evaluation.result').payload;
 assert.throws(()=>validate({...good,verdict:'pass',critical_violations:1,sample_count:50},schema,schema.$defs));
 assert.throws(()=>validate({...good,verdict:'inconclusive',critical_violations:1},schema,schema.$defs));
 const missing={...good};delete missing.metrics;
 assert.throws(()=>validate(missing,schema,schema.$defs));
 assert.throws(()=>validate({...good,verdict:'pass',critical_violations:0},schema,schema.$defs),'unrun test cannot claim pass');
 validate(good,schema,schema.$defs);
});
