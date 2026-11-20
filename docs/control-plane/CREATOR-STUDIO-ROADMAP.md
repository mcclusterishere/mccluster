# Creator: the studio, the audio workspace, and beyond music

Status: queued behind the work in progress (the World feed and missions, the environmental globe, the viewer
context). Nothing here is built yet. Resume point for any session.

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
| 3 | Build the workspace in slices, each reviewed and verified on phone, tablet and desktop | queued |
| 4 | Podcasts, then radio | queued |
