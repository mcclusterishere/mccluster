# Paid student opportunity discovery (owner pilot)

This is a **disabled-by-default review feed**, not an automatic application or
outreach agent. The first pilot watches the U.S. Department of Energy's
[Science Undergraduate Laboratory Internships](https://science.osti.gov/wdts/suli)
and [Community College Internships](https://science.osti.gov/wdts/cci).
Signals are open announcements with a future official deadline and positive
statement that the program is paid. This pilot does not verify the user's GPA,
enrollment, eligibility, placement availability, remote status or stipend amount.
CCI requires community-college or accredited two-year-college enrollment.

The fixed public allowlist is in `core/src/student-opportunities.mjs`.
The observer reads robots then at most two exact official HTTPS pages, once per
day, sequentially. It refuses unknown policy, redirects, authentication, caller
URLs, unexpected media types and over-cap responses. It sends no private data,
parses no third-party links, posts no messages, and neither saves the HTML nor
lets it influence Core instructions. If the source or announcement format is
unavailable, the receipt says so instead of saying there are no opportunities.
Dates are parsed as America/New_York, with zero results for expired terms.

## Rehearse without launching the scheduler

- From the repository root, `node --test core/test/student-opportunities.test.mjs`
  runs isolated tests including the real Core runner against a temporary
  simulated queue and intercepted source responses.
- `node core/src/student-opportunity-cli.mjs --live-read` uses those three
  public reads and prints the structured preview. It never contacts the DB.
- Inspect `student_opportunity_snapshot` results through the existing owner
  `ops_agent_jobs` inspector. A completed job means a discovery receipt was
  recorded; consult `state` before interpreting an empty result. `known`
  carries a bounded, stable digest per program/term so repeated rows are
  `unchanged`; corrected deadlines are `updated`. No publication or owning
  application state is represented by a receipt.

## Release gates

No schema, API permissions, app UI, model call, paid service, application,
automated outbound message, or change to any other opportunity watch.
The timer is not in the deploy enable list, and the seed and executor both
require `MCCLUSTER_STUDENT_OPPORTUNITY_DISCOVERY=true`. Only an approved operator
may enable both in a promoted release. Run a read-only canary first, verify the
owner-job receipt and exit codes in staging, then decide whether it should
replace, rather than duplicate, any existing reminders. Do not enable
notifications just because a source changes. Stop by disabling the timer
and removing the flag; existing receipts remain available.
