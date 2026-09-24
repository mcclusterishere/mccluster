# Equity Uprise — Playable Building Systems Audit

> Status: **CANONICAL AUDIT / IMPLEMENTATION BASIS v1.0**
>
> Audit snapshot: McCluster branch `9c4e5721ba71ddf8d01905f75bf2efc064a322e1`
>
> Scope: physical device realism, cabling/power, RF and surveillance, tactical attack/defense, learning progression, people/characters, interactive device software, multiplayer/solo control, and low-end mobile performance.
>
> Safety boundary: all game/lab system changes remain **SANDBOX-only**. This is a fictional/digital-twin training/game environment, not authority to control or attack real infrastructure.

## Executive finding

The project is not missing a foundation. It is missing **embodiment and unification**.

The canonical electronics graph is already unusually deep:

- **1,883** registry assets after the current electronics pass.
- **1,330 / 1,330** physical connections have routed geometry.
- **1,330 / 1,330** physical connections are port-complete.
- **45** modeled wireless association links.
- **40** canonical IT labs.
- all eight physical levels B1–F7/L7 are represented.
- deterministic fault propagation and whole-building lab runtime already exist.
- PRIM3 already defines turn-based tactical play, fog of war, named characters, R/E/T responsibilities, hostile pressure, and kinetic/technical coupling.

The weak point is the visible/runtime presentation:

- only **18 security cameras** currently reach the device-archetype maturity target `lab_complete`;
- AV cameras are only `componentized`;
- most endpoint device families are only `recognizable`;
- access switches and patch panels are still `placeholder`;
- wireless links exist as topology but not as useful RF/coverage geometry;
- camera FOV can be shown one camera at a time but is not yet the authoritative tactical visibility system;
- named workplace occupancy exists, but bodies are not yet populated in the canonical building viewer;
- existing HTML/auth/product surfaces are not yet mounted onto the physical computers/kiosks/consoles in the 3D building;
- the canonical viewer eagerly loads a large multi-GLB stack, disables HTTP/browser caching, disables frustum culling on most meshes, enables soft shadows globally, and therefore conflicts with the stated goal of running well on weak phones and bad connections.

The correct end state is one state graph:

```text
CANONICAL BUILDING STATE
    |
    +-- PHYSICAL 3D
    |     devices / wires / trays / panels / rooms / bodies
    |
    +-- DIAGNOSTIC LAB
    |     symptom -> inspect -> test -> fix -> verify
    |
    +-- BUILDING OS
    |     authenticated role-scoped screens on real modeled devices
    |
    +-- CHARACTER RUNTIME
    |     people / expertise / dialogue / workspace / unit permissions
    |
    +-- TACTICAL GAME
          attacker / defender / visibility / turns / objectives / consequences
```

No parallel viewer. No parallel device graph. No second auth system. No game-only fake copy of the building.

---

# 1. Realistic device embodiment

## Current state

Step 4B already creates the physical/electrical/network fabric. Current generated device counts include:

| Device family | Count |
|---|---:|
| workstation | 36 |
| monitor | 62 |
| security camera | 18 |
| AV camera | 13 |
| wireless AP | 15 |
| IP phone | 16 |
| MFP | 7 |
| access switch | 8 |
| patch panel | 8 |
| access reader | 10 |
| access controller | 8 |
| intercom | 9 |
| BAS controller | 8 |
| environment sensor | 29 |
| fire detector | 28 |
| fire notification appliance | 14 |
| speaker | 26 |
| AV microphone | 26 |
| AV controller | 7 |
| AV DSP | 7 |
| network display decoder | 20 |
| electrical panel | 14 |
| rack UPS | 7 |
| PDU | 22 |
| virtualization host | 3 |
| collapsed core switch | 2 |
| firewall | 2 |
| VMS/NVR | 1 |
| NAS | 1 |
| backup appliance | 1 |
| edge router | 1 |
| carrier CPE | 1 |

The camera archetype already proves the required pattern: mount plate, arm, housing, lens, lens glass, IR ring, status LED, RJ45/PoE port and cable entry are separate inspectable components with operational state.

## Gap

That pattern is not generalized across the inventory.

Current maturity from `device-archetypes-v1.json`:

