# Gothik exit gate placement and physics basis

Investigated on 14 October 2026 for the prototype. Client-derived geometry and database reconstruction are distinguished below. None of these values establishes complete live-client movement fidelity.

## Exit gate

[CMaNGOS Classic's Naxx instance database](https://github.com/cmangos/classic-db/blob/ec4f596146be6467ea93c57397858e329e2db852/Updates/Instances/533_naxxramas.sql#L2324) places exit object `181125` on map `533` at WoW world coordinates `2633.84, -3336.82, 267.084`, with orientation `0` and quaternion `0, 0, 0, 1`. The [Classic base template](https://github.com/cmangos/classic-db/blob/ec4f596146be6467ea93c57397858e329e2db852/Full_DB/ClassicDB_1_12_1_z2815.sql.gz) gives it display `6676` and scale `0.790041`. These are Classic emulator database values, not coordinates measured from a live Era server. The two-decimal horizontal coordinates limit placement precision.

The installed Era build `1.15.9.70003` supplies `GameObjectDisplayInfo.db2`, FileDataID `1266277`. An offline extraction and WDC5 decode confirmed row `6676` has model FileDataID `203994` and legacy name `WORLD\LORDAERON\STRATHOLME\ACTIVEDOODADS\DOORS\NOX_DOOR_PORTCULLIS.MDX`. The matching model is the already extracted `nox_door_portcullis.m2`. The table's layout hash `7C5F0B90` matches the [WoWDBDefs schema for build 70003](https://github.com/wowdev/WoWDBDefs/blob/master/definitions/GameObjectDisplayInfo.dbd#L106-L135).

The central gate is a different object. Its display `6685` resolves in this same local table to FileDataID `204007`, `DEATHKNIGHT_GATE01.MDX`. Do not use it for the exit jump.

## Naxx WMO transform

Offline extraction of the installed map WDT, FileDataID `827115`, found the relevant object tile at `38, 27`. Its object ADT, FileDataID `825038`, contains this `MODF` record:

| Field | Local client value |
| --- | --- |
| WMO FileDataID | `110251` |
| Instance ID | `631815` |
| ADT position | `20501.0234375, 300.9723205566406, 14060.8828125` |
| ADT rotation | `0, 0, 0` |
| Scale field | `1024`, meaning `1` |
| Flags | `12` |
| Doodad set, name set | `0, 1` |

The neighboring tile's object ADT `827854` repeats that instance and transform. Both raw files remain in `work/gothik-local-assets` with the probe's `.blp` output extension; their contents are ADT binary data.

Using the float32 map origin `533.33333f * 32 = 17066.666015625`, the WMO's WoW world origin is `3005.783203125, -3434.357421875, 300.9723205566406`. With the zero-rotation WMO basis, raw model coordinates map to world coordinates as:

```text
worldX = 3005.783203125 - rawWmoX
worldY = -3434.357421875 - rawWmoY
worldZ = 300.9723205566406 + rawWmoZ
```

This puts the reconstructed exit gate at raw WMO coordinates `371.943203125, -97.537421875, -33.88832055664062`. Game-object orientation zero maps to a half-turn in this WMO's horizontal basis. Apply that conversion before any later Y-up rendering conversion. Validate alignment against the wall and gate frame, then retain the source values for calibration.

## Movement defaults and uncertainty

The [CMaNGOS Classic movement source](https://github.com/cmangos/mangos-classic/blob/8ec338a1704e7dcb1c0213eb7ed58f9231ade40f/src/game/Movement/util.cpp#L22-L29) uses gravity `19.29110527038574` and normal terminal fall speed `60.148003`. Its [unit movement defaults](https://github.com/cmangos/mangos-classic/blob/8ec338a1704e7dcb1c0213eb7ed58f9231ade40f/src/game/Entities/Unit.cpp#L58-L66) are run `7`, walk `2.5`, and backward run `4.5`, in game units per second. These are documented emulator defaults suitable as initial parameters, with current Era verification still required.

A normal jump's commonly quoted upward speed `7.955547` was not verified against a primary Classic source during this investigation. Keep it tunable and label it unverified. The current Era player collider shape, radius, height, step height, contact tolerances, slope rules, and midair input behavior are also unverified. A combat bounding radius or a visual character model does not demonstrate the terrain movement collider.

The first-hand [Night Elf hunter jump video](https://www.youtube.com/watch?v=cRF7w0OOX-U) confirms the right-hand plinth and wall/gate gap approach. Its ten seconds do not establish numeric angle or frame timing. [Blizzard's Classic development account](https://worldofwarcraft.blizzard.com/en-gb/news/21881587) confirms modern code processes Classic data; it does not document this jump solver. No verified explanation was found for why the same maneuver fails on particular private servers.
