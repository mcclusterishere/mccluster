# Action Network mission curation + worldwide resource discovery (2026-10-14)

## Decisions and precedence
User's specific rejections override broad enthusiasm for a program. Thus Equity Uprise's **Read Docket**, **Write policy memo**, and **Co-write reform paper** stay; **File a public comment** is retired because the user explicitly rejected that action. Add **Write a Song for Equity Uprise**. All records remain in the database for history, receipts and existing participants.

### Public missions after curation
1. Feed two people (Homelessness Action).
2. Recycle one dead device the right way (Cobalt).
3. Spend $20 at a Black-owned business (End Racism).
4. Change one institutional thing (general civic).
5. Read the Docket 516R record (Equity Uprise).
6. Write a policy memo (Equity Uprise; verified memo unlocks application).
7. Co-write a policy reform paper (Equity Uprise).
8. Write a Song for Equity Uprise (new).

Separate prominent **Find help for yourself or someone you know** gateway (no public mission proof, no points, no join) links to resource directories. A public no-login `/help.html` offers country/category filtering and shareable links; anyone can pass the page onward without sharing recipient identities. This is not a tracked referral graph. The underlying legacy service mission remains paused to prevent its proof/points engine from treating need as a public achievement. The new private referral workflow is not implemented yet.

**One Safe Night** is a new *draft* mission; cannot go public before an authorized accommodation partner, room funding, booking and consent process exist. Housing navigation remains partner-only/paused. Documentation of field actions moves to the media/creator workflow; it is not an extra public mission. Free cuts, employment assistance, voter registration, and laundry are held as drafts until a real local operating program exists. Sneaker authentication moves to its own specialist workflow. Existing participants on retired/moved missions retain proof access via paused status.

### Why no hard deletion
`action_mission_assignments`, `action_proofs`, action points, share receipts, social links, and bounty claims refer to mission IDs. `submit_action_proof` permits `open` or `paused` mission status, but not `closed`. The migration pauses any retiring mission with active/rejected assignments, closes those without active work, and never deletes mission IDs. It pauses service/media bounties instead of erasing or paying them. Original historical seed migrations are not rewritten; this newer migration must remain applied after them.

## Resource discovery — authoritative sources and permissions

The new `action_resource_sources` registry contains *public directory links only*, not imported third-party listings, API keys, contracts or implied partnership status. The `integration_status` is `link_only`. Public RLS exposes only published source metadata. API ingestion must require an explicit agreement or an authorized open-data license.

| Type | Directory | Coverage | What is actually available | Integration dependency |
|---|---|---|---|---|
| Social help | United Way 211, https://211.org | US | Official local-service search and helpline | 211 National Data Platform API keys require 211 permission: https://register.211.org/Home/LogIntoApiPortal |
| Social help | 211 Canada, https://211.ca | CA | Official provider locator and help | Negotiate access with 211 Canada/providers for structured listings |
| Social help | Findhelp, https://www.findhelp.org | US | Public resource search | Licensed Programs/Referral APIs: https://company.findhelp.com/solutions/partnerships/integrations/ |
| Social help | Turn2us, https://www.turn2us.org.uk/get-support/using-find-an-adviser | GB | Adviser search | Request data/API reuse permission |
| Social help | Ask Izzy, https://askizzy.org.au | AU | National social-services search | Request permission from Infoxchange |
| Social help | IFRC National Societies, https://www.ifrc.org/national-societies-directory/0 | 191 national societies | Official country-level humanitarian contact directory; available services vary | Not a universal welfare program; request authorized country-level feeds |
| Social help | UNHCR Help, https://help.unhcr.org/countries/ | 130+ country pages | Refugee, asylum and stateless-person resources | Specialized eligibility; do not present as general social-services coverage |
| Social help | Find A Helpline, https://findahelpline.com/ | 176 countries | Verified emotional-support helplines | Specialist support; not a substitute for emergency services or all social services |
| Recycling | SERI R2, https://sustainableelectronics.org/find-an-r2-certified-facility/ | International | Certified facilities and drop-off filters | Verify license/exports; **not every certified facility accepts consumers** |
| Recycling | e-Stewards, https://e-stewards.org/find-a-processor/ | International | Certified processors/consumer drop-off filters | Verify reuse license and live service |
| Black businesses | ByBlack / U.S. Black Chambers, https://www.byblack.us | US | Black-owned directory and certification information | Partner/license listings and geocodes |
| Black businesses | Black Business Green Book, https://www.blackbusinessgreenbook.com | US | Public directory | Obtain licensing/verification before importing |

