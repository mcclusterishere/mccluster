# Unfinished work, saved as patches (2026-11-23)

Each patch is `git diff --binary` output against the base commit named here. None of them is applied anywhere.
Apply one in a fresh worktree on its base (`git apply --3way <patch>`), then port it to the current branch head;
the code moved since, so expect conflicts. Each was unfinished when saved: read it, test it, and finish it with the
usual evidence (tests failing before and passing after, the suites, CI) before it ships.

| Patch | Base | What it is | State when saved |
| --- | --- | --- | --- |
| `QW-quick-wins-snapshot.patch` | `5d8c533e` | The music quick wins Q1 to Q7 (see `../CODEX-HANDOFF.md` 3.B): code and tests. | Built and self-tested; final browser runs were in progress. Superseded if the quick-wins commits reached `claude/new-session-83ken5`. |
| `S6-shared-selection-time-cursor.patch` | `a5e16021` | Environmental timeline S6: one selection shared by the globe and the feed, a time cursor, replay driving the cursor. Design: `docs/control-plane/EUP-EVENT-TIMELINE.md`. | Partly built (director and cursor modules started; tests not finished). |
| `B2-drawdown-source-page.patch` | `a5e16021` | The Project Drawdown source page in the World (`js/world-source-profile.js` hooks, records, e2e). | World hooks partly built; e2e, CI entry and records not finished. The 87 quotes removed in PR #819 are restored separately (Matthew attested the permission in person on 2026-11-23). |
| `M6-creator-studio-publishes.patch` | `fc001103` | Creator Studio publishing (live review publish with hash, analytics on creator.html, managing pending releases, the studio door). | Fix in progress. |
| `M6-tests-at-base.patch` | `fc001103` | The failing tests written first for the patch above. | Tests only. |
