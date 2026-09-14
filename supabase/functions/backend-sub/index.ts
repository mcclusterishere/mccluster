// RETIRED: superseded by the canonical McCluster commerce/control plane.
// Keep an authenticated 410 tombstone until the deployed Edge Function can be
// deleted so the marketplace-era premium subscription mutation cannot return.

const headers = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
};

Deno.serve(() => new Response(JSON.stringify({
  error: 'retired_endpoint',
  replacement: 'https://api.mccluster.org',
}), { status: 410, headers }));
