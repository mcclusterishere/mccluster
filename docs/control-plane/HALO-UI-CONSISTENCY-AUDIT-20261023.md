# Hitman’s Halo: UI and connected-experience audit

Audit date: 23 October 2026 (America/New_York). Source revision: `1f1996a21b59cfa494fd1f2fd09aa11232121b53`.

This is an audit, not a deployment receipt. No application code, permissions, mission records, or publishing state was changed during this pass.

## Scope and evidence

The canonical Halo is `action-globe.html?explore=1&halo=1`, not the separate provider application at prime.mccluster.org. Reviewed all four Halo views in source: World, Missions, People, Intelligence, plus their camera, source-health, search, detail, timeline, share, and account controls. Traced incoming routes from the shared owner bar, Control Apps, Control navigation, workspace Intelligence, and the World globe. Traced outgoing routes to campaign administration, proof review, public missions, Analytics, daily briefs, the World feed, and account controls.

Live browser inspection covered the Halo entry and its failure state, Control’s Action Network overview, Missions and Proof review destinations, Morning brief, the company World feed, and the signed-in World overlay reached from the Halo page. Read the UI, CSS, data adapters, and relevant backend response contracts to establish causes.

**Important coverage limit:** this cloud browser cannot initialize WebGL. The live Halo console therefore never mounts. All four Halo tabs were source-reviewed, but their successful 3D rendering, mobile/tablet layouts, map picking, and real camera sheets could not be visually certified in this pass. The browser limitation does not establish that the owner’s device has the same failure. The application’s response to that failure is nevertheless directly observed and defective as a fallback experience.

43 existing tests passed across `halo-console.test.mjs`, `halo-hud.test.mjs`, and `halo-vision.test.mjs`. These are contract/unit checks, not proof of a complete live visual audit.

## Prioritized findings

### H01 — High: a failed globe removes the entire application

**Live and source confirmed.** The entry shows a stock Cesium error dialog, a mostly black screen, and “Mission browsing will be available when the map can load.” World, Missions, People, and Intelligence are absent. The browser title remains “Make the world your feed · Human Uprise.”

`js/action-globe.js` creates the Cesium Viewer before the normal access-loading and Halo mounting sequence. `haloSync()` returns without a viewer; `HaloConsole.mount()` also requires the viewer and Cesium. Non-map operations therefore inherit a graphics dependency they do not intrinsically need.

**Repair:** keep owner authorization and the Halo navigation/data shell independent of the map. Fail only the map region; keep mission, people, intelligence, and camera-list access available with a clear retry/fallback message. Do not weaken owner gates to implement this.

### H02 — High: unavailable or partial data can look healthy and empty

**Source confirmed.** `world-halo-ops.js` can return HTTP-success envelopes with `unavailable: true`, empty arrays and zero counts; it also reports individual unavailable source families and `truncated`. `js/halo/data.js` treats successful JSON as a good answer. `halo.js` does not consume those coverage flags when painting operation lists/counts. `sources()` marks the missions answer green based on its fetch timestamp. A failed refresh with a retained body can also keep that source green. `paintStrip()` checks transport errors on missions/people, not full response coverage or intelligence failures.

**Impact:** “No missions,” zero counts, “Updated,” and a connected indicator can coexist with missing data. This is the same class of misleading partial-data presentation the Analytics work was intended to eliminate, but in Halo’s separate UI.

**Repair:** normalize loading, ready-empty, partial, stale, unavailable, and truncated states; retain last good content with a visible stale warning. Render unknown counts as unknown. Show which source family failed and provide retry.

### H03 — High: “Closed” becomes “Completed” without outcome evidence

**Live Control state and source mapping confirmed.** Control shows missions with state `closed` and zero verified completions. Halo’s backend maps every `closed` mission to `completed`; Halo displays “Completed” in cards and totals.

Files: `workers/mccluster/src/world-halo-ops.js` (`MISSION_STATUS`), `js/halo/halo.js` (`missionWord`, `paintStrip`).

**Impact:** closing registration or ending a mission reads as successful completion in the operations view. This is a semantic mismatch, not missing data.

**Repair:** use “Closed” consistently unless there is a separate authoritative completed-outcome state. Keep verified participant outcomes separate from mission lifecycle state.

### H04 — High: action links discard the selected mission or evidence

**Live destination and source confirmed.** “New mission,” “Manage missions,” “Review evidence,” and mission “Open in the Control Room” all use `control.html#create:action-network`. A fresh arrival opened campaign Overview, with the first campaign selected. Missions and Proof review require additional local clicks. The selected Halo mission, campaign, proof, and intended action are not carried in the link. Intelligence’s “Review in the Control Room” similarly points to generic `control.html#analytics` without the evidence ID or review section.

**Repair:** support explicit destination state for campaign, mission, proof/evidence and intent. A review link should open the selected evidence; a creation link should open the creation form. Include a return-to-Halo route that restores context.

### H05 — High: camera catalog health is presented as live-image health

