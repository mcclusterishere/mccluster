# Bounded local frontend implementation prompt

Ready for local integration after independent contract review; not a full product or production activation instruction.

```text
Read AGENTS.md, docs/productization/20261102-v2/HANDOFF.md and API.md, plus the wider v1 readiness matrix. Adopt the tested v2 API in the existing Control/front/project editors and actual renderer. Do not create another builder, navigation shell or auth system, or rewrite index.html.

Read the current revision and send it on every save/publish/restore/reset/unpublish/moderation mutation. Preserve drafts on failure. Show 409 conflicts and the latest saved state for deliberate resolution; never silently retry with a newer token. Read back after lost responses. Personal/project restore is draft-only; publish is deliberate and separate. Control reset means shipped defaults; restore creates a new audited revision of the exact slot, not a multi-slot page snapshot.

Coordinate every entry point for an enrolled record: first v2 mutation protects it and older blind writes will conflict. Never clear protection or fall back to old writes. Preserve current manual scene/scroll/VR/audio/visibility controls, supplied marks, bottom navigation and top-right account controls. Use existing config/media validation. Tile Studio retains its API; #681 offers needs combined-source validation first.

Acceptance: mobile 390px without overflow; keyboard/focus/accessibility; real renderer preview; save/reload; immutable history/restore; two-editor conflicts; expired session/account switch; wrong-owner refusal; private/removed publish refusal; unpublish/takedown; lost-response recovery. Use bundled real-SQL fixtures. Mock-only UI behavior is not completion. Separate local results from real-service acceptance.

No production SQL/flag changes, push/merge/deploy, credentials, external messages, domain/social/model activation or financial transactions. Domain, commerce, LMS and lyric gates remain separate. Return files, reproducible tests, exact source SHA and remaining real-service gates.
```
