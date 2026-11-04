# Close camera and orientation

The city now starts in **Close view**, a perspective camera behind the player.
**Overview** retains the elevated orthographic view. The view choice does not change
walking, geography, inventory, story progress or the existing save format.

- Tap the street to walk, or use the screen-relative arrows / WASD.
- Drag left/right to turn and up/down to tilt. A drag stops an existing tap-walk
  route so the player stays still while looking around.
- **+** moves closer; **−** moves farther away. Close-view zoom reaches a near-eye
  distance, hiding the player model when it would fill the lens. These controls
  correct the previous reversed button wiring.
- **Recenter** puts the close camera behind the player's current facing direction
  and resets tilt and distance. Overview reset retains its original default angle.
- Two-finger pinch and Ctrl/Command-wheel remain browser accessibility zoom.
  They do not become in-game walk taps. The viewport does not disable page zoom.
- The live mini-map shows the direction being viewed. Indoors it shows the room
  and exit; tapping it opens the city map with the building's street entrance marked.
- The city map opens around the player's location, with a **Whole city** option.
  Original storefront door numbers match the readable destination cards.

Close-view camera clearance reuses always-resident walking boundaries and adds
camera-only bounds derived from the rendered interior instances. Shelves and
equipment therefore shorten the camera boom without changing walking geometry.
Outdoor decorative props that are not walking obstacles are not independently
camera-blocking. Full third-person character animation and a true first-person
body are outside this change.

## Verification

From the repository root:

```sh
node --test scripts/test/fictional-city-camera.test.mjs \
  scripts/test/fictional-city.test.mjs scripts/test/fictional-city-spatial.test.mjs \
  scripts/test/fictional-city-places.test.mjs scripts/test/bridgeport-story.test.mjs \
  scripts/test/fictional-city-publication.test.mjs
THREE180_DIR=/path/to/cached/three180 node scripts/e2e/fictional-city-camera-inputs.mjs
```

The deterministic integration fixture uses the real Three 0.180 geometry,
projection and picking code with a stub renderer and canvas. It covers switching
views, zoom/tilt, touch cancellation, lost capture, two pointers, blur, modal pause,
browser zoom, tap walking, camera-relative movement, repeated entry/exit, shelf
clearance and portrait lens resizing. It does **not** render pixels or measure
browser/device frame rate.

The existing browser suite remains the pixel/layout verification path:

```sh
CHROMIUM_PATH=/path/to/chromium THREE180_DIR=/path/to/cached/three180 \
  node scripts/e2e/fictional-city.e2e.mjs /tmp/city-camera-browser-results
```

Before release, verify rendered sign readability and control overlap at 390 px,
iPad portrait and iPad landscape; measure document scrollWidth against clientWidth;
exercise touch on a physical iPad. These checks could not run in the implementation
environment because Chromium could not create its required local socket. The managed
browser could not reach the local fixture. No pixel/layout pass or real-device
performance result is claimed.

## Reconciled local continuation, 2026-11-04

Explicit **First person** now places the lens at the player eye; **Third person** retains the close
view. **Lock behind** makes left/right steer while forward/back moves along the view; tap-walk turns
the camera behind the walking character. Uncheck it for the prior screen-relative strafing controls.
Building names have an on-screen overlay and off switch. The destination selector includes the HQ;
**Walk there** follows a collision-checked route, and its live bearing/distance and minimap marker
remain visible. These are session viewing/navigation controls, not shared administrative settings.
See `NAVIGATION-REVIEW-2026-11-04.md` for source reconciliation, geographic limitations and verification.
