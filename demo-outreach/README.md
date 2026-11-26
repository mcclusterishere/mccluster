# Demo outreach (records and genealogy audience)

Outreach to researchers, archivists, genealogists and legal clinics who work on how official records classified race,
especially Native and African American records in North Carolina and Virginia. Each letter is a short first person note
from Matthew with one sourced hook about the person's own work, one link to the demo, and one question.

**Default mode is draft. Nothing in this folder sends on its own.** There is no mail client or network call in this
package (a test enforces it). A send needs Matthew's approval and a transport supplied from outside the repo.

## Files

* `data/candidates.json`: the people. `list: "send"` is eligible for the send list; `list: "hold"` is a tribal office,
  agency, enrollment staff, reference desk, or a person whose address could not be verified. Every email was read on the
  `email_source_url` page on the `verified_on` date. Nothing was guessed or built from a name pattern.
* `data/targets.json`: what the letter points at. `mccluster` (default), `ftp` (Foundational Truth Project atlas), or
  `apex` (Apex research papers). Pick with `DEMO_OUTREACH_TARGET` or `--target`.
* `src/compose.mjs`: the template. Deterministic, no model call, so the approved text is exactly what goes out.
* `src/text-rules.mjs`: no Unicode dashes at all and no hyphen outside an email or URL, in subject and body; 60 to 220
  words; exactly one question; must link the demo.
* `src/ledger.mjs`: append only `send-log.jsonl` in the state dir (gitignored).
* `src/pipeline.mjs`: draft run, send list export, gated send run.

## Commands

```
node bin/demo-outreach.mjs run                       # draft mode: writes state/review-queue.json and prints every letter
node bin/demo-outreach.mjs sendlist --out <file>     # export eligible letters for approval (status awaiting_matthew_approval)
node bin/demo-outreach.mjs record-reply --email a@b.edu --text "..."   # replied; opt out too if the text asks
node bin/demo-outreach.mjs opt-out --email a@b.edu
node bin/demo-outreach.mjs mark-contacted --email a@b.edu             # reached by hand already
node bin/demo-outreach.mjs status
npm test
```

Set `DEMO_OUTREACH_STATE_DIR` to a folder that persists (for example `/workspace/demo-outreach-state`) so the ledger
survives a fresh checkout.

## Send mode (off by default)

```
DEMO_OUTREACH_MODE=send DEMO_OUTREACH_SEND_ENABLED=true \
  node bin/demo-outreach.mjs send --transport /path/outside/repo/transport.mjs --confirm
```

The transport module exports `async send({ to, subject, body, fromName, fromEmail })` and returns `{ messageId }`.
Safeguards, all enforced in code and covered by tests:

* At most **5 sends per run**. `DEMO_OUTREACH_MAX_PER_RUN` can lower it and never raise it.
* **One initial email per person.** Any earlier `send_attempt`, `sent`, `send_failed` or `contacted` row blocks a second letter.
* **No automated follow ups.** There is no follow up template or command.
* **Skip anyone who replied or was already contacted**, and **honor opt outs** (manual, or a reply that says
  unsubscribe, remove me, stop emailing and similar).
* **Every send is logged**: `send_attempt` before the transport call, then `sent` (with message id) or `send_failed`.
  A failed send is not retried automatically.
* Only `list: "send"` candidates with a verified, published email are ever eligible.

Matthew's standing auto send permission covers McCluster Corp event photography outreach only. Turning on send mode
for this audience needs his explicit approval of the list, the target and the text first.