**Standardize authorized human-services feeds using Open Referral HSDS 3.x** (https://docs.openreferral.org/en/latest/hsds/api_reference.html). Each normalized service should carry country/region, category, eligibility, hours, languages, accessibility, coordinates, last_verified_at, source ID, permitted use, and direct contact links. No assumption that a national directory is globally complete. Outside US/CA/GB/AU, offer the global specialist directories as relevant, explicitly mark gaps in general welfare coverage, and onboard country-level public agencies or authorized NGO data sources. Do not fabricate resources.

## Resource/referral workflow to implement next
- Entry choices: **I need help** / **Someone I know needs help** / **Share this resource**. No requirement to identify the recipient, register, upload a photo, or publish need.
- User selects country, locality (entered voluntarily), category (housing/food/benefits/legal/health/transport), then sees a service list/map with *current* eligibility and contact information. Location permission optional. No address collection unless necessary to find a local service.
- Each service offers **Call**, **Visit**, **Directions**, **Share**. Use verified place coordinates or IDs, not a category-wide Google search masquerading as a verified provider. Google Maps universal directions URLs are documented at https://developers.google.com/maps/documentation/urls/get-started .
- Shareable referral links can be passed onward indefinitely. The referral graph must be pseudonymous/consent-based; no third-party identity, case details, or chain-of-custody exposed publicly. Avoid points/bounties for needing assistance or pressuring recipients.
- Closed-loop outcomes (contacted, appointment requested, connected, unresolved) only with consent and authorized provider confirmation. Provide correction, expiration, and abuse reporting.
- The link-only directory gateway implemented in this PR is a **first phase**, not a completed referral case-management system.

## Recycling and Black-owned business directions
- **Recycling:** find certified consumer-accepting drop-off; show accepted device/battery types, hours, accessibility and whether a fee applies; offer directions to the actual site. Advise users to erase personal data before recycling. For battery-only sites, do not misrepresent them as laptop drop-off.
- **Black-owned business:** search verified/licensed ByBlack listings; filter in-person vs online; use business-specific place ID/address for directions; allow $20 receipt with sensitive details redacted; a review is optional and must be authentic. Never infer Black ownership from appearance or generic map categories.
- Before directory rights are obtained, **link out** to the official directory rather than scraping/copying its listings.

## One Safe Night: funding and privacy controls
Two separate roles: **Funder** (contributes to a specific verified accommodation cost) and **Doer** (arranges the stay with a vetted local hotel/partner). A doer may fundraise from their profile. Do not advertise an available night until hotel acceptance, guest eligibility/ID requirements, booking terms, and adequate verified funding are established. Direct provider payment and separately approved creator compensation; never conflate creator payment with the cost of the room. Proof via redacted receipt or provider confirmation. Video may document the volunteer's work, never a guest's identity or vulnerability without freely given informed consent; filming must not be a condition of receiving help. Offer a no-video path. Consider refund and cancellation handling, hotel safety and check-in, and service referrals for longer-term support.

## Policy team application
The existing `action_fellowship_applications` queue and admin review remain canonical. This PR adds a second eligibility route: **one verified Equity Uprise policy memo** OR the pre-existing **three verified actions**. Application is reviewed; it does not automatically admit the user. The memo mission links to the application in the Action Record. The older 3-action path remains available. The policy team may later receive its own role and separate application without conflating other fellowships.

## Release gates
1. Apply the curation migration after all historical seed migrations; ensure replay doesn't reopen retired rows.
2. Verify five existing in-progress assignments remain accessible, and paused missions still accept their proof while blocking new joins.
3. Verify service/media bounties are paused, their funding/claim histories untouched.
4. Verify the new source registry has RLS, only authorized updates, and no implied API partnership.
5. Verify `mnet.js` can render directories for services/recycling/Black businesses; verify no link appears as a locally verified place without licensed place data.
6. Test policy memo eligibility and fellowship server-side, including unauthorized application attempts.
7. Keep One Safe Night draft until a vetted provider and funding workflow passes tests.
8. Do not deploy production until CI and staging review; do not treat draft PR as deployed functionality.
