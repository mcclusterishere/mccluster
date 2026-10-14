# Equity Uprise — public globe entry and authentication boundary

## Routes
- `equity-uprise.html`: logged-out, view-only globe presentation. Only Music, M, and Log in appear in the header.
- `action-globe.html?embedded=1`: globe preview behind public entry. Public data only; no individual user locations.
- `mnet.html`: existing Action Network session/login entry. After authentication, the full network experience can be unlocked using existing authorization checks.
- `index.html`: existing McCluster corporate/artist homepage; deliberately unchanged.

## Production domain target
Desired public hostname: `equityuprise.com` (verify actual domain ownership and spelling before DNS). Point the hostname to the deployed static asset root and configure a host-specific rewrite from `/` to `/equity-uprise.html`. Keep `matthew.mccluster.org` and its current root behavior unchanged. Use a 200 rewrite, not a redirect to the McCluster domain, so the Equity Uprise address stays in the browser. Verify HTTPS, CSP, canonical URL, static assets and Cesium remote resources. Domain DNS, TLS and routing are NOT changed by this commit.

## Security and UX acceptance
1. Logged-out user sees the globe preview with minimal header, no posting/recording or account-only features.
2. The preview cannot be used to perform member actions. Public policy and published mission metadata may be displayed.
3. Log in routes to the existing session-aware entry; don't claim SSO or auto-login without testing.
4. Authenticated users see permitted network controls, not admin-only controls.
5. With no data, globe still renders and says that regional activity is being activated; never fabricate activity.
6. Mobile viewport and keyboard navigation work; frame is decorative and non-focusable.
7. Do not embed private analytics or unverified candidate/member data in the public preview.

## Future
For a more polished globe, add curated public non-user layers (country boundaries, verified office directory coverage, public policy and sourced news) as datasets are activated. Display explicit no-data states.
