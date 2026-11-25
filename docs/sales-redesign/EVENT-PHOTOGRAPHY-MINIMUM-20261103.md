# Event photography minimum

Review-only change based on main `20605e701c1852b27ebe7ea185c7187343e53943`.

## Offer

Event photography remains $201/hour, with a three-hour minimum ($603 service base). The public service area is Connecticut, within approximately 75 minutes of New Haven. Travel is quoted as a separate line item and agreed before booking. No travel amount, tax rate, delivery guarantee, or automatic availability promise is added.

`data/offers.json` holds the hourly rate, minimum hours, service area and travel terms. The shared offer helpers derive the base. The hire rate card, package tray, onboarding review and generated structured data use those values. The general production starting price is $285, the existing portrait session, because a $201 one-hour event is no longer a purchasable project.

The package tray uses the three-hour base, labels it as a starting estimate, retains the service minimum through package discounts, and carries the separate-travel note. Other service discounts remain available. Monetary estimates retain cents.

The standard-mode event-photography enquiry asks for coverage hours, rejects invalid or subminimum values, and revalidates resumed/edited briefs before submission. Video-only events (including raw footage), portraits and custom Equity Uprise terms do not inherit the standard photography calculation. Review Change links now reach the duration/location questions.

## Booking and server boundary

Who Did the Shoot's public offer CTA now opens the existing quote enquiry, rather than a generic deposit checkout. Quotes and travel must be agreed before booking.

The existing form inserts an enquiry into `site_requests`; it does not create a confirmed booking or a server-priced event order. There is no existing server-side hourly-event calculation to update. The generic `booking-deposit` checkout is shared with other services and still accepts its existing $100–$10,000 range. Direct generic payment URLs are not an event-contract enforcement gate. A server-enforced contract/order-linked payment gate is separate work; this change does not claim one.

No production data, server settings, historical migrations, payment settings or deployments are changed. The knowledge generator now includes the same minimum and quote-first link. Updating already-stored production knowledge requires a separately reviewed refresh; historical knowledge migrations remain untouched.

## Verification

- `node --test scripts/test/event-photography.test.mjs`: 12 passing regression tests.
- `node tools/build-hire-schema.mjs --check`: passed.
- `node --check` on all four changed browser scripts: passed.
- `node scripts/kb-build.mjs`: generation passed; event minimum, service area, travel and enquiry link verified. Generated SQL was not applied.
- Independent review caught and fixed raw-video misclassification; regression coverage added.
- `node scripts/golden-check.mjs`: event rate passes. The aggregate check fails on unchanged hosting-maintenance `$NaN`; reproduced on the exact baseline as well.
- Local real-browser QA is blocked by the executor denying Chromium's socket creation, including an escalation attempt. No local 390px layout pass is claimed. Source tests run against exact-source VM fixtures, not a real browser.
- Complete repository tests and remote CI are separate checks; focused local results are not a full-suite pass.

No merge or release is authorized by this review branch.
