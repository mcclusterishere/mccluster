# Matthew's directions, 2026-11-23 ~17:15 UTC, and the work plan

Source: Matthew's message in this conversation (a real user message). He asked for plain words
("Half of the shit you're saying I don't get") and fewer questions ("anything I confirm, get it done").
Write to him in short plain sentences, no codes (no D-5, M3F, RF-1), one question at most when unavoidable.

## Production steps he approved (verbatim)
- "Apply the connections fix."  -> consent guard SQL (running: workflow prod-approved-sql-20261123, wf_91f6e610-4d5)
- "Approve the last 3 EUP database changes." -> Environment parts 03-05 (same workflow)
- "Switching the module on for sure, alright?" -> environment module on (same workflow; may need his tap)
- "I confirm drawdown's permission for the quotes on their page. That was a conversation that was had in person."
  -> record the attestation (same workflow); next: restore the 87 quotes removed in PR #819, apply the source
     table, finish the Drawdown page (B2 WIP patch in scratchpad/wip-20261123/).
- Shipping music to the live site (PR/merge/deploy) was NOT explicitly approved: ask once, simply ("say ship it").

## Music: what he wants (his words, then the reading)
1. ONE engine, ONE player, everywhere, "just like the Apple Music app... no matter where I go, the shit is still playing".
   - "I want a singular fucking music engine with 1 fucking player at all times" -> the album page must not keep its own
     deck player; the World's songs are the regular songs, same engine. (Rejects M5 stage 2's "two players share one bar".)
   - World: "if the world starts a song and then you shift over to the music engine, the song should still be playing";
     the World's bottom tab becomes the music bar (pause, previous, next), "randomized" (shuffle the catalogue);
     choosing an album in Music replaces the shuffle; otherwise "it'll just continue to play no matter where you go".
   - Mute: "I don't want you to separate the muting from the world songs and the regular songs" -> one mute (reverse D-7).
   - M5 answers: keep the navigation (yes); after sign-in go back to the music you were playing (yes); album keeps
     playing too (yes); Google/Apple sign-in ending the song is NOT okay (use a popup or equivalent so the song keeps
     playing); fix the Sign in chip over the Now sheet's Album link (yes); World links (he did not follow; his World
     words above mean: yes, keep playing from the World into Music).
   - Album end: "2, end of the album, and just leave" -> read as: an album stops after its last song (state this
     reading to him; he can correct). Shuffle from the World keeps going.
   - Bar's Music button pauses everywhere (one player); the installed dock shows one Pause, not two.
2. Creator side: "I cannot upload a full album"; "the interface looks like pure garbage... not sexy, fancy, or smooth";
   "it still tells you, hey, join as a creator, even though you have a creator's account" -> creator awareness everywhere,
   album (multi-song) upload, a beautiful Creator Studio (Mobbin references, mobile first), lyric control after upload,
   collaboration with full track-outs (after the connections guard is live).
3. "so many different tiny little granular details" in the music UX -> a granular UX sweep (audit and fix), Heal-link style.
4. Background while playing: replace the red pulsing cloud with the universe: "a beautiful cesium ion globe in the
   background floating and spinning... spinning to the beat, pulsing to the beat"; "the most accurate depiction of our
   universe and our solar system... stars and planets react to the beat... like its own equalizer"; not interactive.
   (Drive it from data/peaks, not Web Audio, so background playback on iPhone stays safe; reduced motion; pause when hidden.)
5. One McCluster profile: "McCluster has two profiles. One says the house, one says the artist. It needs to be one profile.
   McCluster is the artist."
6. Categories: "the albums need to be just fucking albums... We don't have enough music to even have playlists right now.
   So just list albums and artists right now."
7. Covers: "The full covers aren't shown, and I agree. We should fix that" + "as long as everything's uniform" -> whole covers,
   uniform squares.
8. The closing song on CIA Mind Control (title contains a slur; call it "the closing song"): "We keep the song up, but it
   won't play... sign in... it still won't play. Then they have to fill out a psychological form, give us their full
   address, their full number, their name... The profile must be filled out before it even plays... it'll tell you why it
   won't play when you try to click play. It needs to pop up and say, oh, you need to fill out the rest of your profile."
   -> now: no preview for anyone (owner keeps his own play), a popup explaining why; later: sign-in + full profile
   (name, full address, full phone) + a short questionnaire -> then it plays (owner-only storage of that data; new SQL).
   Also "if somebody wants to download [it], they have to get a psychological evaluation... we'll do that later".
9. Silence: "Make the song engine recognize when there's a super long end that has no... just silence and nothing after
   it, and clip it" -> trim long silent tails (build-time from audio/peaks), show the trimmed length, count listens on it.