- camera — `lab_complete`
- AV camera — `componentized`
- wireless AP — `recognizable`
- workstation — `recognizable`
- monitor — `recognizable`
- IP phone — `recognizable`
- MFP — `recognizable`
- electrical panel — `recognizable`
- environment sensor — `recognizable`
- access reader — `recognizable`
- intercom — `recognizable`
- access switch — `placeholder`
- patch panel — `placeholder`

This is why a stable device ID can exist without the environment yet feeling like a real lab.

## Required implementation

Every physical device family gets one canonical archetype assembly with:

1. recognizable chassis geometry;
2. real physical connection points;
3. component IDs that can be selected/inspected;
4. visible status indicators where appropriate;
5. state rules;
6. interaction verbs;
7. failure visuals;
8. operating UI where the device actually has one;
9. LOD variants;
10. an explicit maturity gate ending at `lab_complete`.

Do **not** hand-model 864 unique objects. Build one deterministic archetype and instance it at every stable asset ID with per-device labels, ports and state.

### Acceptance gate

A device family is not complete until a learner can:

- identify it by appearance without a floating label;
- find its physical power/data/control ports;
- trace its canonical connection path;
- inspect its important internal/external components;
- observe at least normal/degraded/faulted/offline state;
- use its relevant interface or service behavior;
- see the same state reflected in labs and tactical play.

---

# 2. Cabling, wiring, power and physical pathways

## Current state

The graph is already strong.

Current cable/link inventory:

| Cable / media | Count |
|---|---:|
| Cat6A horizontal | 215 |
| Cat6A patch | 404 |
| Cat6A WAP spare | 15 |
| OS2 single-mode duplex | 16 |
| 10G DAC | 20 |
| 120 VAC branch | 187 |
| 208Y/120 V feeder | 14 |
| NEMA 5-15 equipment cord | 187 |
| IEC power | 54 |
| DisplayPort | 62 |
| HDMI | 20 |
| BACnet MS/TP | 29 |
| 24 VDC Class 2 | 29 |
| OSDP RS-485 | 10 |
| fire-alarm SLC | 28 |
| fire-alarm NAC | 14 |
| speaker pair | 26 |

All 1,330 generated physical connections currently have endpoints, port metadata and routed geometry.

## Gap

"Graph-complete" is not yet the same as "architecturally believable in the room."

The viewer needs to show the final few feet and the pathway ecology:

- device port -> equipment cord/patch cord;
- wall/ceiling/floor termination;
- jack or receptacle;
- pathway/tray/conduit/J-hook/riser;
- patch panel/panelboard/controller;
- switch/core/service destination.

A cable should not visually teleport into a generic trunk.

The broader asset-registry pass also still contains semantic-only service relationships and assets without exact endpoint locations. Those must not be mistaken for physically modeled cable runs.

## Required implementation

Create a deterministic **physical-path rendering contract**:

```text
DEVICE PORT
 -> LOCAL DROP
 -> TERMINATION
 -> HORIZONTAL PATHWAY
 -> IDF / PANEL / CONTROLLER
 -> RISER / BACKBONE
 -> B1 CORE / SERVICE
```

Cabling view must support:

- cable type filters;
- source-to-destination tracing;
- port labels;
- pathway labels;
- circuit/network/control domain;
- cable bundle aggregation at distant LOD;
- individual final-drop visibility at room LOD;
- simulated fault/highlight state.

Power must be equally traceable. Workstations, displays, phones, cameras, APs, controllers, AV and building systems must visibly terminate at the correct modeled electrical/network/control layer.

### Acceptance gate

Pick any modeled endpoint on any floor. The viewer must be able to answer:

> What powers this? What communicates with it? Through what physical media and route? What upstream asset fails if this path is cut?

without inventing fallback coordinates or hidden logical jumps.

---

# 3. Wireless, surveillance and tactical observability

## Current state

- 15 modeled APs.
- 45 modeled wireless association links.
- three SSID objects.
- camera objects have stable positions and aim vectors.
- security camera archetype default optics include horizontal/vertical FOV and training range.
- the viewer already renders a selected camera's FOV wireframe.
- the viewer can render a simulated camera feed from the actual 3D scene.

## Gap

Wireless currently has no useful spatial representation in the canonical viewer.

Camera FOV is visual, but it is not yet the authoritative visibility/fog-of-war calculation. Current FOV is a simple frustum and does not derive occlusion from walls/doors/geometry.

There is no unified tactical surface that lets an attacker or defender understand:

