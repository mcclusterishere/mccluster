# Errors visitors hit in their journeys

On 2026-10-06 every error signal in production was traced to a cause. Sources:

- first-party `events`: `js_error`, `js_rejection`, `dead_click` and `rage_click`, read session by session in Forensics;
- Supabase gateway, Postgres, auth and edge-function logs;
- Worker responses.

This file lists each distinct error, why it happened and what was done.

Control → Analytics → Forensics now shows the same inventory live:

- the **Errors** view groups every error and friction point, with sessions to open;
- an opened session lists **Where it went wrong**: each moment, what the visitor had just tapped and what they did next.

## Fixed in code

| What visitors hit | Cause | Fix |
|---|---|---|
| A signed-in Instagram listener tapped Play on the gated single 300+ times across 20 sessions. | The preview is a few seconds long and said so nowhere. When it ended, the album jumped to another song. | The first preview play says it is a preview. When it ends, a notice says how to hear the rest, the album stays on that song and the unlock chip nudges. `gated_preview_end` is recorded. |
| Play did nothing. | `deck.play()` rejections were swallowed. On iOS and in-app browsers, a play started after the claim round trip is refused because it no longer counts as part of the tap. | A refused play says so and records `play_failed` with the error name. A newer load aborting an older one is ignored. An earned full play now primes the deck, muted, inside the tap. |
| `Unable to decode audio data` unhandled rejection | The promise returned by `decodeAudioData` was never caught. | `js/filament.js` catches it. |
| "Tip the artist" opened a retired payment page. | There is no tip offering. | The link is removed. |
| The Light/Dark button on music pages did nothing (and had no handler on listen.html). | Those pages are locked to dark. | The button is hidden under a theme lock; `MCC_THEME.dual` is false there. |
| Create account refused silently, under the button, and people pressed it again and again. | The message was easy to miss. | Each refusal focuses its field, sets `aria-invalid`, is announced (`role=alert`) and records `signup_blocked` with the reason only, never what was typed. |
| Registry titles looked like links but did nothing (except I AM HERE). | They were text. | Every title opens its album at that song. |
| The artist name was tapped like a link. | It was text. | The house artist's name opens his page. |
| Tapping the current app-bar tab reloaded the page. | The tab is a plain link to the page already open. | It scrolls to the top instead. |
| Share did nothing in in-app browsers. | `navigator.share` is refused there. | Share falls back to copying the link, unless the visitor cancelled. |
| "Keep the masters" did nothing. | It gave no feedback. | It answers the tap at once and says when there is nothing to keep. |
| `crm_signals` returned 404 on every page that loads `js/signals.js`. | The table does not exist. | Signals ride the first-party event stream as `desk_signal` events. No new table was added. |
| `listener_state` returned 404 for every signed-in page (21 in one day). | The table was never created. | `js/pip.js` parks the sync for a day after a 404. The table is a pending migration (below). |
| `rpc/my_imprint` returned 404. | No migration ever defined it. | The call is removed. |
| Worker `/v1/status` returned 404 on `rpc/ai_harness_status`. | The RPC is retired. | The call is removed; the status points at `/v1/ai`. |
| `/v1/analytics/business` returned 502. | Twenty exact counts ran over full `events` rows. | The counts read `events_lean`. |
| Control → Work → Outreach printed a gateway error. | Its `crm_*` desk tables (`docs/the-desk.sql`) are not in this database. | It says the capability is staged. |

## Measurement that was wrong

| Signal | Cause | Fix |
|---|---|---|
| Dead clicks on every form field | A field takes focus on press, before the click, and a checkbox changes a property, not an attribute. Neither shows the detector anything. | Fields, labels and editable text are never dead. Neither are links to another document, new-tab, download, `mailto:` and `tel:` links. Media play/pause, print, blur and page leave count as an answer. |
| 31 of 38 recorded JS errors | They came from the Instagram/Facebook in-app browsers (`window.webkit.messageHandlers`, `Java object is gone`, `_AutofillCallbackHandler`, `iabjs://`) or from extensions. | Each error now carries its `origin`, the in-app browser and the top of its stack. Forensics shows the site's own errors first and folds injected ones behind a toggle. The tenant SDK sends the message too. |

## Waiting on the owner: database changes

These are written and verified but **not applied**. Applying schema changes to production was refused for this session. Each file:

- is in `supabase/pending/`;
- is bounded by `set local lock_timeout = '5s'`;
- is covered by `supabase/tests/journey_errors.stub.sql` + `journey_errors_regression.sql`, which pass locally.

`anon_policy_scope_v1.sql` was also dry-run against production in a rolled-back transaction.

| File | Fixes |
|---|---|
| `anon_policy_scope_v1.sql` | Signed-out reads of `creator_tracks` and `music_creator_profiles` fail with 401. That leaves the "From creators" shelf empty for every visitor. The P0 containment (`20260913174500`) revoked anon EXECUTE on `current_m_uid()`, but 21 policies still applied to anon and called it. Self policies move to `authenticated`. Mixed read rules are split so anon gets exactly its public half. Nothing is re-granted. |
| `public_music_reads_lean_v1.sql` | `play_counts()` timed out 23 times in one day, and `v_track_signals` / `v_track_affinity` 8 times: visitors saw no counts and no ordering. They now read `events_lean`, which cuts `play_counts` from 4.5 s to 131 ms. |
| `listener_state_v1.sql` | Creates the table the pocket player's cross-device resume writes to: one row per user, forced RLS, own-row only, 4 KB cap. |

To apply one, run it through the Supabase migration path. Then:

1. move it to `supabase/migrations/<version>_<name>.sql`, using the version recorded in `supabase_migrations.schema_migrations`, byte-for-byte;
2. update `supabase/production-ledger.json` and `core/drift-contract.json`;
3. run `node scripts/control-plane-drift-contract-check.mjs`.

## Not ours, so no code change

- **Opaque `Script error.`** from iOS Safari. A cross-origin script failed and the browser hides the detail. It is classified `opaque`.
- **A parse error in the Lenis bundle**, seen once, on a user agent spoofing Edge 122. `main.js` fails open and the page works.
- **The 17:09–17:11 UTC 503 burst and 10 s auth timeouts.** They coincide with another session applying `20261006170955` and `20261006172934` to production, which held locks.
- **Auth refresh "context canceled".** The client went away mid-request. Minor.
- **The retired `pay-now` function** answering 400/410. It is retired on purpose. Deleting the function is an owner item.
