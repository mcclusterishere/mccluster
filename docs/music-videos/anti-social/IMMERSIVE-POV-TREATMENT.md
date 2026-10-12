# ANTI-SOCIAL — immersive POV music-video treatment
**Status:** Creative treatment / production brief, not filmed or implemented
**Owner:** Matthew McCluster · **Project:** Anti-Social interactive music video
**Last captured:** 2026-10-12
**Primary home:** Unlisted Anti-Social Studio prototype `anti-social-studio.html`
**Audience:** Matthew, director, 360 camera operator, editor, AI video/VFX agent (Higgsfield or alternative), WebXR engineer

## Creative north star
A viewer enters a peaceful, first-person immersive environment and finds a **virtual phone** floating/held within their field of view. They can *look at it* and scroll it with their finger. The phone is the temptation; the natural world is the alternative. The artist's vocal can function like the viewer's internal monologue. The experience should reward looking up, being present, and exploring the environment rather than forcing scrolling.

**Latest chosen treatment supersedes earlier brainstorming about a dorm, bar, balcony, or lying under a pine tree:** Matthew sits cross-legged, meditating outdoors in nature, facing the 360 camera. Eyes closed; he briefly peeks one eye open at “Scroll slow, homie,” closes his eyes with a knowing smile at “trying to farm dopamine,” then begins rapping directly to the viewer. At “If it sounds like you, I guess I really know you,” he rises from meditation and **physically picks up the camera**. The camera becomes the viewer's body/point of view and the pickup becomes the first portal transition.

## Narrative sequence / shot intentions
Timecodes are **lyric cues**, not locked seconds. Confirm against the master audio before shooting.

### Scene A — Nature / meditation / scroll interruption
- Setting: outdoor grass and trees, calm daylight, beautiful natural ambience, preferably quiet enough to record guide audio; shoot final vocal separately if needed.
- Camera: Insta360 X5 (user-specified), positioned at the viewer's eye line in front of seated Matthew. Camera support must be stable and removable/painted out; avoid setting the lens too close to his face. Record clean 360 plate and performance passes.
- Viewer: virtual phone at comfortable reach in the lower-forward field of view; can tap/drag to scroll. Looking up reveals nature and Matthew. No phone prop needs to be baked into the 360 plate.
- Performance: Matthew meditates eyes closed; peeks one eye on “Scroll slow, homie”; eyes closed/smile on “trying to farm dopamine”; begins direct-to-camera performance as the verse continues. Delivery feels observant, funny, intimate, not scolding.
- Camera transition: on “If it sounds like you, I guess I really know you” / subsequent lyric cue, Matthew reaches forward and picks up the 360 camera, turning a stationary observer into a moving companion. Record a pickup take with a safety tether and stabilization tests.

### Scene B — Movement / church / conversions
- Match-cut from the camera pickup into Matthew moving with the viewer; wardrobe may change to signal a new chapter.
- Lyric cue: “The only way to beat it is to own it. So if you're gonna be on here, follow me to where the dough is.”
- Matthew approaches/enters a church or church-like location **only with location permission**. Lyric cue: “If you're here religiously, just know this: I can help you get more conversions than the Pope did, for show, kid.”
- Visual gag: at “for show, kid,” Matthew almost drops the viewer/camera, or performs a **controlled simulated fall**. Do not drop the actual X5; shoot a separate cushioned plate or composite the fall digitally. Preserve orientation/motion continuity for a believable transition.

### Scene C — Office / refocus / coaching
- Match-cut from the falling/tilting camera into a new scene where Matthew **picks the viewer up off the floor in an office**.
- Lyric cue: “Life is a blur when you're trying to get focused. That's why I offer coaching to get you back focused.” Exact wording to be verified against the recording.
- Matthew moves to a computer and types; show an interactive work surface and a clear optional coaching CTA. The viewer can inspect the office and choose to engage or ignore.
- Additional scenes/ending remain undecided. Do not invent canonical lyrics, wardrobe, church, office, or scene count.