10. Measurement: "For 6, I approved them" -> music_interrupted (and the would-not-load event) approved: remove the hold,
    add rows to the measurement dictionary.
11. Device checks (#7): he did not follow; give him a 5-step plain checklist when something is live to test.

## Status 2026-11-23 17:45 UTC
- Applied from the main session (Supabase MCP needs a person to confirm, so unattended workflow agents cannot apply):
  20261123173626 network_connections_consent_guard_v1, 20261123173831 eup_environment_events_v1_03,
  20261123173951 _04, 20261123174034 _05; each stored statement = the file minus its final newline (md5 checked). Ledger 384.
- Recording them + the Drawdown attestation: workflow prod-record-20261123 (wf_4f54bd18-ee1, task wkz4cpxzq).
- Module on still needs: Matthew in Control (System > E=Up > Environmental events > Sources > USGS "Set the default rule",
  later Overview > Modules > Environment > Install, then Enable) and the Worker variable
  EUP_ENVIRONMENT_USGS_INGEST_ENABLED="true" (workers/mccluster/wrangler.toml) through a PR + merge + deploy:
  asked him to say "ship the feed switch" (a separate small PR, not the music work).
- M5 build pushed (2000c609, 5d8c533e); M5 workflow stopped before review (stage 2 two players rejected).
- Running: music quick wins (wf_2a64452f-49b, task wqj4pi8i5): Q1 one McCluster profile, Q2 albums+artists only, Q3 whole
  covers, Q4 creators never asked to join, Q5 the closing song locked + pop-up, Q6 albums stop at end, Q7 approved events.

- 18:40 UTC: records done and verified (prod-record-20261123: commits 30503182 Drawdown attestation, 0ef1481c ledger 384;
  no mismatch). KNOWN REGRESSION from M5's build (2000c609): workers/mccluster/test/analytics-creator-attribution.test.mjs
  fails "MCC_PAGE_IDENTITY is not defined" (passes at dc0185aa, fails at 5d8c533e). The one-engine slice must fix it and run
  the WHOLE Worker suite (the QW slice does not run it).

- 18:45 UTC: one-engine SPEC running read-only in parallel (music-one-engine-spec, wf_34ff0c7c-6e9, task w8nbqw35v) ->
  scratchpad/musicbuild-20261123/SPEC-ENGINE.md. After quick wins verify, launch the one-engine build workflow from it
  (build in stages, two review lenses, fix, verify; include the analytics regression and the whole Worker suite).

- 18:35 UTC Matthew: "ship it all baby" (real user message) = approval to ship finished, checked work + the ingest switch.
  Release 1 (running: release-20261123, wf_ab34ac47-bd2, task wh0rdvyfx): branch claude/release-20261123 from dc0185aa
  (M3 + M3 follow-up, verified) + cherry-picks 30503182, 0ef1481c + ingest switch "true" + release notes; every PR check
  locally; independent go/no-go. THEN the main session: create the PR (base main), watch CI (subscribe_pr_activity),
  merge when green (merge commit), check the deploy (GET /v1/health deployment_sha, pages), tell Matthew his Control taps.
  Release 2 later from claude/new-session-83ken5: quick wins (after verify) + M5 made dormant or finished + analytics fix;
  merge main back into the working branch after Release 1 merges (cherry-picked commits; expect a clean merge).

- 18:40 UTC Matthew: "the bar at the bottom used to be smaller and have the feature where the music would all be on the
  bottom bar with back and forward buttons on either side of the bottom bar added on with the music details and more. i
  liked that design a lot." -> restore that compact integrated bar as THE one player's controls everywhere (Music and World)
  in the one-engine build. Read-only archaeology running: music-bar-history (wf_966a512b-b7c, task wcb4ish4w) ->
  musicbuild-20261123/BAR-RESTORE.md + shots/bar-history/bar-then-and-now-390.png (send that image to Matthew).

- 18:45 UTC Matthew relayed a reel (VPS + Cloudflare Tunnel + closed inbound ports + Tailscale; Railway and Tailscale
  incidents; PHP bug) and asked: "I want to understand how that relates to us and how much of that we can start owning,
  like Tailscale... We need our own version of everything he's talking about that's private and owned by us."
  Research running (read-only): owned-private-network-research (wf_4f0f6b4f-f63, task w7oqrtjbz) ->
  scratchpad/security-20261123/OWNED-NETWORK-PLAN.md (plain-words section for him; phases need his go-ahead to change servers).

- 19:15 UTC Matthew answered the engine spec's three questions:
  1. "let's just have the whole site on mccluster.org instead, and matthew.mccluster.org be my profile, my personal
     profile... like we have tenancy... the tenant to the site would be matthew[.mccluster.org] for McCluster, who is the
     artist" and "the real shit should be equityuprise.com... We must prepare without breaking anything to do that."
     -> platform domain move (law change to hard rule 15 etc.); spec running read-only: platform-domain-tenancy-spec
     (wf_bf59ce79-fb7, task w00j4q5uv) -> musicbuild-20261123/SPEC-PLATFORM.md. Build it AFTER the engine build.
     The engine build drops the cross-host hand-over (W8): one origin makes it unnecessary.
  2. "Everything should be running on the player, every page, the front page, back page" -> index.html joins the one
     player (Matthew named the front page, so hard rule 3 allows it).
  3. Shuffle plays count as plays (listen ledger), and "If you go to the world... and click on the globe and you're
     already playing a song, it shouldn't change the song you have or the order of the songs you have."
  SPEC-ENGINE.md is written (stages 0-4). Engine build launches after quick wins verifies, with these answers folded in
  and BAR-RESTORE.md for the bar.

- 20:10 UTC bar history done: the bar he likes = PR #820's compact bar (382301d3), live ONLY in the installed app;
  Safari still shows the big capsule + strip. BAR-RESTORE.md = that bar on every page (browser + installed), one
  Play/Pause (the red Music tab), Previous + song line left, Next + Sound right. Comparison image sent to him.
  RELEASE 1 CAVEAT: it carries 73349a06 (M3F F8/F10), which on the installed app's Listen page adds a second Pause
  (the Music tab) beside the dock's own and grows the dock to two rows during status words. Before opening the PR, run a
  small release-dock fix on claude/release-20261123: installed dock keeps one Pause (Music tab stays navigation where the
  dock has its own Play/Pause) and shows status inside the song line (one row, 46 px); tests; re-run installed-app,
  background, now-playing suites; then PR.

- 20:15 UTC Matthew on the comparison: "ok great. I like the before tab at the bottom it looks way better." -> build
  BAR-RESTORE.md's bar (the Before look) on every page; he did not object to the one change (red middle button = the
  one Play/Pause; right side Next + Sound).

