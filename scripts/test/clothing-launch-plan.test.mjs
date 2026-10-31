import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateClothingLaunch } from '../validate-clothing-launch.mjs';
const draft = JSON.parse(readFileSync(new URL('../../docs/products/clothing-launch/draft.json', import.meta.url)));

test('launch budget reconciles without inventing stock or approved prices', () => {
  assert.deepEqual(validateClothingLaunch(draft), []);
  assert.equal(draft.samples.reduce((sum, row) => sum + row.plannedCostCents, 0), 51665);
});
for (const [name, change] of [
  ['sale activation', p => { p.salesEnabled = true; }],
  ['invented stock', p => { p.availableStock = 3; }],
  ['unverified purchase', p => { p.purchaseVerified = true; }],
  ['double-counted hoodie budget', p => { p.samples.push({ id: 'extra-hoodie', plannedCostCents: 3745 }); }],
  ['duplicate sample', p => { p.samples[1].id = p.samples[0].id; }],
  ['fractional cents', p => { p.samples[0].plannedCostCents += 0.1; }],
  ['invented shipping', p => { p.shippingCents = 0; }],
  ['invented allocation', p => { p.hoodieAllocation.includedInBudget = true; }],
  ['unapproved price', p => { p.editions[1].priceCents = 15000; }],
  ['removed brand', p => { p.editions[1].brandPlacement = null; }],
  ['assumed API', p => { p.fulfillment.apiVerified = true; }],
  ['parallel commerce', p => { p.commerceAuthority = 'new-store'; }],
  ['missing samples', p => { p.samples = null; }]
]) test(`rejects ${name}`, () => {
  const plan = structuredClone(draft); change(plan);
  assert.ok(validateClothingLaunch(plan).length);
});
test('invalid input fails closed', () => assert.ok(validateClothingLaunch(null).length));