**Source confirmed; prior image-verification results remain separate evidence.** Core layers expose on/count/locked to Halo, not their complete freshness, provider, or image-check state. `stateOf()` uses those limited fields and `health()` falls through to green “Live.” For CCTV, the count is located catalog entries, not verified playable cameras. `openCamera()` fetches one image, labels it “Live snapshot,” and supplies no ongoing refresh control.

**Impact:** Analytics carefully distinguishes listed, checked, verified, unavailable and unchecked cameras, while Halo suggests the loaded catalog itself is live. A snapshot is also easy to mistake for a continuously updating feed.

**Repair:** label catalog counts as listed cameras; present provider availability and last verification separately. Use “Snapshot,” captured/retrieved times, an explicit refresh action, and truthful failed/unchecked states. Carry catalog truncation/provider diagnostics into the viewer UI. Keep the backend repairs from PR610.

### H06 — Medium: camera access explanation still contradicts owner eligibility

**Source confirmed.** The backend now permits a verified house owner with current privacy acknowledgement without a completed member mission. `cctvGate()` and the static CCTV accessible label still describe three mandatory requirements and “CCTV is for members who earned it.” The UI does not branch on `access_basis: owner`.

**Impact:** an owner encountering a privacy requirement or an eligibility failure can be told to complete a mission unnecessarily.

**Repair:** reflect the server’s owner/member access basis, and distinguish an eligibility lookup failure from an actual unmet requirement. Preserve privacy acknowledgement and ordinary-member gates.

### H07 — Medium: brief navigation loses both edition and country

**Live destination and source confirmed.** Halo’s selected-country detail links to bare `brief.html`. The destination always starts with yesterday in America/New_York and chooses a default country. In this audit it opened Afghanistan with no brief. Halo’s adapter instead requests today in UTC, falling back to yesterday in UTC. The same “Daily briefs” task can therefore refer to different editions in the two pages.

**Repair:** one explicit edition/date rule; pass country and day to the reading page, read those parameters there, and preserve them on return. Do not silently replace the selected edition with a default country.

### H08 — Medium: Intelligence refresh and failure behavior differs from Missions/People

**Source confirmed.** `HaloData` periodically re-fetches missions and people only. Evidence and connector health are loaded on view entry; briefs have a separate loading path. Their TTLs do not themselves cause refresh. A continuously open Intelligence tab can therefore retain old evidence/health while the display keeps repainting. Empty feed and brief branches do not consistently expose failed requests. Feed rendering uses `slice(0, 60)` while its heading counts the full filtered set, without a continuation control.

**Repair:** an explicit freshness/refresh policy for all visible sources; retain stale data with timestamps, distinguish failure from empty results, and show “60 of N” with paging or load more.

### H09 — Medium: operational totals and list coverage disagree

**Source confirmed.** Missions and People responses include totals, source health and truncation; the UI largely counts displayed arrays. Backend limits include 200 displayed missions/people and bounded team/evidence arrays. There is no corresponding visible completeness or continuation affordance in the Halo lists.

**Repair:** distinguish shown from total, disclose bounded results and missing source families, and provide a route to the full record set. Do not imply “all” from a capped array.

### H10 — Medium: different visual systems create abrupt task transitions

**Live connected-page appearance; Halo design/source comparison.** Halo is a compact navy/cyan/amber operations console. Control uses broad black/red panels, a generic Create heading, a long campaign chip row and nested operational tabs. Morning brief uses a narrow reading column and large serif heading. These can be appropriate destination-specific layouts, but the transitions have no persistent task breadcrumb or selected-record context. The Control mission destination also exposes an “Edit page” floating control unrelated to managing a mission.

**Repair:** retain appropriate reading and operations layouts, but share task breadcrumbs, status vocabulary, action placement, focus behavior, and return context. Remove page-authoring controls from operational flows where they are irrelevant. This does not require reskinning unrelated public properties.

### H11 — Medium: implementation details leak into product UI

**Live/source confirmed.** Morning brief displays “Region leaders open once their table is applied.” Halo source includes messages about deploying the Worker, ion asset/token scope and “phase 4” for Replay. These describe implementation rather than a useful next action for the operator.

**Repair:** show “Not available yet” or a concrete recovery action; keep deployment and credential diagnostics in an expandable administrator diagnostic view. Planned features should be clearly separated from available controls.

### H12 — Medium: ordinary navigation does not preserve selection

**Source confirmed.** Halo saves the view and some layer preferences, but ordinary tab changes do not update URL history. Share links serialize view, globe camera, visual treatment, HUD and layers—not selected mission/person/evidence or list filters. Outgoing action links have no return-state contract.

**Repair:** define canonical view/selection/filter URL state, preserve it through connected actions, and make Back/Forward predictable. A deliberate camera-only share should say what it preserves.

### H13 — Follow-up: tablet density needs targeted visual proof

**Source risk, not a claimed reproduced overlap.** At 768px the header switches to absolutely centered tabs beside the brand, feed link and operator; the side panels become 320px wide. A selected detail consumes another 320px plus margins, leaving very little central map room on an approximately 820px tablet. Existing owner-entry browser coverage targets 390 and 1280; it is not evidence for the middle breakpoint or populated sheets.

