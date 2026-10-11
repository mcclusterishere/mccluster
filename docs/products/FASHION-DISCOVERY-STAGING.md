# Fashion Discovery — staged McCluster app

Status: **design/staging only**. Do not add a bottom tab, public home-page link, production route, or navigation item from this document. Activation requires separate owner approval and a reviewed rollout.

## Product
- App name: **Fashion Discovery**; powered by **Heat Chart**.
- Source of product UI and catalog logic: `mcclusterishere/designer-kicks-platform`, already listed in `docs/control-plane/registry.json`. Do not copy the whole Next.js application into this repository.
- Intended host property: **mccluster.org**, McCluster Corp's company website (not Matthew's personal site). The integration may eventually use an app route or launch surface, but no URL is reserved or routed by this staging document.
- Existing independent Heat Chart product/domain can continue to exist. The app entry and independent experience must use the same canonical services.

## Candidate app experience
1. Discover sneakers and fashion from the existing Heat Chart catalog and authorized sources (including its existing KicksDB integration).
2. Open product details, release/market information, and tracked affiliate shopping destinations.
3. Offer camera-based footwear try-on **only** for SKUs with compatible licensed 3D assets and validated foot tracking; otherwise show an honest unavailable/fallback state.
4. Creator/artist submissions and storefront features can follow after canonical identity and permissions are integrated.

## Platform law
- Honor `AGENTS.md`, `docs/control-plane/ECOSYSTEM.md`, and `docs/architecture/identity-network.md`.
- Use shared Supabase project `zmnhbrjyhxzhkxmhkexs` and canonical McCluster identity (`m_people`, `m_auth_user_links`, `platform_profiles`); app membership is scoped separately. Do not create a competing auth stack or new Supabase project.
- Use existing Worker `mccluster` and `api.mccluster.org` where APIs are required. No second Worker or payment authority.
- Railway is deactivated. Historical Heat Chart users are **not** considered migrated. Verified sign-in and explicit re-onboarding are required where data is unavailable.
- Treat existing affiliate tracking, product licensing, creator ownership and payment verification as release gates.

## Release gates
- Inventory Heat Chart functionality and dependencies; map shared backend boundaries.
- Define a reviewed app entry point and integration method that preserves the independent product.
- Implement and test a staging-only surface behind existing authorization or non-public preview; no public bottom navigation.
- Validate responsive behavior at 390px, accessibility, auth, catalog, redirects, privacy, and analytics.
- Require owner sign-off before enabling the company-site app or modifying the bottom tabs.
