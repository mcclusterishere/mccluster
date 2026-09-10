import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REGISTRIES, registryByKey, parseRepositoryIds, parseRepository,
  listRepositories, fetchRepository, coverageByProtocol
} from '../src/seek-first/registries.js';

// Shape captured from a real re3data detail record.
const detailXml = `<?xml version="1.0" encoding="utf-8"?>
<r3d:re3data xmlns:r3d="http://www.re3data.org/schema/2-2">
  <r3d:repository>
    <r3d:re3data.orgIdentifier>r3d100000001</r3d:re3data.orgIdentifier>
    <r3d:repositoryName language="eng">Odum Institute Archive Dataverse</r3d:repositoryName>
    <r3d:repositoryURL>https://dataverse.unc.edu/dataverse/odum</r3d:repositoryURL>
    <r3d:dataAccessRestriction>registration</r3d:dataAccessRestriction>
    <r3d:dataLicenseName>CC0</r3d:dataLicenseName>
    <r3d:api apiType="OAI-PMH">https://dataverse.unc.edu/oai?verb=Identify</r3d:api>
    <r3d:api apiType="REST">https://dataverse.unc.edu/api</r3d:api>
    <r3d:api apiType="other">ftp://example.invalid/not-http</r3d:api>
  </r3d:repository>
</r3d:re3data>`;

const listXml = `<list>
  <repository><id>r3d100000001</id><name>A &amp; B</name></repository>
  <repository><id>r3d100010842</id><name>Second</name></repository>
  <repository><id>not-an-id</id></repository>
</list>`;

test('the registry list yields only well-formed repository ids', () => {
  assert.deepEqual([...parseRepositoryIds(listXml)], ['r3d100000001', 'r3d100010842']);
});

test('a repository record surfaces every advertised API with its protocol', () => {
  const repo = parseRepository(detailXml);
  assert.equal(repo.id, 'r3d100000001');
  assert.equal(repo.name, 'Odum Institute Archive Dataverse');
  assert.equal(repo.url, 'https://dataverse.unc.edu/dataverse/odum');
  assert.equal(repo.apis.length, 2, 'the ftp entry is not an http endpoint and must be dropped');
  assert.deepEqual(repo.apis.map((a) => a.normalized).sort(), ['oai-pmh', 'rest']);
  assert.equal(repo.crawlable, true);
});

test('access restrictions and licences travel with the pointer', () => {
  const repo = parseRepository(detailXml);
  assert.deepEqual([...repo.dataAccessRestrictions], ['registration']);
  assert.deepEqual([...repo.dataLicenseNames], ['CC0']);
});

test('a repository advertising nothing usable is marked not crawlable rather than dropped', () => {
  const repo = parseRepository(`<r3d:repository>
    <r3d:repositoryName>Closed Archive</r3d:repositoryName>
    <r3d:api apiType="other">https://example.invalid/thing</r3d:api>
  </r3d:repository>`);
  assert.equal(repo.crawlable, false);
  assert.equal(repo.apis.length, 1, 'it is still recorded, so the coverage gap stays countable');
});

test('XML entities are decoded rather than carried through', () => {
  const repo = parseRepository('<r3d:repositoryName>Smith &amp; Jones &quot;Archive&quot;</r3d:repositoryName>');
  assert.equal(repo.name, 'Smith & Jones "Archive"');
});

test('coverage is countable by protocol', () => {
  const counts = coverageByProtocol([parseRepository(detailXml), parseRepository(detailXml)]);
  assert.equal(counts['oai-pmh'], 2);
  assert.equal(counts.rest, 2);
});

test('a malformed repository id is refused before any request is made', async () => {
  const reg = registryByKey('re3data');
  await assert.rejects(
    () => fetchRepository(reg, '../../etc/passwd', { fetchImpl: async () => { throw new Error('must not fetch'); } }),
    /invalid repository id/
  );
});

test('list and fetch work against injected transport', async () => {
  const reg = registryByKey('re3data');
  const ids = await listRepositories(reg, {
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => listXml })
  });
  assert.equal(ids.length, 2);

  const repo = await fetchRepository(reg, 'r3d100000001', {
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => detailXml })
  });
  assert.equal(repo.name, 'Odum Institute Archive Dataverse');
});

test('every registry declares a list and a detail endpoint over https', () => {
  assert.ok(REGISTRIES.length >= 1);
  for (const reg of REGISTRIES) {
    assert.ok(reg.listEndpoint.startsWith('https://'), reg.key);
    assert.ok(reg.detailEndpoint.startsWith('https://'), reg.key);
    assert.ok(reg.attribution, reg.key);
  }
});
