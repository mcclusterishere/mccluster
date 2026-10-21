# Action Network threat model and adversarial acceptance tests

Status: security design backlog, not tested deployment.

## Actors and attack surfaces
- Malicious founder: tenant ID swapping, forged admin claims, cross-tenant media URL reuse, employee invitation abuse, analytics scraping.
- Malicious creator: referral farming, fake signups, coordinated bot traffic, duplicate bounty claims, self-dealing, unauthorized copyrighted uploads.
- Malicious fan: mass registration, disposable emails, account sharing, reward racing, replaying claim and webhook requests.
- Compromised service key or integration: unscoped database queries, exposed service-role credentials, forged Instagram metrics, webhook spoofing.
- Insider/admin: override of payments, verification, milestone decisions and access rights without audit.

## P0 test matrix
| Test | Expected result |
| --- | --- |
| Founder A requests Founder B campaign, clip, fan list or payment by ID | 403 or RLS no rows |
| Creator changes tenant_id, role, owner_id in request | Server rejects; no mutation |
| Fan creates 100 accounts from same high-risk source | Rate limited/flagged; no automatic verified-return credit |
| One user reloads same page 1000 times | Zero additional distinct returning users |
| User has one meaningful event on each of two distinct days | One eligible returning user after verification and risk checks |
| One user follows three creators | Three relationships, one network-wide unique person |
| Two concurrent claim attempts for last available offer | Exactly one reservation succeeds |
| Creator claims their own offer or refers self | Rejected and audited |
| Payment webhook replay/out-of-order delivery | Exactly-once ledger effect, no duplicate payouts |
| Signed URL from Tenant A reused under Tenant B context | Denied if private object |
| Rights agreement missing for founder video/music distribution | Publishing blocked |
| Founder contract promises already-reserved exclusive creator slot | Reservation rejected |
| Admin changes payout or verification | Authenticated elevated role and audit record required |
| Hosting expires while fan has shared Mnet account | Tenant entitlement changes without deleting fan's shared identity |

## Security observability
Use existing trace IDs, retained observability and analytics errors where available. Alert on denied cross-tenant attempts, claim races, referral spikes, mass registrations, privileged role changes, provider reconciliation mismatches and failed RLS tests. Do not expose fraud rules or sensitive PII to tenant admins.

## Risk controls
Keep verification decisions reversible; avoid inferring personhood from email alone. Require appropriate user notice, data retention policy and privacy review for IP/device risk signals. Do not store raw payment card data. Do not trust Instagram screenshots without evidence review or authorized API validation.