## Timing and canon-event revision (2026-10-12)
- Repository source `data/lyrics/antisocial.json` declares `duration_seconds: 176` (2:56). This is lyric metadata, not independently verified audio-container duration; verify against the master audio before locking edits.
- **Cadence:** target decisions every ~15 seconds, not every 7. Offer approximately 11 decision opportunities over the track; move exact prompts to lyric-safe moments instead of imposing a rigid grid.
- **Canon events:** reconverge after approximately every second decision (~30-second story chapters). Canon includes the meditation, camera pickup, church, controlled fall and office pickup; these are not branch alternatives.
- **Narrative logic:** Social/Anti-Social choices change the immediate outcome and persistent state; the next canon beat is shared. Persistent state may still alter dialogue, camera viewpoint, overlays, wardrobe or the ending.
- **Math:** 11 binary choices = 2,048 possible choice sequences, **not** 2,048 required videos. With shared canonical scenes and two variants per decision window, a baseline could use ~22 branch variants plus canonical footage and reusable overlays, subject to the actual edit.
- **Canon candidates:** meditation/one-eye peek; artist picks up viewer/camera; church/conversions; controlled drop; office pickup/coaching; ending/CTA. Exact ordering and spacing must be confirmed from the lyric timing; some may be grouped into one canon event.
- **Missed prompt:** choose a safe default consistent with the selected experience mode, and log that it was auto-resolved rather than user-selected. Social camera-recording consent remains independent of narrative choices.

## Canon-first video switching (revision 2026-10-12)
**Corrected creative rule:** meditation, camera pickup, church, controlled fall, and office pickup are **all canonical events**, not optional branch alternatives. They happen in the baseline film regardless of listener input. The choice matrix only temporarily switches the displayed video treatment to a social or anti-social alternative at a decision point, then returns to canonical footage at a planned rejoin. Do not multiply full-song shoots into a tree.

**Lyric-source audit:** `data/lyrics/antisocial.json` contains `duration_seconds: 176`, 34 nonempty lyric lines, approximately 476 words and 34 line-timing objects. The existing described nature → church → office story covers approximately the first 53 seconds; the remaining ~123 seconds need a separate creative storyboard. The final lyric timing ends near 157 seconds, leaving ~19 seconds after the final timestamp (potential outro; verify against audio).

**Proposed timeline, subject to source-audio confirmation:**
- 0–17s: meditation, scrolling, eye peek, dopamine; canonical.
- 17–31s: social-vs-anti-social experience choices and reactive lyrics, returning to canon.
- 31–39s: camera pickup and “own it / follow me”; canonical.
- 39–44s: church and conversions; canonical.
- 44–53s: controlled camera fall → office pickup → coaching; canonical.
- 53–70s: repeated fee/belief hook; potential branchable overlay/scene variants.
- 70–105s: consultation, profile optimization, creating content and overcoming procrastination; **new material requiring creative decisions**.
- 105–123s: repeated fee/belief hook; potential branch variants.
- 123–139s: instrumental or untimed gap according to lyric metadata; verify.
- 139–157s: closing fee/belief refrain; canonical ending candidate.
- 157–176s: outro or untimed material; verify audio.

**Branch implementation:** preserve a single audio clock and one canonical film as the fallback. For each choice, play a time-aligned variant clip or render an overlay/effect for a bounded window, then rejoin canon. Make missing/late selections non-disruptive. The exact number of choice points should be decided from lyric and edit structure, not forced to exactly 11.

