# Action Network reward system v1

## Principle
Reward useful, completed, verifiable action — never ideology, outrage, likes, views, or raw posting volume.

## Mission award
For a verified mission:
`award = round(base_points × difficulty_factor × proof_confidence × impact_factor × collaboration_factor × repetition_factor)`

Initial bounded factors:
- difficulty: 1.0, 1.15, 1.35, 1.6, 2.0 for levels 1–5.
- proof confidence: 0.5 pending/weak, 1.0 verified, 1.1 independently corroborated.
- impact: 0.8–1.5, assigned from a mission rubric before launch; never retroactively based on political agreement.
- collaboration: 1.0 solo, up to 1.2 when the mission explicitly requires meaningful teamwork.
- repetition: 1.0 first completion; then 0.7, 0.4, 0.2 for substantially identical repeatable work.

A mission award is idempotent: one `mission` ledger entry per assignment.

## Consistency
Consistency bonuses reward returning to useful work, not maintaining a daily-login compulsion. A streak advances when at least one verified action occurs within a rolling weekly cadence. Missing a day does not erase progress. Cap consistency bonus at 15% of verified mission points in a 30-day window.

## Recruitment
No points for signups. Referral credit becomes eligible only after the referred member completes a verified mission. This prevents invite farming.

## Cohorts
Cohorts have shared goals. The product emphasizes collective completion percentage and verified outcomes, not a permanent global ranking. Individual leaderboards are opt-in and campaign-scoped.

A cohort seat is given, not taken. Accepting a fellowship application makes someone a fellow of the network; it does not seat them in any program's cohort. The desk seats an accepted fellow in a cohort that is still `active` with `admit_fellow_to_cohort(application, cohort)` (Control · Action Network · Fellowship). The server refuses anyone who is not an accepted fellow, refuses a closed cohort and refuses self-admission, and a second admission is a no-op. The seat then shows in the member's Action Record. The first such cohort is the Equity Uprise cohort of policy writers; its group is the cohort group for people who want to become Equity Uprise cohort policy writers, with the Docket 516R record as its front page. They are live in production via `supabase/migrations/20261005054036_equity_uprise_group_docket_516r.sql` and `20261005054040_action_cohort_admission_v1.sql`.

## Skills
Verified missions can increment declared mission skills. Skill XP comes from the mission award allocated across its skills. Self-declared skills do not create XP.

## Proof and review
Proof can be video, photo, link, text, or artifact. Mission authors specify acceptable proof before launch. Review decisions and point adjustments must be auditable. Rejected proof earns zero points and must expose a reason to the participant.

## Safety and integrity
- No points for political viewpoint, candidate/party support, persuasion success, or ideological conformity.
- No points for likes, impressions, comments, watch time, or outrage.
- No rewards for dangerous, illegal, harassing, deceptive, or invasive actions.
- Rate-limit repeatable missions and flag suspicious proof reuse.
- Do not expose precise participant location through public scoring.
- Every score must be explainable from ledger entries.

## Product loop
Understand → Choose → Act → Prove → Verify → Progress → Collaborate.

Music uses the same loop:
Listen → creator/initiative → mission → proof → verified impact.
