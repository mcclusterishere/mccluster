/** Offline planning checks only. Never imports a checkout or writes inventory. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateClothingLaunch(plan) {
  const errors = [];
  if (!plan || typeof plan !== 'object') return ['plan must be an object'];
  if (plan.schemaVersion !== 1) errors.push('unsupported schemaVersion');
  if (plan.status !== 'draft' || plan.salesEnabled !== false) errors.push('sales must remain disabled in draft');
  if (plan.commerceAuthority !== 'canonical-offerings') errors.push('use canonical commerce');
  if (plan.purchaseVerified !== false || plan.receiptVerified !== false || plan.availableStock !== null) {
    errors.push('this unverified plan must not assert purchase, receipt or available stock');
  }
  if (!Array.isArray(plan.samples) || !plan.samples.length) errors.push('samples required');
  else {
    const ids = new Set();
    let total = 0;
    for (const sample of plan.samples) {
      if (!sample || typeof sample.id !== 'string' || !sample.id || ids.has(sample.id)) errors.push('unique sample id required');
      ids.add(sample?.id);
      if (!Number.isSafeInteger(sample?.plannedCostCents) || sample.plannedCostCents < 0) errors.push('sample costs must be nonnegative integer cents');
      else total += sample.plannedCostCents;
    }
    if (!Number.isSafeInteger(plan.budgetBeforeShippingCents) || total !== plan.budgetBeforeShippingCents) errors.push('sample costs must equal budget before shipping');
  }
  if (plan.shippingCents !== null) errors.push('shipping remains unknown');
  if (plan.hoodieAllocation?.status !== 'unresolved' || plan.hoodieAllocation?.includedInBudget !== null) errors.push('hoodie allocation must remain unresolved');
  const editions = plan.editions;
  if (!Array.isArray(editions) || editions.length !== 2 || new Set(editions.map(e => e?.id)).size !== 2 ||
      !editions.some(e => e?.id === 'standard') || !editions.some(e => e?.id === 'customer-name')) errors.push('standard and customer-name drafts required');
  else for (const edition of editions) {
    if (edition.priceCents !== null) errors.push('tentative multipliers are not approved prices');
    if (edition.brandPlacement !== 'bottom' || edition.customizationPlacement !== (edition.id === 'customer-name' ? 'above-brand' : null)) errors.push('retain brand below personalization');
  }
  if (plan.fulfillment?.mode !== 'manual-planning-only' || plan.fulfillment?.apiVerified !== false) errors.push('no automated fulfillment claim');
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2] || new URL('../docs/products/clothing-launch/draft.json', import.meta.url);
  const plan = JSON.parse(readFileSync(path, 'utf8'));
  const errors = validateClothingLaunch(plan);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`Draft valid: $${(plan.budgetBeforeShippingCents / 100).toFixed(2)} before shipping; stock unknown; sales disabled.`);
}
