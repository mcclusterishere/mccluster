# Creator: the studio, the audio workspace, and beyond music

Status: the first slice of the redesign is built on branch `prime/creator-studio-redesign` (2026-11-24): the studio
shell and the Take bench, described under "What the first slice built" below. It is local code with a browser run
behind it; it is not merged, not deployed and not checked by a signed-in creator. Everything else in "The target" is
not built. Resume point for any session.

## What the first slice built (2026-11-24)

Owner, 2026-11-24: Creator Studio "looks like shit"; he wants a full redesign he can use "basically like BandLab".
This slice is the start of that, not the whole of it. It makes no backend, migration, edge-function or production
change.

**The shell** (`creator.html`, `css/creator-studio.css`, `js/creator-studio-shell.js`)

- Four local chapters inside the one page, at the same address: **Make**, **Releases** (the releases list and the
  submit form), **Page** (summary, identity, albums, rate sheet) and **Stats** (analytics). They are chapter tabs
  inside this destination, which `AGENTS.md` → "Shared website navigation" allows; the shared bottom bar, the account
  chip and `.music-contextbar` are unchanged, and so is the "Review" link.
- Hash routes `#make`, `#releases`, `#page`, `#stats`. The default is Make; `creator.html?edit=profile` opens on Page,
  where the profile form is. The row is a tablist (arrow keys, Home and End), sticky, four equal `minmax(0,1fr)`
  columns, 44px tall, 14px labels, the selected one marked by weight and a 2px accent underline. It parks below the
  fixed account chip, so the chip never covers a chapter label.
- The existing cards are moved into their chapter by the script, using the ids they already had. Every element id,
  form and field is unchanged, so `js/music-creator-studio.js` runs untouched. Without the script every card still
  shows in one column.
- The long release form is grouped under headings (The track, Audio, Artwork and player colours, Lyrics and video,
  Links on the player, Rights, License offer, Send for review). The fields stay inside the same `<form>`.
- A type and target floor inside `#creatorApp`: no text under 12px (the smallest is 13px), form controls at
  `max(16px,1rem)`, buttons and fields at least 44px tall, colour inputs as 64×44px swatches. Built only from the
  Music V2 tokens; no new colour, font or visual system.

**The Take bench** (`js/creator-studio-take.js`, in Make)

- Record from the microphone (`getUserMedia` and `MediaRecorder`) with a live input meter, a visible recording state
  and stop in place; clear messages when the microphone is refused, missing or busy, and when the browser cannot
  record. A recording is kept whole as soon as it stops.
- Import an MP3, WAV or M4A (`decodeAudioData`), up to 300 MB and 30 minutes (less for stereo: see "After review").
- A canvas waveform; two draggable trim handles (touch, mouse and arrow keys) with numeric start and end; fade in and
  fade out, drawn into the waveform; play, pause and stop of the trimmed region through the bench's own buffer source
  and gain. It pauses the site player first, stops if the site player starts, and never plays the catalogue.
- "Save take" writes the trimmed, faded region to a 16-bit WAV in the browser and keeps it
  in this browser's IndexedDB with its name, length and date, scoped to the signed-in account, so a reload keeps it.
  Open, download and delete (two presses, no dialog) from the list.
- "Use in a release" puts the WAV into the release form's existing master input (`DataTransfer`) and opens Releases.
  The bench itself uploads nothing: a take leaves the device only when the member submits the release form.
- Each take is stored with a one-track, one-clip session document, so multitrack sessions can open it as track 1.

**After review (2026-11-24, same branch)**

- Routing: a fragment that names an element inside a chapter opens that chapter (`creator.html#artistAnalyticsHeading`,
  linked from `mnet.html`, opens Stats); Back to the entry address shows the default chapter again; Alt+Arrow is left
  to the browser. The tab roles are added by the shell script, so a failed script leaves no dead tabs.
- Focus: a focused field is scrolled clear of the parked chapter row and of the shared bottom bar (measured space,
  `scroll-padding`); a control that is only waiting is `aria-disabled`, so Record and Save keep keyboard focus; the
  second Delete press is named, announced and called off by Escape. Field edges use `--music-faint` (3.6:1).
- Recording: it continues in other chapters with a strip (time and Stop) under the chapter row and a mark on the
  Make tab; its pieces are written to this browser as they arrive, so a reload or closed tab keeps what was captured
  ("Recovered take"); leaving mid-take asks first.
- Memory: the take list is metadata only and audio is a Blob read on demand; a file's length is read from its header
  (WAV, MP3, M4A) and refused before decoding if it is over 30 minutes or about 420 MB decoded (about 18 minutes of
  48 kHz stereo); the WAV is written straight from the open buffer in slices. A database that never answers falls
  back to holding takes in the tab after 8 seconds.
- Fidelity: a file is decoded at its own sample rate (WAV and MP3; M4A at 48 kHz) and a 16-bit file that is only
  trimmed keeps its samples exactly. Output is still 16-bit WAV, without dither.
- Hand-off: "Use as preview" fills the release form's preview input; a take over 50 MB (the listener-file ceiling
  the release form enforces) says so in the list and in the hand-off note.

**Evidence**: `scripts/test/creator-studio-shell.test.mjs` (ids kept, four chapters, zoom never blocked, files
referenced, rule 14 on the new stylesheet, the trim, fade and WAV arithmetic) and
`scripts/e2e/creator-studio-shell.e2e.mjs`, which writes `docs/music/creator-studio/screenshots/` (before and after
at 390px and 1280px for each chapter) and `measurements.json` there (its `checks` must all be true or the run
fails). The screenshots show a signed-out browser with
the studio un-hidden in the page; no profile, release or statistic in them is real.

