# Three-path Action Network mission alignment — audit and implementation

## Decision
Action is a single mission lifecycle with three **participation paths**, not three disconnected products:
- **Create**: write/record a song, produce a beat, collaborate on a campaign recording. Evidence: credited recording, approved deliverable, rights and split documentation.
- **Amplify**: create clips, publish approved campaign footage, distribute a track or mission story. Evidence: linked content, approved usage rights and verified publication. Paid clipping remains `kind='clip'` with its own commercial ledger; civic points must not be awarded for views.
- **Show Up**: rally, volunteer, deliver supplies, organize community events, or document verified local work. Evidence: approved photo/video or organizer attestation; respect privacy and consent.

## Findings
- `action_missions` already has `kind` (commercial vs civic), `domain` (advocacy/creative/community/etc.), proof and status; these are not equivalent to a member-facing choice.
- `action_mission_assignments`, proof review and reward ledger already handle completion.
- `social_content_items.action_mission_id` and `action_mission_assignments.source_content_id` already trace creator content into verified action.
- `creator_tracks` and `music_catalog_objects` are referenced by clipping infrastructure.
- The Freestyle Containment Protocol was inserted by `20261003022730_action_mission_camera_loop_v1.sql`. One existing assignment means hard-deleting it would lose history. New migration closes it, not deletes it.
- Existing `docs/END-RACISM-TWO-PATH-CAMPAIGN.md` contains obsolete comedic copy; it is historical documentation, not the desired current mission catalog.

## Migration behavior
`20261013210000_action_three_paths.sql` adds nullable `action_path`, classifies obvious missions, leaves ambiguous education/research/business missions unclassified for review, and closes the unwanted mission. It does **not** automatically create fake campaigns or infer creative deliverables from titles. Existing `kind`, payout rules and verification stay intact.

## Next integration work
1. Replace mission discovery with three clear path filters. Unclassified missions go to admin triage rather than being guessed into a path.
2. Admin mission editor requires a path, deliverable, proof rubric, consent rules, and optional `creator_track_id` / `social_content_item_id` references.
3. Link campaign tracks and creator credits to Create missions; create clip tasks under Amplify, then in-person follow-ups under Show Up.
4. Use one `m_uid` identity across music, mission participation, creator attribution and cohort permissions.
5. Regression tests: civic points vs commercial payouts, proof/review idempotency, historical assignment visibility, campaign attribution, path filtering, and user access boundaries.

## Equity Uprise collaborators: claimable profile design
Do not fabricate accounts, assume permission to publish private contact details, or send invitations without verified recipients. Build a `project_contributor_claims` table referencing a project and an existing or pending canonical `m_uid`, with contributor display name, credited role, rights/consent state, expiring single-use claim token hash, claimed timestamp and audit history. The claim flow authenticates the recipient to an existing M Account or lets them create one, then attaches project credits to that identity; it must never create a second artist handle. Admin reviews contributor identity and credit before publication. Collect verified names, roles and invitation destinations from Equity Uprise credits/contracts before issuing links.

## Product language
**Create music. Amplify the message. Show up for the mission.**
