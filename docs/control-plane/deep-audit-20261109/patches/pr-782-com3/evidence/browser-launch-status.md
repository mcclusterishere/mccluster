# Browser validation status

The existing customer-commerce browser runner failed to launch shell Chromium
with `socket() EPERM` (process_singleton_posix.cc). One require_escalated retry
was approved but encountered the same OS restriction. This was a capability
failure, not a permission-review denial. The original tool output was not saved
as a log; this is the execution report, not a fabricated raw transcript.

The later attempt with the already-provisioned cloud browser is recorded in
`browser-capability-report.json`. Its loopback HTTP fixture was unreachable.
A local file URL was denied by URL policy; testing stopped without a bypass.
No screenshot, Playwright journey or 390px rendering pass is claimed.

Run in an authorized Chromium-capable environment:

    PLAYWRIGHT_MODULE=<module> node --test scripts/test/customer-commerce-browser.mjs scripts/test/customer-checkout-recovery-browser.mjs

Both runners are now included in Customer self-service pull-request CI.