- camera-covered vs unobserved space;
- active/degraded/offline sensor coverage;
- defender information gained from a functioning camera;
- wireless association/coverage zones;
- door/access-control coverage;
- defender-controlled vs contested zones;
- legal ingress/egress vs tactical breach routes;
- system dependencies that expose a route when they fail.

## Required implementation

Create one **Tactical Observability Graph** derived from canonical building state.

Inputs:

- architecture/walkability;
- doors/readers/locks;
- cameras + aim/FOV + current state;
- APs + simulated coverage profiles + current state;
- access-control state;
- lights/power;
- alarms/sensors;
- network/VMS/BAS dependencies;
- occupants;
- tactical units.

Outputs:

- defender visibility;
- attacker visibility;
- observed / inferred / hidden cells or nav regions;
- camera coverage volumes;
- simulated RF coverage volumes;
- contested/control zones;
- ingress/egress markers;
- objective exposure;
- sensor outages and resulting blind regions.

### Camera visibility

Camera coverage becomes geometry-aware:

```text
camera state
 + FOV
 + range
 + ray/portal occlusion
 + door state
 = observable volume
```

When PoE, network, VMS or the camera itself fails, that volume disappears from defender information.

### Wireless visualization

Wireless uses **simulated game/training coverage**, not a claim of real RF survey accuracy.

Show:

- AP service volume;
- associated clients;
- SSID/VLAN relationship;
- degraded/interference/jamming/rogue conditions as abstract sandbox states;
- handoff/coverage gaps.

Do not encode real-world offensive procedures. The tactical value is information, availability, deception and control state.

### Tactical attack-surface visualization

Attack surfaces are derived from actual building systems, not painted on as arbitrary red icons.

Candidate classes:

- physical entrances;
- doors/readers;
- stairs/elevators;
- roof/service access;
- cameras/sensors;
- wireless coverage;
- network/AV/OT nodes;
- power dependencies;
- evidence/mission nodes;
- public/intake interfaces.

Attacker and defender do **not** automatically receive the same knowledge. Fog of war and earned information remain authoritative.

### Acceptance gate

Turning one canonical camera, switch, UPS, AP or access-control dependency on/off must visibly change the tactical information/control map without a separate game-only override.

---

# 4. Labs that graduate into facility defense/offense

## Current state

The education stack already has two independent axes:

- technical readiness;
- tactical challenge.

Technical learning currently progresses through Foundation -> Technician -> Admin -> Advanced -> Expert in the building lab runtime.

PRIM3 separately defines tactical challenge and an XCOM-like turn economy.

This separation is correct and should be preserved.

Current distributed building labs are still mostly framed as support tickets:
- workstation link failure;
- AP outage;
- voice VLAN;
- AV multicast/QoS;
- camera/VMS loss;
- BAS outage;
- IDF/UPS;
- cross-floor uplink/fiber failures.

## Gap

The learner fixes the system, but the same skill has not yet been re-authored as a **defense responsibility under pressure**.

## Required progression

Do not add a second set of technical truths. Wrap the same canonical fault/system objective in progressively more tactical mission envelopes:

```text
SUPPORT
  A user reports a problem.
  Learn the device, topology and diagnostic loop.

OPERATIONS
  The problem affects the building.
  Prioritize safety, continuity and dependencies.

DEFENSE
  An active hostile force is exploiting the outage or trying to create one.
  R/E/T characters protect the work while the learner restores/validates the system.

CONTESTED
  Attacker and defender both act on the same building state.
  Technical actions alter the tactical board.

TRANSFER
  The player receives a novel combination and must infer the right response.
```

A Foundation learner can play a low-pressure `STORY` tactical envelope with heavy scaffolding. A technically advanced learner may still choose low tactical difficulty. A strong gamer with weak technical mastery should not bypass the technical answer by shooting everything.

### Example reuse

The existing Floor 6 camera/VMS lab becomes:

1. support ticket: restore one camera path;
2. operations: identify what surveillance coverage is lost;
3. defense: protect the technician while blind space creates an ingress risk;
4. contested: attacker tries to maintain the blind corridor while defender restores PoE/network/VMS and re-establishes observation;
5. transfer: a different upstream failure produces the same symptom and the player must distinguish it.

### Acceptance gate

For every major tactical mission:

- removing the technical system must change combat decisions;
- removing the tactical pressure must still leave a valid technical lab;
- killing hostiles cannot automatically satisfy technical success criteria;
- successful technical work changes visibility, routes, communications, access, power or another battlefield state.