**Not proven by this slice**: the signed-in studio (real profile, tracks, analytics), the real upload of a WAV made
here, a real microphone, and iPhone Safari (recording there stops if the screen locks or the tab is backgrounded).

## What remains, and is not built

This is one take at a time on one device. It is not a digital audio workstation and makes no claim to match BandLab
or any other product. Not built, in the planned order (`CREATOR-STUDIO-REDESIGN-PLAN.md` in the owner's workspace):

| Stage | What | Needs |
| --- | --- | --- |
| B | Release hub: a draft row when audio is chosen, a checklist per release, a preview region picked on the master, drafts that can be reopened and deleted | existing schema |
| C | **Multitrack sessions** on one device: lanes, a playhead and transport, overdub with count-in, bounce | none |
| D | **Cloud projects** and versions: sessions saved to the member's storage | one Supabase migration; the owner's go-ahead |
| E | Real editing: split, move with snap, crossfades, loop region, tempo grid and metronome, undo, autosave, recording-latency check | none |
| F | **Mixer**: gain, pan, solo, a master strip, effect presets from the browser's own EQ, compressor, reverb and delay | none |
| G | Heavy jobs on the OVH McCluster Core: member-facing stem splitting, long renders, compressed formats, and any **mastering** | an owner decision on cost limits |
| H | **Collaboration**, turn-based: invites, named versions, open-as-copy, timed comments | Stage D |

Also not built and not planned in these stages: **loops**, sounds or an instrument library, MIDI, pitch correction,
time-stretch, in-browser noise removal, store distribution, paid splits and real-time co-editing. Export is WAV only.
Podcasts and radio (items 4 and 5 of "The target") are untouched. The analytics card and the Page chapter's forms
were given the size floor only; their redesign is still to do.

## The owner's request (2026-11-17)

"After we're done with what we're working on now, i need you to finish the creator studio and make it so a user
who has signed up gets access to way more. Such as basically bandlab stuff like a digital audio workspace online.
I'm going to need you to hype develop the audio module so it becomes 'creator' and we'll do more than just music
soon enough such as podcasts, radio streaming and more. We need to build out the functionality and when people
create accounts and start uploading their content the module will start having content."

## What already exists (read on 2026-11-17 against `main` at `fc1986ec`)

- `creator.html` ("Creator Studio · McCluster Music") with `js/music-creator-studio.js`: uploads within the storage
  ceilings Supabase enforces.
- Artist pages: `js/music-creator-profile.js`, `js/music-creator-page.js`; the music Worker routes
  (`workers/mccluster/src/music/`).
- Audio-only live rooms on the World's Live view: `js/mnet-audio.js` and `workers/mccluster/src/audio-sfu-rooms.js`
  (`docs/action-network/AUDIO-SFU-ROOMS-RELEASE.md`).
- Creator billing, entitlement and site publishing: `workers/mccluster/src/creator-billing*.js`,
  `creator-entitlement.js`, `creator-site-publish.js`, `creator-site-view.js`; the creator account page
  (`js/mccluster-creator-account.js`) and the website studio (`mccluster-creator-studio.html`).
- Stem separation on the OVH McCluster Core (`core/src/executors/stems-separate.mjs`) and its owner panel
  (`js/control-room/stems-panel.js`).
- Unfinished drafts kept aside in `_unfinished/` (creator capture, selection desk, landing analytics).

## The target, in order

1. **Creator, not just music.** The audio module becomes the Creator module: one studio a signed-up member opens,
   with music first and room for podcasts and radio. Which features a member gets comes from the viewer context
   and the module catalogue (`docs/control-plane/VIEWER-CONTEXT-AND-ENTITLEMENTS.md`), never from the page alone.
2. **An online audio workspace** (our own design; no other product's name, look or assets): multitrack projects in
   the browser (Web Audio and MediaRecorder), record from a microphone or import files, a timeline with cut, trim,
   move, fades, gain and pan per track, a metronome and tempo grid, a small set of built-in effects (EQ,
   compression, reverb, delay), undo, autosave to the member's own storage through the existing upload path and
   ceilings, mixdown to a shareable file, and publishing to the member's creator page. Mobile first: it must work on
   a phone, with more room on a tablet and desktop.
3. **Heavier processing** (stem separation, mastering-grade renders, long exports) runs as jobs on the OVH McCluster
   Core under the existing job and cost ledger, never in a new backend.
4. **Podcasts**: episodes, show pages and a standard podcast feed for each show.
5. **Radio**: scheduled live audio from a member's studio over the existing audio-room infrastructure, with
   recordings kept as episodes when the member chooses.
6. **Content in the World**: what members publish appears in the World's feed and on their pages, so the module
   fills with real content as people sign up and upload; nothing is seeded or invented.

## Rules that apply

`AGENTS.md`: McCluster is the backend (Worker `mccluster`, Supabase `zmnhbrjyhxzhkxmhkexs`, the OVH Core for
persistent execution); no second auth, storage, billing or social stack; uploads keep their owner, consent and
rights checks; mobile first; Matthew McCluster's music and McCluster Corp's platform stay on their own properties.

## Queue

| Step | What | State |
| --- | --- | --- |
| 1 | Understand: map the studio, uploads, storage ceilings, artist pages, audio rooms, billing and entitlements | queued |
| 2 | Design: the Creator module, what each member level gets, the workspace architecture | queued |
| 3 | Build the workspace in slices, each reviewed and verified on phone, tablet and desktop | first slice built on a branch (shell and Take bench, 2026-11-24); stages B to H not built |
| 4 | Podcasts, then radio | queued |
