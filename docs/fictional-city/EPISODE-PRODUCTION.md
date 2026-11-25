# From the city to complete 3D episodes

Production design, **2026-11-03**. This document describes the next layer; it does not claim that an episode player, actor rigs, Blender exporter or generated film already exists.

## Goal

Use the same Bridgeport geography, places, characters and props for an explorable city and a directed show. An approved episode should play from start to finish with consistent words, acting, timing, camera cuts and sound. Blender provides an editable cinematic scene. Selected rendered shots can then guide a photoreal video pass in Higgsfield.

Reuse the environment as a virtual set. A new episode should require new performance and shot data, plus genuinely new assets, rather than another reconstruction of the city.

## What is already built

The city has sourced building footprints, streets, authored interiors, collision, navigation, saved narrative progression and 13 Robbery 1s encounter stops. It has 35 short narrative paragraphs and ten named story-cast records.

Existing walking residents are lightweight procedural figures. The Robbery cast remains narrative data and is not a rigged, staged ensemble. There is no complete timed dialogue track, facial performance, cinematic episode timeline or Blender export in this implementation. The full screenplay must be recovered through its approved private source; encounter summaries are not substitutes for its spoken lines.

Game encounters and screenplay scenes are different units. A screenplay scene may need several shots, and several scenes can revisit the same game place. Keep scene and shot IDs separate while referencing existing place, cast and story-beat IDs.

## One episode authority

Create a versioned performance record that drives both preview and cinematic export. During production, AI may propose blocking, expressions and takes. Once approved, store the actual choices. Do not let characters invent new dialogue, deaths or relationships on every playback.

| Record | Required information | Why it matters |
| --- | --- | --- |
| Episode | Stable ID, approved script version/hash, frame rate, asset versions | Identifies the exact cut being reproduced |
| Scene | Scene ID, place ID, participating cast, starting prop state | Reuses the world and makes continuity explicit |
| Dialogue line | Line ID, speaker ID, approved words, audio asset and measured duration | Prevents speaker changes and animation drifting from speech |
| Actor track | Transform, rig/clip, gaze, gesture, expression, start/end frames | Turns story intent into a repeatable performance |
| Prop track | Prop ID, holder, attachment, placement and transfer frames | Preserves the original shoe's custody through the story |
| Shot | Camera transform, lens, focus, movement, frame range, light setup | Produces an intentional film cut |
| Audio | Separate dialogue, ambience, effects and music tracks | Allows fixes without regenerating the entire film |
| Generated take | Source shot, provider/model/settings, references, returned file, approval | Preserves chosen results and their origin |

Keep production timing separate from player saves. Watching an episode must not spend game credits, change the Whip reader or make the player a canonical wearer. Render from explicit scene state and a fixed frame clock; do not rely on wall-clock patrol motion or variable browser frame times.

Any production automation should use McCluster's existing capability and context planes. Read `docs/control-plane/AI-HARNESS.md` and `CAPABILITY-REGISTRY.md` before implementing adapters. Do not introduce a second backend or public raw-script store.

## Actors and audio

Build reusable rigs for the cast, with recognizable faces, proportions, wardrobe, hand controls and facial shapes. Keep the source ages of Malik and Kiara. A high-detail film representation and a lighter interactive representation may share the same character identity and animation contract.

Approve dialogue audio before final animation. A line's actual recording determines its length; estimated reading time is only a planning aid. Keep each speaker's voice and pronunciation consistent, then align mouth shapes, gaze, pauses and gestures to that approved recording. Talking also requires listening reactions and body movement, not only a moving mouth.

Make a small library of reusable actions: idle, walk, sit, turn, reach, hold, hand over, point and react. Author hand/prop contacts and emotional beats explicitly when the action library cannot express them. Bake procedural movement to animation tracks for interchange.

