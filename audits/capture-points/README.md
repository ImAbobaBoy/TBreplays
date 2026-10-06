# Supremacy capture points and allied spotting (2026-10-06)

## Positions

The read-only game source is `D:/gamess/Tanks_Blitz/Data/3d/Maps`. Root SC2 scenes contain active entities with `CustomPropertiesComponent.cpc.properties.archive.type = strategicpoint`, a `baseID`, radius and capture/scoring parameters. Position is `TransformComponent.tc.worldTranslation`.

Conversion from Dava Z-up to viewer world is `(x, z, -y)`, exactly as in the object mesh exporter. Replay calibration must not move these points. All 107 points on 33 maps were compared against the decoded SC2 scenes. Mines, Moon and Iceworld have only Encounter mode in this client and do not contain strategic points.

The small derived `ClientGameData/supremacy_points.json` is embedded in the backend. Existing processed maps can use it without a heavy reimport or access to the game installation. New map imports write `capture_points.json` beside other revision artifacts.

## Recorded capture state

Validated version: 26.10. Entity method 55 on the arena, notification discriminator 12, BigWorld variable-length payload, outer protobuf field 11. Inner fields: 1 = point ID, 4 = integer capture progress (0–100), 7 = owning team, 8 = capturing team. Omitted scalars are zero: each message is a complete state, not a patch. Field 6 remains unclassified. Unknown game versions fail closed.

The Tiger-Maus Skit recording from 2026-10-03 contains 56 states for A/B/C. A changes owner at 57.655075 seconds; C at 73.15778 seconds. Progress varies with time and can drop after interruption/damage. Ownership changes precede the corresponding victory-score increments. Other 26.10 recordings also contain recapture states with the old owner and a different capturing team.

Playback uses measured progress. Crew perks and multiple occupants are therefore represented by their actual effect; individual perk levels and a universal capture-speed formula have **not** been decoded. Interpolation only bridges adjacent increasing measurements within one second and the same owner/capturing team. Resets, ownership changes and larger gaps are not interpolated. Seeking backwards reconstructs state independently.

Previously saved parsed replays lack these newly decoded events and need reimport from the original `.tbreplay`. Map geometry does not need reimport.

## Allied lamp: experimental evidence only

Arena method 55, notification discriminator 16, outer protobuf field 15 contains entity ID (field 1), notification type (field 2), flags (field 3). Type 1 / flag 1 appears for allies and is a candidate spotting notification. The Skit replay has 20 such notifications across seven allies; the recorder has events around 30.85, 60.16 and 96.26 seconds. Flag 8 occurs around damage and is not interpreted as spotting.

These candidates are preserved with raw payload and `Experimental` confidence, but excluded from frontend presentation. Their meaning must be matched to an actual game HUD/video before claiming they are lamp events. No confirmed unspot event or lamp duration is available. Vehicle property 0 flickers rapidly and is not a reliable allied lamp.

## Checks

- `TBReplays.MapTests --capture-points-only <game Maps directory> <original replay>`: all source coordinates, known ownership timestamps, malformed/truncated packets and unknown version.
- Frontend `tests/capture-points.mjs`: variable rates, ownership timing, resets, gaps and backwards seeking.
- Existing tactical features and replay HUD regression checks, TypeScript check and production build.
- `tests/capture-points-preview.html`: production map loader/viewer with actual wire capture states; isolated local backend test account.