---

# 5. Complete device list to operating-device maturity

## Decision

The target is **not** "there is a mesh for every asset."

The target is:

> Every physically relevant asset belongs to an archetype that looks, connects, fails and interacts like its class of device.

## Completion ledger

Create a required archetype library covering at least:

### User endpoints
- workstation;
- monitor;
- IP phone;
- MFP;
- intake/check-in terminal;
- public directory/kiosk;
- staff terminal.

### Network / compute
- patch panel;
- access switch;
- collapsed core switch;
- firewall;
- router/CPE/handoff;
- fiber panel;
- rack UPS;
- PDU;
- virtualization host;
- NAS;
- backup appliance;
- VMS/NVR.

### Wireless / security
- AP;
- security camera;
- AV camera where it participates in observation;
- access reader;
- access controller;
- intercom;
- lock/door hardware where represented.

### Building / OT / life safety
- BAS controller;
- environment sensor;
- electrical panel;
- fire alarm control panel;
- fire detector;
- notification appliance;
- fire read-only gateway.

### AV / media
- AV camera;
- microphone;
- DSP;
- AV controller;
- display decoder;
- speaker.

The 190 data jacks, 187 receptacles and other connection hardware are physical infrastructure components and should be visibly real at room inspection distance, even if they are not "game units."

### Acceptance gate

The device-archetype verifier must fail CI if:
- an installed physical asset type has no archetype;
- an archetype remains below its required maturity;
- a device with a physical port is rendered without that port;
- an installed asset is not bound to canonical spatial geometry;
- a device UI claims capabilities not present in the canonical registry.

---

# 6. Real people, interactive characters and deployable units

## Current state

The canonical workplace occupancy authority now assigns named PRIM3 characters to workspaces across B1–F7.

PRIM3 already provides:
- named recurring cast;
- specialties;
- tactical role grammar;
- persistent injuries/relationships;
- Wildcard/Apex logic;
- character-focused turn-based play.

The repository also contains unfinished procedural human/NPC rendering experiments with distance culling and static-pose optimization. They are useful implementation references but are **not** current building authority.

## Gap

The canonical building viewer still has no living named population.

## Required character runtime

Create one character record per canonical workplace character:

```json
{
  "character_id": "...",
  "display_name": "...",
  "home_floor": "F3",
  "workspace_anchor": "...",
  "expertise": ["..."],
  "building_authorities": ["..."],
  "lab_mentor_topics": ["..."],
  "tactical_qualifications": ["R", "T"],
  "deployable": true,
  "current_state": "AVAILABLE"
}
```

One record drives three forms:

1. **Ambient worker** — present at their desk/room, idle/moving.
2. **Interactive person** — dialogue, mentoring, mission/lab handoff.
3. **Deployable tactical unit** — AP, qualifications, equipment, injuries, location and system authority.

Do not create separate NPC and tactical duplicates of the same person.

### Expertise matters mechanically

Examples:

- Jonas can expose/interpret Pylon/BAS state that another character cannot.
- Minh gets deeper hardware/firmware inspection actions.
- Rafael provides stronger observation/overwatch information.
- Nusrat has access-policy expertise.
- security staff have stronger physical-control actions.
- McCluster crosses roles as Wildcard but does not automatically out-specialize experts.

### Body rendering

Use scalable stylized bodies with:
- near LOD: articulated / identifiable silhouette;
- mid LOD: simplified rig;
- far LOD: static/instanced figure or omitted;
- floor/room culling;
- no expensive individual skin shader dependency.

Characters need recognizable wardrobe/silhouette and name/role interaction, not photoreal faces.

### Acceptance gate

A character seen at a desk in exploration mode must be the same persistent character who:
- gives or assists a lab;
- has the same expertise;
- can be assigned in tactical mode;
- can be injured/unavailable;
- leaves a visible workspace vacancy when absent.

---

# 7. Computers and devices become a role-scoped Building OS

## Current state

Do **not** build new authentication.

The repo already has:
- canonical `js/mcc-auth.js`;
- Supabase authentication;
- existing profile/dashboard/intake surfaces;
- Equity Uprise intake functions;
- role/capability concepts;
- Floor 1 Development Passport/application/next-action concepts;
- Floor 5 evidence/research surfaces;
- Floor 6 command/approval/job/integration surfaces.

