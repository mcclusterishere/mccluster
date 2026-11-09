# Organization records and reporting architecture

This is bounded backend recordkeeping, not a running autonomous corporation.
`organization.js` extends the authenticated company aggregate through the shared
contribution-ledger reducer. The existing company event store and SQL transaction
remain authoritative. No new database, identity system, scheduler, job queue,
provider registry, payment adapter or executor is introduced.

## Current ingress and authority

**Only the canonical authenticated company owner can use the service today.**
Member sessions and AI agents cannot enter this service. Daily entries are
explicit owner transcriptions of a seat's reported work, not authenticated
statements by that seat. `principalRef` is an owner-asserted internal reference,
not an established user identity or a grant of permissions. `human` comes only
from the existing server authorization resolver, never command JSON.

A human owner records the initial operational CEO mandate with immutable evidence.
That mandate records responsibility for setting operational direction; it does
not appoint a legal officer or prove legal authority. Only that human sponsor
can define roles, assign seats, set campaigns/milestones, link canonical work,
review entries and record report revisions. AI seats are agents, never legal
persons. Mandate transfer, successor appointment and mandate revocation are deliberately
unsupported until a canonical owner succession workflow is specified. Revoking
the canonical owner session still blocks ingress through the existing service;
there is no separate organization command that changes that authorization. Review of one's own seat is rejected, including
when the owner occupies that seat. Human review approves a reported output only;
it does not confer legal status, certify job execution or distribute funds.

## Event commands

Every command has exactly `id`, `type` and `data`. All data shapes are exact;
unknown/missing fields fail. Object versions use `expectedVersion` starting at
zero; references must name the current version. Failed commands leave the
organization untouched. The outer reducer adds scope, revision and immutable
audit metadata. The existing service provides idempotency and compare-and-swap.

| Command | Data fields |
| --- | --- |
| `org_record_mandate` | `evidenceIds timeZone` |
| `org_define_role` | `id expectedVersion title jobType responsibilities capabilityIds` |
| `org_assign_seat` | `id roleId roleVersion principalRef principalType replaces reason` |
| `org_set_campaign` | `id expectedVersion title purpose startDate endDate` |
| `org_set_milestone` | `id expectedVersion campaignId campaignVersion roleId roleVersion title acceptanceCriteria dueDate` |
| `org_link_task` | `id milestoneId milestoneVersion assignmentId objectiveId jobId` |
| `org_submit_daily_entry` | `id assignmentId milestoneId milestoneVersion taskLinkId workDate timeZone summary status evidenceIds supersedes correctionReason` |
| `org_review_daily_entry` | `id entryId decision evidenceIds reason` |
| `org_record_weekly_report` | `id weekStart timeZone asOf` |

Role responsibilities, job type and capability references define specialized work.
Milestone acceptance criteria are specific to a role version and campaign version.
Revision records append; they never erase the previous role, campaign, milestone,
seat, entry, review or report. Replacing a seat names its previous assignment and
retains both identities. New work must reference current definitions. A daily
entry retains its historical role/campaign/assignment references.

`principalType` is `human` or `ai_agent`. A first assignment has `replaces: null`.
An optional `jobId` or `taskLinkId` uses explicit null. Daily `status` is
`submitted` or `blocked`. A new entry has `supersedes: null` and
`correctionReason: null`; a correction names an unsuperseded entry for the same
seat, local date and time zone with a nonempty reason. A corrected claim loses
its previous review in the current report and needs its own review. Reviews use
`approve_report` or `reject_report` and require evidence. Approved entries need
work evidence, and approved AI reports additionally need a linked canonical job
reference. Blocked entries cannot be approved. Replacement-day work cannot be
newly attributed to the old seat: the daily granularity intentionally requires
owner reconciliation instead of guessing intra-day attribution.

Evidence IDs must resolve uniquely inside this company's immutable documents or
shared ledger evidence. Ambiguous/missing/cross-scope references fail. Artifact
hash and scope verification stays at the existing authenticated service boundary.
An artifact hash proves stored bytes, not truth or execution.

## Canonical work and future collaboration

Task links refer to `ops_objectives` and `ops_agent_jobs`. These are explicitly
**unverified references**; clients cannot supply trusted completion receipts,
claim a cross-tenant job as verified, or make assignments count as execution.
`organizationWorkProposal(state, taskLinkId)` emits a dry-run proposal for the
existing Core, with capability IDs and milestone acceptance criteria. It never
creates a job, grants authority, schedules delivery or executes work. Stale role,
campaign, milestone or assignment references block new proposals.

Future member/AI collaboration must use the existing authorization plane with
server-resolved seat identity and scoped capabilities. Future Core integration
must resolve objective/job IDs in the authenticated organization and company,
resolve active capabilities through the existing registry, apply Core plan policy
and require completion evidence from an actual executor using
`core/src/completion-evidence.mjs`. It must check the execution's assignment,
objective, result digest, evidence and success, not just a supplied job ID.
No such resolver is wired here. `verifiedCompletion` is always false and weekly
`verifiedCompletions` is always zero. Human review never overrides that boundary.
External communications, financial/legal commitments, production changes and
destructive actions retain their existing human approval requirements. AI actors
cannot self-approve or impersonate human legal officers.

## Reports and time

`weeklyOrganizationReport(state, {weekStart, timeZone, asOf})` is deterministic
and read-only. All three parameters are required. `weekStart` is an explicit
calendar date; no Monday/UTC assumption is made. The interval includes that date
and excludes the date seven days later. `timeZone` must be a valid IANA time zone;
the human mandate fixes the canonical organization reporting time zone, and
every entry and report must use that exact zone. Requests using another zone
fail instead of silently omitting entries. Inconsistent stored entry zones also
fail closed. There is no silent cross-zone day conversion or zone migration. Entry work dates cannot be in the future in
the specified zone, before the seat begins, or outside campaign dates.

`asOf` is a canonical UTC instant. Only entries, corrections and reviews recorded
at or before it are visible. A future correction does not rewrite an earlier
as-of report. Reports distinguish submitted claims, approved reports and blocked
work, always separately from verified completion. Reports retain company/org
scope, period, time zone, source revision, source entry/evidence references and
review provenance. Each report also includes the latest visible role definitions,
seat assignments, campaigns and milestones as of the requested instant, per-role
submitted/approved/blocked counts, `noEntries` indicators and `missingDailyEntry`
dates. Missing dates are elapsed calendar dates with an assigned seat, including
the as-of local date, not an attendance judgment: no working-week, holiday or
individual schedule is configured. Unassigned roles have no expected dates.
Stored report snapshots are immutable and have increasing
versions for the same period/zone. Re-recording identical source history produces
the same report content; merely storing another report does not change its
source revision. Nothing sends or schedules the report.

## Checks

Run `node --test workers/mccluster/test/company-organization.test.mjs`.
The tests cover human governance, blocked AI ingress/self-review, role and seat
history, scope/evidence failures, stale milestones, claimed versus approved
reporting, canonical job-reference boundaries, stable report revisions, local
time zones, correction history and disabled execution.
