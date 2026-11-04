# Managed client perspectives: Faith & Results + Shiloh Church GPT

## The user-facing contract (17 October 2026)

Keep the existing McCluster **Music | identity | Globe** bar. A client home replaces the middle *perspective*, not the underlying account, World, music, or owner navigation. Client-native capabilities sit inside that client's home as section links and routes, not a second global bar. Matthew's personal house remains Matthew's house; using its brand as an unconsented corporate/client identity is prohibited.

Initial reviewed client-entry pages:
- `partners/faith-and-results.html` — Faith & Results / Freedom, Inc. public front door. Housing, workforce, financial empowerment, community programs, with working handoffs to its existing app `mcclusterishere/Faith-And-Results`.
- `partners/shiloh-church-gpt.html` — Shiloh Baptist Church's public front door. Worship, sermons, prayer, ministries, with a clearly **not-live** Shiloh Church GPT area; its existing product source is `mcclusterishere/Shiloh-Church-BPT-App` at `claude/shiloh-church-bpt-design-x9lnin`.

The two organizations remain distinct from **Faith Community Development Corporation**, and distinct from McCluster Corp. No charitable sponsorship, tax status, impact numbers, or corporate relationship is inferred by the skin.

The branded icons/photography in these previews are referenced directly from pinned commits of the original client repositories. They are the original supplied artwork, not traced, recolored, recreated, or logo placeholders. Copy approved originals into a governed media catalog for production if the client authorizes deployment.

## Mechanism and boundaries

`js/site-navigation.js` loads `js/managed-client-perspective.js` for pages carrying the actual shared bar. The module recognizes only two fixed slugs in code, from an explicit `data-managed-client` attribute on our controlled pages, a public `mcc_app` query field, or the current origin's session storage. It paints the middle tab using approved existing client media and intercepts ordinary taps on only the three existing public tabs. Music and Globe continue using the established McCluster routes. The client slug moves as a **public non-sensitive query string** so the middle perspective can survive the Music/World host boundary. Returning to Matthew's root without an explicit client resets the perspective. A long press still belongs to the existing shared bar; this patch never edits `js/tabbar.js` while the World/travel/music PR #495 is active.

A slug is *never* a privilege, role, tenant claim, org ID, authorization token, secret, or entitlement. It never changes `/v1/workspaces/me`, house owner authorization, RLS, access tokens, or backend routing. Navigation can be viewed by guests; private routes remain server-verified and unavailable just because a visitor chooses a client skin. The owner five-tab bar is untouched.

No satellite is replaced or cut over in this change; client product-specific data is still sourced from its own current UI and catalog. No legacy client admin/demo passcodes are used; Shiloh's old demo access is not a security boundary. The app home is new, and the protected workflows remain in their original state. Faith & Results' existing Pages deployment is the application handoff. Shiloh's draft app is linked as a *prototype source* rather than a fake deployed destination. Church GPT is not represented as a functioning assistant.

## Next integration stages (separate, owner-reviewed)

1. Server-side enrollment of both distinct organizations and the app identities in McCluster's existing `orgs`, `org_members` and registered apps. Record explicit contracts and entitlements, not special-cased bypasses or house-owner rights. Confirm the Faith/FREEDOM/Faith CDC legal and domain relationship with the client.
2. Feed the center profile and page from a typed, approved tenant registry rather than the two static allowlisted front doors. Add source-backed content cards, accessible branded media, and client-specific app subroutes.
3. Bridge existing Faith application and Shiloh member, pastoral, event, media and GPT workflows to `api.mccluster.org` only after reviewing the authorization, data import, RLS, consent and audit model. Private Shiloh prayer, visitor, volunteer, and pastoral records must never be returned by public or unrelated-client roles. No satellite-local competing authority stack.
4. After PR #495 is reconciled, move the middle-perspective door/held-wing behavior into `js/tabbar.js` with a dedicated tested tenant contract. Preserve playback, World guest travel, owner navigation and cross-host auth handoff.
5. Client-approved app domain activation, preview smoke test at 390/820/1280 widths and WCAG focus/overflow check, then human-reviewed cutover. Neither client production hostname is changed by this PR.

## Acceptance for this slice

- Both branded front doors are distinct, publicly readable, and use the shared bar exactly once.
- A client-root visit makes the center a client identity, and moving to Music or Globe retains that center context via the allowlisted public slug.
- A guest cannot turn a client slug into an org member, staff account, or admin owner. No new API or SQL is introduced.
- Returning to the McCluster personal root clears the presentation context.
- Existing partner-app destinations are labeled honestly: Faith has an app; Shiloh's next-generation app / Church GPT remain in integration preview.
- Existing #495 / #493 / #498 working files remain unchanged.