## Interactive story rules
1. **Social mode:** viewer separately opts into camera reaction recording. Eventually may see their own silhouette/visual presence in the scene. Recording must require explicit consent; no camera/audio upload by default.
2. **Anti-Social mode:** camera is used **locally for head-tracked parallax only**, with no reaction recording, uploading, biometric enrollment, or emotion inference. Provide no-camera touch/drag fallback.
3. **Virtual phone:** scroll by touch on mobile; in headset, implement a controller/hand-tracking ray or pinch gesture when supported. Head gaze selects/focuses, not scrolls by itself. The phone is a composited 3D interactive object, **not** a prerecorded phone screen.
4. **Branching:** offer social vs anti-social narrative actions near lyric cues, approximately every 15 seconds where dramatically appropriate, with rejoining of the canonical footage at each planned scene boundary. Branching is a reconverging scene graph, not an exponentially expanding set of unique videos. Canonical story beats preserve the core narrative regardless of prior choices; intervening branches can change perspective, interaction and scene variants. Musical audio never restarts on branch selection. Missed choices follow an explicit default.
5. **Reactive lyrics:** synced words or phrases become in-world prompts, never obscure Matthew's face or important scene action. Offer reduced-motion and captions.
6. **Telemetry:** playback clock, scene exposure, offered choice, selected choice, time-to-choice, interaction type, seek/replay, and dropoff. Avoid transmitting camera pixels or face landmarks in private mode.

## Production architecture
**Capture:** 360 X5 masters (camera-original, max practical resolution, locked exposure/white balance for matched takes), separate clean audio master, room-tone/ambience, continuity photos, calibration frames, safe camera-pickup and simulated-drop plates.

**Post/VFX:** stitch and stabilize 360 footage; paint out mounts; maintain horizon and viewer comfort; composite transitions (camera pickup → movement → controlled fall → office pickup). Optional AI tools can create backgrounds, extend environments, remove rig, or assist transition interpolation, but must preserve artist identity, body continuity, lyric sync, spatial geometry and image rights. Never treat generated visuals as verified real capture.

**Runtime:** immersive 360 video is a sphere/skybox (look around, primarily rotational 3DoF), with a separate 3D phone, typography, overlays and selectable hotspots in a WebGL/WebXR scene. Genuine 6DoF positional parallax requires depth reconstruction, layered 2.5D assets, volumetric/NeRF/Gaussian splat capture or fully modeled geometry; 360 footage alone cannot deliver it. On phones use device orientation only after permission where required, touch drag fallback. In VR, controllers/hand tracking depend on headset/browser support.

**Playback:** one continuous song clock. Video segments can switch at exact beats/lyrics while audio persists; preload next alternatives; make transitions robust under buffering and dropped frames. Render lyric captions and accessible alternative choices outside headset.

## Agent handoff: required deliverables
- [ ] Confirm master audio and precise lyric-to-timecode cue sheet (do not invent timestamps).
- [ ] Shot list and safe rig diagram for meditation, pickup, church entry, simulated fall, office pickup.
- [ ] 360 test of eye line, lens seam, stitch quality and viewer comfort.
- [ ] 15-second proof-of-concept with virtual phone scrolling + viewer looking up at meditating Matthew.
- [ ] Two camera modes (private head tracking vs opt-in recorded Social) and no-camera fallback.
- [ ] Branch manifest with scene IDs, entry/exit cues, social/anti-social alternatives, fallback and reconnect points.
- [ ] AI video prompts per shot, source references, continuity bible, negative prompts and rights checklist.
- [ ] Owner-only experience telemetry dashboard and separate consent-controlled research recordings.
- [ ] Device QA: iPhone Safari, iPad Safari, Android Chrome, supported headset browsers.

## Open creative decisions
- Exact outdoor location, time of day, wardrobe and final choreography.
- How the virtual phone appears in the viewer's field of view and whether it is held by a rendered avatar hand.
- Whether church interior is practical location or AI-enhanced.
- Final office composition and CTA.
- Which decision moments change the location versus only overlay/character response.
- Whether first release is flat mobile 360, headset WebXR, or both.

## First build milestone
Make **one seamless 15-second proof-of-concept**: viewer can scroll a floating phone, look up at meditating Matthew in nature, hear “Scroll slow, homie,” and see a knowing one-eye peek. This proves the central interaction before expensive location shoots, branching or AI-generated scene transitions.