Higgsfield documents separate voiceover and lip-sync tools, including uploaded audio and video-to-video synchronization. They are options within this workflow; final words and speaker timing still need review. [Voice and lip-sync help](https://higgsfield.ai/creator-hub/help-center/ai-models/how-do-i-use-lipsync-voiceover-and-aspect-ratios).

## Transfer the set into Blender

Export the existing scene assembly rather than redrawing the block. A GLB can carry supported mesh, material, texture, rig, animation and camera data. Three.js provides [GLTFExporter](https://archive.threejs.org/docs/examples/en/exporters/GLTFExporter.html); Blender's [glTF integration](https://github.com/KhronosGroup/glTF-Blender-IO/blob/main/docs/blender_docs/scene_gltf2.rst) supports those interchange categories.

The exporter still needs implementation. Convert browser-generated signs into saved textures, expand or otherwise export instancing correctly, preserve scale and place IDs, and supply real animation clips. A browser update loop, DOM story panel or collision routine does not become a Blender animation automatically.

Exclude player UI, navigation markers and collision-only helpers from the cinematic package. Export the supported scene and animations plus a separate episode manifest, audio stems and edit/shot timing. Validate axis conversion, dimensions, texture appearance, actor poses and camera framing after import. Preserve a versioned `.blend` master and source assets.

Upgrade geometry, materials and lighting where a close shot requires more detail. Government identities and actual geography remain protected; cinematic dressing must respect the city naming contract.

## Higgsfield's role

As checked on November 3, 2026:

- The official [Blender plugin](https://higgsfield.ai/plugins/blender) operates in editable Blender scenes and describes mesh, scene, camera and character-animation tools. Its rigging workflow produces Blender bones/actions. The documented [integration requirements](https://higgsfield.ai/creator-hub/help-center/integrations/external-integrations-higgsfield) specify Blender 5.1+ on Windows or macOS.
- Cloud generation and local Blender rendering are distinct. The plugin does not remove local render hardware needs, and generated video does not automatically become a reusable high-detail 3D character.
- Higgsfield's [Eric Hsiao case study](https://higgsfield.ai/blog/eric-hsiao-the-thaw-ai-drama), published November 1, demonstrates Blender blocking used as video guidance for photoreal shots. It also describes a six-minute AI drama and a separate dialogue-comedy workflow. This establishes a practical example, not an automatic quality or schedule guarantee.
- [Cinema Studio](https://higgsfield.ai/creator-hub/help-center/tools/how-do-i-use-cinema-studio) currently documents clips up to 30 seconds and reusable reference Elements. Use consistent approved references for characters, places and important props.
- [Genjutsu's API reference](https://open.higgsfield.ai/models/higgsfield/genjutsu/restyle/v1.0/api-reference) describes motion/composition/audio-guided restyling of 4–30 second video. Longer inputs are trimmed to the first 30 seconds, and exact output duration/frame count is not guaranteed.

Build and review shots, then assemble the episode in an editor. Preserve the source performance, clean dialogue stems and approved output files. Repeated generation requests need not produce identical takes even when the 3D source is deterministic. Allow edit handles around shots, check continuity across cuts and repair individual shots as needed.

The current ChatGPT session has no connected Higgsfield execution or open Blender session. This branch contains no installed plugin, generated paid take or claim of a working Blender round trip.

## First production proof

Start with **45–60 seconds of Malik and Mama at Northline Walkups**, using approved source dialogue. This tests a recurring room and two characters with a manageable continuity burden.

Prepare four coverage angles: an establishing two-shot, each speaker's close coverage and a reaction or prop insert. Time the cut to the approved recordings. Each generated segment must fit the chosen tool's current length limit. Keep the same scene state, character references, wardrobe and lighting across every shot.

Deliver:

1. A complete basic 3D performance in the existing city.
2. An editable Blender package with cameras, animation and separate audio.
3. A clean direct Blender render for reference.
4. Photoreal candidate shots and one assembled comparison cut.
5. A production log of accepted duration, attempts, render/generation costs and correction time.

Acceptance requires the correct words and speakers, consistent faces/wardrobe/room, believable eye lines and hand contacts, intact timing after export, and reproducible source playback. Review selected generated takes for new objects, changing shoes, mouth errors and mismatched audio.

Use measured pilot throughput to estimate an episode. Do not promise a whole season's budget or unattended production before this test. The next proof can be Last Light Market, which adds a third character and visible shoe/hand continuity.

## Work division

The city agent owns geographic integration and environment quality. The story/character agent owns approved dialogue and reusable cast assets. The cinematic agent owns fixed-frame performance, scene export, shot packaging and edit continuity. They share the same place/cast/prop IDs and one source of canon.

The production milestone is a reliable short scene and editable interchange. Broader automatic episode assembly follows once that scene can be reproduced, corrected and extended without rebuilding its set.
