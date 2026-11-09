/* E=Up companies section. Reached only through ./router.js after the house-owner
   check; see router.js for the contract. Not implemented yet: answers 503 with
   reason 'not_implemented' so the Control shell shows an honest no-data state. */
export async function handleCompanies(_request, _env, { fail }) {
  throw fail(503, 'E=Up companies is not implemented yet', 'not_implemented');
}