**Required check:** all four views at 390, 820 and 1280, with long titles, populated evidence, open layers, account menu, camera sheet and keyboard focus. Measure overlap, usable map area, clipping and horizontal overflow. Prefer a tablet list/detail switch or sheet layout if the simultaneous columns fail.

### H14 — High: an empty proof queue repeatedly reloads

**Persistent loading observed live; cause confirmed in source.** Control → Action Network → Proof review remained on “Loading proof queue…” across separate observations after the adjacent Anti-Social queue had resolved. `js/control-room/action-network.js` initializes `proofs: []` with no loaded sentinel. `reviews()` calls `loadProofs()` whenever `!A.proofs.length && !A.proofBusy`. A successful empty result clears `proofBusy` and redraws, which immediately fetches again. A failed read with an empty array follows the same cycle. This is not a legitimate empty-state experience.

**Repair:** track loaded/error state separately from array length, show “Nothing to review” after a successful empty response, and retry only through an explicit or bounded refresh policy. Verify empty success, populated success and failure. Navigated away from the queue after inspection to stop the repeated-read condition.

## Surface coverage matrix

| Surface | Checked | Result |
|---|---|---|
| Owner bar, Control Apps/menu, workspace Halo doors | Source; live shared bar | Canonical Halo route is consistently used. No evidence of a renewed redirect to the standalone app. |
| Halo World | Source; live entry/failure | H01, H02, H05, H06; successful map interaction blocked in this browser. |
| Halo Missions | Source + live Control destination | H02, H03, H04, H09, H12. |
| Halo People | Source | Data coverage and navigation findings apply; mission locations remain distinct from personal locations. Live tab not rendered. |
| Halo Intelligence: Feed, Briefs, Sources | Source + live brief/Analytics route context | H02, H04, H07, H08, H09. |
| Camera detail and layer controls | Source; prior camera repair evidence | Backend access/cap/provenance fixes remain intact. Snapshot presentation and catalog-health mismatch remain. |
| Control campaign Overview/Missions/Proof review | Live + source | Generic entry loses selected mission/action; lifecycle terms differ; local navigation opens each section, but Proof review has H14’s repeating loading state. |
| Morning brief | Live + source | Edition/country mismatch, different visual treatment, infrastructure-copy leak. |
| World feed / Halo return | Live + source | Following the page’s World link successfully opened a signed-in World overlay. Direct navigation to a different origin initially showed a guest state; that alone is not a broken-session finding. Embedded globe also hit the environment’s WebGL failure. |
| Public mission pages | Source routing only | Mission ID is carried in `mnet.html?mission=…`; public Missions are deliberately disabled under the social-only release. Owner-mode behavior after cross-origin entry needs dedicated live proof. Not declared broken or fully verified here. |
| Account/profile | Shared control and source | Halo delegates to the shared account chip rather than adding a second auth system. Full account mutation flow not exercised. |
| Separate prime.mccluster.org app | Boundary/source references | Not the canonical UI opened from McCluster menus; no separate visual audit claimed. |

## Repair order and acceptance

1. **Trust and continuity:** H01–H06 and H14. Independently usable shell, honest data/coverage, closed-versus-completed semantics, contextual action links, camera snapshot/eligibility truth, and a stable proof-review empty state.
2. **Connected workflows:** H07–H09 and H12. Edition-aware briefs, visible freshness and errors, complete/paged lists, navigation that retains selection.
3. **Presentation:** H10–H11 and H13. Consistent operator controls/copy and visual proof at phone/tablet/desktop widths.

Acceptance must include actual data-failure envelopes, retained stale responses, revoked access, unavailable providers, a closed mission with zero verified outcomes, a non-default brief country/date, and returning from a proof review to the same Halo item. Existing passing source-contract tests are insufficient for those scenarios. A full visual sign-off remains outstanding until the four live tabs can render in a WebGL-capable browser.


## Repair implementation

The follow-up repair keeps the existing authorized Halo shell usable after a map failure, with a searchable camera catalog and snapshot viewer. It normalizes HTTP-success unavailable responses, preserves stale data, reports bounded/partial operation data, refreshes evidence/health, removes the silent 60-signal display cutoff, labels the legacy completed lifecycle bucket as Closed, and carries mission intent/ID and brief edition/country across destinations. The proof queue now settles on empty/error instead of repeatedly loading. Camera copy distinguishes catalog records and snapshots from continuous streams, and owner eligibility copy follows the server. Tablet panels keep the sheet layout until 1100px. Ordinary view/item navigation records history; selected list filters are not yet serialized. Intelligence no longer offers a misleading generic Analytics link as an evidence-review action; actual intelligence adjudication remains unavailable in this view.

The site’s separate design systems remain; the repair adds contextual return links and clearer operational copy rather than a wholesale visual redesign. Source contract and behavioral checks pass locally; the associated PR records browser and deployment results. Browser checks now include 820px and a missing-Cesium fallback with all four views and owner revocation. No backend authorization or data records changed.