## Order (one music workflow at a time; lean agents)
0. Now: production steps (running). M5 build finishing (stop the workflow before its reviews; task b4ybefen4 waits for it).
1. Quick wins: one McCluster profile, albums + artists only, whole uniform covers, creator awareness ("join as a creator"
   never shown to creators), the closing song unplayable with the popup, album stops at end, approved events.
2. One engine everywhere (spec first): album through the one engine, World shuffle through the same engine with the music
   bar, one mute, sign-in returns to the music, provider sign-in without ending the song, chip over the Album link,
   World links keep playing, one Pause in the dock, the Music button pauses everywhere; review M5's shell with it.
3. Creator Studio v2: album upload (batch intake via the existing submission path), beautiful UI, lyric control.
4. Universe background.
5. Silence trim.
6. The closing song's full gate (profile + questionnaire + SQL; production SQL apply after his go-ahead at that time).
7. Collaboration v1 (needs the connections guard live).
8. Granular UX sweep.
Then Drawdown quotes/page, E=UP S6-S8 (patches saved).

- 20:50 UTC: platform spec done (musicbuild-20261123/SPEC-PLATFORM.md; stages P0 prepare, P1 serve everything, P2
  canonicals, P3 Matthew's Cloudflare steps, P4 clean-up, F equityuprise.com). Owner defaults taken for its five
  questions (told to Matthew; his to change): his host keeps opening on HERE; his person pages stay on his host;
  AI-crawler policy per host unchanged; humanuprise.com 301s to the platform when routed; the app added from
  mccluster.org opens on the World. ORDER (spec section 5): P0 now, parallel with engine stages 0-1 (engine owns
  tabbar, music-shell, world-audio-continuity, music-engine, installed-app-dock, now-playing, listen, album, index);
  P1 before engine stage 2; P2 with engine stage 3; P3 when Matthew has ten minutes in Cloudflare.
  Running: platform-p0-20261123 (wf_8334be8c-5cb, task woq6qw4br), pushes to the working branch after its checks.
  Running: release-dock-fix-20261123 (wf_afce42e8-1e5, task w7d4h0loz): local branch release-dock-fix, not pushed;
  one Pause in the installed dock (the red Music tab where the page makes it the transport; the dock's own elsewhere),
  Muted in the artist line (one row), trouble states keep the status row (BAR-RESTORE 4.4).
  Disk: removed 19 old worktrees (~9 GB); their uncommitted work saved in scratchpad/wip-archive-20261123/ (INDEX.txt).