## Gap

Those web capabilities live beside the 3D building instead of **inside its physical devices**.

## Required architecture

Create a Building OS shell that mounts onto modeled terminals.

A 3D screen click opens a DOM/web overlay connected to that exact physical device ID.

Do **not** render full live HTML into WebGL textures by default; that is expensive and inaccessible on mobile. The 3D monitor is the spatial affordance; the DOM overlay is the usable screen.

```text
PHYSICAL DEVICE ID
 -> DEVICE APP REGISTRY
 -> AUTHENTICATED USER
 -> ROLE / CAPABILITY / STORY STATE
 -> ALLOWED APPS
 -> SANDBOX OR PLATFORM DATA
```

### Initial app families

**Floor 1 / newcomer terminals**
- sign in;
- Development Passport;
- application/intake status;
- next action;
- orientation;
- mission/training board;
- building directory.

**Established-member workstation**
- Passport/progression;
- assigned labs;
- current missions;
- evidence;
- communications;
- systems appropriate to role.

**B1 technical consoles**
- simulated network/power/BAS/security views;
- lab workbench;
- maintenance/fault board.

**F3 field operations**
- mission planning;
- roster;
- technical objectives;
- Picture/Control/Technical state.

**F4 media**
- media/catalog/creator/release tools appropriate to role.

**F5 policy/evidence**
- source review;
- evidence/provenance;
- research/publication;
- monitoring.

**F6 command**
- initiative/mission portfolio;
- approvals;
- jobs;
- integrations;
- command state;
- role-scoped Halo/PRIM surfaces.

### Permission law

There are two separate concepts:

1. **real application authorization** — server-enforced identity/role/capability;
2. **game/training authorization** — simulated clearance, progression and mission state.

A game level may unlock a simulated console. It must never elevate a real production account's server permissions.

### Acceptance gate

Two logged-in users can click the same physical workstation and legitimately see different allowed apps/state based on canonical permissions. A logged-out newcomer gets the intake/orientation surface, not an admin console.

---

# 8. Slow-phone / bad-network performance

## Current state

The current viewer has several expensive choices that were useful for visual debugging but are wrong for the final low-end target:

- HTML declares `Cache-Control: no-store`;
- lab datasets also use `cache: "no-store"`;
- the viewer waits for **11 visual roots** before declaring the whole stack loaded;
- `makeReliable()` sets `frustumCulled = false` on meshes;
- many architectural meshes cast and receive shadows;
- soft PCF shadows are globally enabled;
- directional shadow map is 2048 × 2048;
- DPR is allowed up to 2;
- materials are broadly double-sided;
- camera inspection may create a second WebGL renderer;
- the committed facade + electronics + services + core + B1 + roof GLBs alone are about **6.33 MB** before every detailed floor, JavaScript module, texture and network response is counted.

The existing performance budget says the initial Uprise payload should target <=8 MB compressed, preferably <=5 MB, but the canonical building viewer is not yet architected around progressive loading.

## Required performance architecture

### Boot tier

Initial response loads only:
- HTML/CSS/minimal JS;
- low-detail exterior/core shell;
- current user/auth summary;
- current floor selector.

Everything else is lazy.

### Spatial streaming

Load in this order:

```text
shell
 -> current floor
 -> current room
 -> nearby characters
 -> nearby interactive devices
 -> current mission/lab assets
 -> optional services/cabling
 -> other floors only on demand
```

Never require the full B1-to-roof stack before the user can interact.

### Geometry

- restore frustum culling;
- use room/floor visibility culling;
- instance repeated endpoint/device geometry;
- introduce LOD for people and equipment;
- aggregate distant cable bundles;
- use compressed/quantized GLB delivery where compatible;
- avoid unique materials per repeated device.

### Rendering quality profiles

`LOW`
- DPR around 1;
- no dynamic soft shadows or one cheap shadow;
- reduced environment/reflection work;
- simplified people;
- no live camera feed until explicitly opened;
- aggressive cable aggregation.

`BALANCED`
- modest shadows;
- DPR capped around 1.5;
- normal device/character LOD.

`HIGH`
- current richer visual treatment where hardware allows.

Auto-select conservatively from viewport/device/network signals, but always allow manual override.

### Network/cache

