# Regional mission activation: “Where two or more are gathered”

**Activation rule:** two distinct, consenting members associated with the same first-level administrative region (state/province) unlock the region's participation gate. A country is not an eligible activation unit.

**Privacy rule:** the public API may reveal only a boolean locked/unlocked state. Do not expose counts below five, individual accounts, exact coordinates, or identities. The invitation interface may say “Invite someone to help activate this region,” but must not claim how many members are missing. Activation is not a live-presence claim: members do not need to be simultaneously online.

**Join rule:** canonical backend must verify the authenticated actor, active region consent, published mission-to-region assignment, region activation, and all mission-specific qualifications. The new service-only SQL function is a prerequisite, not a replacement for the canonical join authorization. A location permission alone does not establish residency or eligibility. Denied permission must allow a reviewed manual region-selection flow.

**Mission mapping:** no unreviewed automated assignment from addresses, IPs, analytics, member profiles, or nearest centroids. An owner/admin approves a mission's canonical region and safe public marker; ambiguous and multi-region missions require explicit policy. The globe can display missions globally but must block unauthorized participation at the server.

**Activation integrity:** count distinct consenting canonical members, not page views, devices, invited emails, or sessions. Add anti-abuse verification, consent withdrawal, duplicate-account controls, and re-lock policy before rollout. Never publish an exact threshold count as a public metric.

**Owner vs public:** Halo may show authorized operational diagnostics and region-level funnel analysis; public Action Network gets the region status and aggregates of at least five only. Avoid copying existing identifiable event-location fields into public maps.

**Remaining launch gates:** approved ADM1 polygon imports, vetted mission mappings, authenticated region-consent endpoint, integration of the gate into the canonical mission join route, online presence separate from activation, and end-to-end authorization tests.
