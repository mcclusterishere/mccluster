# Policy consumer mode — owner review

Entry: the existing owner Control destination panel → Products → Policy. It opens the canonical consumer World with `view=feed&policy=1`. The ordinary World route, Policy Fellowship desk (`desk=policy`) and Halo product remain distinct.

The local Policy controls are Go Live, Globe and Feed. Globe and Feed switch between the existing consumer globe and community feed in the same document; the profile, center place card and shared bottom navigation remain. The mode labels the community feed honestly: audit-specific publication and filtering are not connected.

This is an owner-review feature. The shared bar's fresh server owner verification determines entry. Denial, verification errors and observed role loss withdraw the mode. The client gate is presentation only; all data and live actions retain their canonical server checks.

Go Live opens the existing live studio after a fresh canonical eligibility request. Missing host capability, disabled broadcasting, unavailable browser transport and failed eligibility requests do not open it. A caller guard prevents a late permission answer from opening the studio after Policy access is withdrawn. Opening the studio does not create a broadcast: the existing form, capability checks, WHIP connection and on-air confirmation still govern broadcasting. Camera/microphone permission and country-placement opt-in remain in that studio.

There are no new upload routes, auth stores, broadcast providers or evidence APIs. This mode never reads or publishes private case material. A future audit publication flow needs a separate explicit review/redaction/consent contract before approved public recordings can appear as audit pins or feed items. Do not link private vault objects into existing public social uploads.

Files: `js/policy-mode-core.js`, `js/policy-mode.js`, `css/policy-mode.css`; loaded by `mnet.html`. The entry lives in `js/site-navigation.js`; `js/mnet-live.js` reuses its existing studio with fresh eligibility and optional stale-caller guard.

Validation: `node --test scripts/test/policy-mode.test.mjs` passes 10 tests covering denial, globe/feed switches, fresh live checks, revoked and late permissions, disabled service, recoverable failure, and the actual live adapter. Existing owner navigation and Halo suites pass 14 tests. Browser/iPad layout and real provider broadcasting remain unverified. This branch is not deployed.
