# Mission Selector Scene Model

The strategic scene is state-driven rather than feed-driven.

## Scene state

- `homeBase`: Site 0 / current deployment origin.
- `availableMissions`: missions unlocked by campaign state.
- `lockedSignals`: optional low-detail future-region signals.
- `selectedMission`: one mission or null.
- `deployment`: current source/destination/transition state.
- `worldState`: fictional campaign effects only.
- `layers`: game-only visibility settings.

## Mission marker states

`locked -> available -> selected -> deploying -> active -> complete`

A mission may also become `expired` or `failed` only if later campaign design intentionally adds those states.

## Camera language

- global idle: slowly framed Earth / command-room perspective;
- hover/select: ease toward country while retaining geographic context;
- dossier: hold broad regional view;
- deploy: cinematic great-circle flight from origin/current base to selected region;
- site transition: hand off to level/briefing scene without pretending the globe contains live operational telemetry.
