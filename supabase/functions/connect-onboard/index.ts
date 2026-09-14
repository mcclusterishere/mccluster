// RETIRED: superseded by the canonical McCluster Worker Connect flow.
// Keep this function as an authenticated tombstone until the deployed Edge
// Function can be deleted, so old callers fail closed without preserving the
// marketplace-era Stripe mutation surface.

const headers = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

Deno.serve(() => new Response(JSON.stringify({
  error: 'retired_endpoint',
  replacement: 'https://api.mccluster.org',
}), { status: 410, headers }));
