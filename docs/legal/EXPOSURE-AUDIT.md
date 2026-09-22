# Where McCluster is exposed, and what to do about it

Audit of 22 September 2026, against the live database and the repository.
Ordered by what would actually hurt, not by how alarming it sounds.

---

## SECURITY: what was found, and what is now true

### Fixed today

**`public.leads` accepted unlimited anonymous writes.** The policy read
`for insert to {anon, authenticated} with check (true)`. Literally
`true`: anyone on the internet could insert any number of rows, of any
size, claiming any pipeline status, forever.

It was never a *leak* — nobody can read leads back without being the
owner — but it was a write amplifier: a spam sink filling the CRM the
front desk works from, and a metered storage bill.

Now constrained, modelled on `eu_perspectives`, which already had the
right shape: `status` pinned to `'new'` so a stranger cannot place
themselves in the pipeline, length ceilings on every field, and an email
that has to look like one. **Verified against the live policy**: a
genuine lead is accepted; a forged status, a 50KB note and a junk address
are all refused.

### Checked and found sound

**No table is readable or writable by an anonymous caller without RLS.**
Around thirty tables have grants to `anon` but RLS enabled with zero
policies, which is deny-all — the safe failure mode. The grants are
inert.

**Every `{public}` policy gates on identity.** `is_org_member()`,
`is_org_owner()`, `eu_is_admin()`, `current_m_uid()` or `auth.uid()` —
all null or false for an anonymous caller, so those policies are
effectively authenticated-only. `leads` was the single exception.

**No secrets in the tree.** Everything matching a credential pattern is
either an env-var *name* (`Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`)
or an obviously fake test fixture (`'do-not-leak-this-value'`,
`'edge-secret-for-tests'`). `.gitignore` covers `.env` and `.env.*`, and
no `.env`, `.pem` or `.key` is tracked.

**The two `SECURITY DEFINER` views are correct as they are.**
`v_track_signals` and `v_track_affinity` are flagged generically by the
linter. They aggregate private `events` into public rankings, so
bypassing RLS is the entire point, and their output carries no
per-person column — `track_key, score, position` and nothing else.
Checked column by column.

### Still open, needs a decision

**Leaked-password protection is off** in Supabase Auth. One toggle
(Authentication → Policies) and it checks new passwords against known
breach corpora. No downside; turn it on.

**`INTAKE_ENDPOINT` still points at a Google Apps Script**
(`js/analytics.js:39`). A live Google dependency in a system explicitly
moving off Google, and an endpoint we do not control receiving form
posts. Remove it or replace it with our own collector.

---

## LEGAL: the gaps that matter for what is being sold

### The serious one: no DMCA agent

**This is the largest single legal exposure in the system.**

McCluster hosts material uploaded by other people — creator music
through `creator_tracks` and `creator-masters`, posts and media on Mnet,
and soon entire client sites and their mailboxes.

Safe harbour under **17 U.S.C. §512(c)** — the provision that stops a
host being liable for what its users upload — requires a **designated
agent registered with the US Copyright Office**, plus a published
takedown address and a repeat-infringer policy. Registration costs
**$6** and renews every three years.

Without it, there is no safe harbour at all. One infringing upload by
one user becomes McCluster's direct problem, with statutory damages up
to $150,000 per work wilfully infringed.

**Do this before the next creator upload.** Register at
copyright.gov/dmca-directory, then publish the agent's details and a
takedown route.

### Needed before the first hosting or mail customer

**Terms of service and an acceptable-use policy.** Reselling hosting,
mailboxes and domains means handling other people's money, data and
content. Without written terms there is no agreed liability cap, no
stated uptime expectation, no payment terms, and — critically — **no
contractual right to suspend somebody**. The AUP is what lets you cut
off a client who starts sending spam from your IP, which is the exact
event that blocklists `mail.mccluster.org` and stops your own signup
confirmations landing.

**A data processing agreement.** For hosted mail and sites, the client
is the controller and McCluster is the processor. Under GDPR Art. 28 a
written DPA is mandatory, and CTDPA expects the equivalent. It also
protects you: it is the document that says a breach of *their* content
caused by *their* choices is theirs.

**A privacy notice covering customers.** `privacy.html` covers listeners
and, since today, hosted analytics. Customer billing, support
correspondence and account data need their own passage.

### Already sound

**Consent is unbundled and gates nothing.** A listener who ticks no
boxes still gets the full record. Conditioning a service on consent is
the part the state privacy laws actually prohibit, and it is avoided.

**GPC and Do Not Track are honoured**, in the browser and again server
side, on the house's own site and in Insight.

**Withdrawal works end to end**, and proof of unsubscribe is retained
deliberately so nobody can be mailed again by accident.

**Insight is disclosed** in section 10, and the paste-in block for
hosted clients lives at `docs/legal/CLIENT-PRIVACY-BLOCK.md`.

---

## The order I would do these in

1. **Register the DMCA agent.** $6, one form, and the only item here
   with six-figure downside.
2. **Turn on leaked-password protection.** One toggle.
3. **Terms + AUP** before the first hosting client, not after.
4. **DPA** before the first hosted mailbox.
5. **Remove the Apps Script endpoint.**