- remove blanket `no-store` from immutable stamped assets;
- use content/versioned URLs;
- long-cache immutable GLBs/JSON where content-addressed/stamped;
- service-worker cache the shell and most recently visited floor;
- prefetch only likely next floor/mission assets;
- retry partial assets without restarting the entire building.

### Runtime

- one renderer where possible;
- camera feeds render only while visible and at a capped frame rate;
- pause expensive animation/render work when tab/background/floor is not visible;
- DOM overlays handle terminal UI;
- multiplayer sends deterministic commands/state deltas, not continuous full-scene transforms.

### Binding performance gate

The new minimum target is weaker than the old modern-iPad target:

- interactive shell must appear before full building download;
- one floor/room must be usable on a low-memory phone;
- loss/recovery of a network request must not crash/reload the entire scene;
- initial playable floor payload must be separately measured from optional whole-building assets;
- steady-state gameplay must have a low-quality path that prioritizes legibility over visual effects.

---

# Multiplayer and solo end state

Multiplayer should use the same deterministic turn engine as solo.

## Solo

One authenticated player owns/controls every friendly deployable unit allowed by the mission.

## Multiplayer cooperative defense

A session assigns one or more characters/roles to each player.

Example:

```text
PLAYER A -> Rafael / Picture
PLAYER B -> Aya / Technical
PLAYER C -> Arjun / Physical Control
```

Players act in the same Player Phase under the authoritative turn/session state.

## Adversarial attacker vs defender

Both teams consume the same canonical sandbox building state.

The server/session authority records commands such as:

- move unit;
- inspect;
- observe;
- hold/control;
- technical action;
- interact with building system;
- end activation;
- end phase.

The state engine resolves consequences and publishes the next deterministic state.

Do **not** synchronize the game by streaming every client's Three.js transforms as truth.

## State authority

A multiplayer session must own:

- scenario seed;
- building-state snapshot version;
- player/team/unit ownership;
- current phase/round;
- unit AP/status;
- technical system state;
- camera/RF/door/power state;
- visibility/fog state;
- objectives/evidence;
- command/event ledger.

Solo mode is the exact same model with one user owning all friendly units.

---

# Canonical implementation sequence

This sequence minimizes rework:

1. **Physical maturity contract** — finish archetype schema, device coverage verifier and exact device-gap ledger.
2. **Performance shell first** — progressive floor/room streaming, caching and low-quality mode before adding hundreds of richer objects.
3. **Device library** — bring every installed physical device family to required visual/interactive maturity.
4. **Connection/path rendering** — real final drops, ports, pathways, risers and trace UI.
5. **Observability graph** — camera occlusion/FOV, simulated RF, access/door/sensor/control zones and tactical visibility.
6. **Building OS** — existing McCluster auth + role-scoped device app registry mounted onto physical terminals.
7. **Character runtime** — named bodies, expertise, dialogue, workspace state and deployable-unit adapter.
8. **Lab mission envelopes** — Support -> Operations -> Defense -> Contested using the same technical truth.
9. **Tactical assimilation** — connect PRIM3 resolver/rules to canonical building state without regenerating building geometry.
10. **Multiplayer authority** — deterministic session/turn ownership; solo remains one-player ownership of all friendly units.
11. **Whole-system acceptance pass** — low-end mobile, replay, fault propagation, character absence, permissions, tactical visibility and lab evidence all tested together.

---

# Non-negotiable contracts

- The current Equity Uprise building remains geometry authority.
- PRIM3 game code reads the building; it does not regenerate a game-only HQ.
- A device must have one stable canonical ID across 3D, labs, OS and tactics.
- A person must have one stable canonical character ID across workplace, dialogue and tactical deployment.
- Real authentication/authorization stays in the existing McCluster platform.
- Game clearances cannot elevate real production permissions.
- Technical truth remains deterministic.
- Tactical uncertainty may come from fog, hostile action, interruption and incomplete information.
- Real-world controls remain unavailable.
- Mobile performance is an architecture requirement, not a cleanup pass at the end.

## Definition of done

The building reaches the requested target when a new player can enter on a weak phone, meet a named character, use a real-looking intake workstation, sign in, see their Passport/next mission, accept a beginner support lab, trace a visibly wired device, fix a sandbox fault, watch that same device change the building state, later deploy the same named characters in a turn-based defense mission, lose or restore camera/wireless/control coverage as systems change, and play the same mission solo or cooperatively without the game creating a parallel copy of the building.
