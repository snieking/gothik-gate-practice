# Classic Era movement and Gothik wall contact

Investigated on 14 October 2026 against the installed Classic Era client `1.15.9.70003`, public Classic source references, and first-hand player recordings. The room assets are authentic client data. Exact terrain movement is still unverified. Blizzard describes Classic as old game data processed by modern code, so a 1.12 emulator controller cannot establish current Era fidelity. [Blizzard's development account](https://worldofwarcraft.blizzard.com/en-gb/news/21881587)

## What the movement evidence establishes

| Question | Evidence | Remaining check on build 70003 |
| --- | --- | --- |
| Does turning in midair redirect an already running jump? | First-hand Classic hunter descriptions explain jumping, facing backward for a shot, and continuing along the original travel direction. This supports launch-direction inertia in that 2020 client. [Classic player discussion](https://us.forums.blizzard.com/en/wow/t/jumping-in-combat/439577) | Measure facing and horizontal displacement during a right-mouse turn. |
| Does releasing W stop an airborne jump? | No verified current Era recording was found that isolates release from collision and landing. A jump-spin description alone does not establish key-release behavior. | Compare a running jump with W held against the same jump with W released just after takeoff. |
| Does a standing jump followed by W become a normal running jump? | A first-hand Classic player reports slight forward motion after jumping from a standstill, with occasional reduced drift, while normal running jumps remain distinct. The linked old Twitch clip is no longer available for frame analysis. [Player's 2020 report](https://www.reddit.com/r/classicwow/comments/eqa59b/) | Measure Space-before-W separately from W-before-Space. Do not grant full run speed in the air without evidence. |
| What happens at the Gothik wall and gate? | The supplied Night Elf hunter clip shows the right-hand plinth, pushing into the gate/wall gap, a precise change of facing, and reaching the far side. [First-hand Era clip](https://www.youtube.com/watch?v=cRF7w0OOX-U) | It does not expose numeric angles, input timing, collision shape, or whether contact preserves, removes, or redirects a component of velocity. |

No primary current Era specification was found for wall friction, grounded footprint, step height, slope threshold, contact tolerances, airborne steering rate, or contact-induced vertical motion. Separating stable ground support from horizontal wall correction fixes the prototype's artificial idle sliding. That is an engineering correction, not a recovered Blizzard solver.

The Classic emulator reference uses run speed `7`, backward run `4.5`, walk `2.5`, and gravity `19.29110527038574`. They are reference parameters, not measurements from this installed client. The commonly repeated jump impulse `7.955547` was not verified against a primary Classic source. With that impulse and this gravity, the calculated level-ground apex would be about `1.64` units and airtime about `0.825` seconds. Those calculations remain conditional on the unverified impulse. [CMaNGOS movement defaults](https://github.com/cmangos/mangos-classic/blob/8ec338a1704e7dcb1c0213eb7ed58f9231ade40f/src/game/Entities/Unit.cpp#L58-L66), [gravity implementation](https://github.com/cmangos/mangos-classic/blob/8ec338a1704e7dcb1c0213eb7ed58f9231ade40f/src/game/Movement/util.cpp#L22-L29)

## Actual character metadata and reconstructed gap

Offline, read-only extraction of build 70003 confirms Night Elf female race/display/model data as follows. `ChrRaces` row `4` points to female display `56`; `CreatureDisplayInfo` row `56` points to model `56`, with scale `1`. `CreatureModelData` row `56` points to FileDataID `120590`, `Character/NightElf/Female/NightElfFemale.m2`, and contains `CollisionWidth = 0.5555555820465088` and `CollisionHeight = 2.25`. Its visual box is `[-0.6519121, -0.3872841, 0.0011167]` to `[0.3428890, 0.5899401, 2.2539260]`. These field names do not prove a terrain capsule, whether width means diameter, or the movement solver's contact footprint. [Current table definitions](https://github.com/wowdev/WoWDBDefs/blob/master/definitions/CreatureModelData.dbd#L532-L574), [display table definition](https://github.com/wowdev/WoWDBDefs/blob/master/definitions/CreatureDisplayInfo.dbd#L351-L394)

The asset conversion retains the portcullis's dedicated twelve-triangle collision box and the original group 17 wall geometry. With the Classic database placement and scale described in [the placement note](gate-placement-and-physics.md), the reconstructed gate's lower side edge is raw WMO Y `-104.51059`. At X `372`, the nominal gap is about `0.168` at Z `-31.253`, `0.287` at Z `-30`, and `0.352` at Z `-29.3`. The plinth floor is near Z `-33.28656`, its lip near `-31.80075`, and its top near `-31.25308`. A browser capsule radius `0.35`, height `1.95`, does not pass a nominal `1.82` jump through this reconstruction. Shrinking the radius to `0.15` to make a route possible would not validate it. The rounded emulator spawn position, pose, and live Era contact solver remain separate sources of uncertainty.

## Zanza and Cheetah

The user's Zanza is assumed to mean Swiftness of Zanza, spell `24383`. The installed build's `SpellEffect.db2`, FileDataID `1140088`, layout `F09BE50E`, gives:

| Spell | Effect row | Aura type | Base points | Die side | Nominal amount |
| --- | --- | --- | --- | --- | --- |
| Aspect of the Cheetah `5118` | `683537` | `31` | `29` | `1` | `30%` |
| Swiftness of Zanza `24383` | `701429` | `31` | `19` | `1` | `20%` |

Both are the same increase-run-speed aura category. CMaNGOS Classic selects its strongest positive modifier for that category. This gives a source-backed initial preset of `130%`, `9.1` units per second, for untalented Cheetah with Zanza active. It does not support adding the percentages or multiplying them. The spell amounts come from current client data; the stacking rule comes from emulator implementation. A current live `GetUnitSpeed` measurement should confirm the combination. [SpellEffect definition](https://github.com/wowdev/WoWDBDefs/blob/master/definitions/SpellEffect.dbd#L368-L407), [aura enumeration](https://github.com/cmangos/mangos-classic/blob/8ec338a1704e7dcb1c0213eb7ed58f9231ade40f/src/game/Spells/SpellAuraDefines.h), [speed modifier implementation](https://github.com/cmangos/mangos-classic/blob/8ec338a1704e7dcb1c0213eb7ed58f9231ade40f/src/game/Entities/Unit.cpp#L8337-L8386)

Pathfinding ranks `19559` and `19560` also exist in the extracted effect data as flat spell modifiers with nominal values `3` and `6`. Talents and other effects can change the actual Cheetah speed. Do not label `9.1` as the speed of the particular reference hunter until measured.

## Passive measurement addon

[GothikMovementRecorder](../addons/GothikMovementRecorder/README.md) is an optional, uninstalled addon in this repository. It samples only the player's public reads and observes manual movement with optional secure posthooks. It never invokes movement APIs, changes bindings, transmits data, or collects player names, account data, realms, chat, or other players. Explicit start, stop, and export commands produce `gothik-era-recording-v1` JSON; SavedVariables retain the last three sessions. Sampling targets 60 Hz, records actual timestamps, takes at most one sample per frame, and stops within the requested capture of at most 120 seconds once the next frame runs.

The current installed client contains the names `UnitPosition`, `GetUnitSpeed`, `GetPlayerFacing`, `IsFalling`, `IsKeyDown`, `IsMouseButtonDown`, `GetBindingKey`, and `GetTimePreciseSec`. That static evidence does not prove readable values inside Naxxramas. Generated Era API docs explicitly list movement-start/stop and mouse events; stock Classic UI code uses `IsFalling`, `IsKeyDown`, and mouse-button reads. The generated clock docs list `GetTimePreciseSec`. [Movement event docs](https://github.com/Gethe/wow-ui-source/blob/8165d4cd6e48d606369336cc3a7977902310e81e/Interface/AddOns/Blizzard_APIDocumentationGenerated/UnitDocumentation.lua), [stock Classic falling check](https://github.com/Gethe/wow-ui-source/blob/8165d4cd6e48d606369336cc3a7977902310e81e/Interface/AddOns/Blizzard_QueueStatusFrame/Classic/QueueStatusFrame.lua#L863), [key polling](https://github.com/Gethe/wow-ui-source/blob/8165d4cd6e48d606369336cc3a7977902310e81e/Interface/AddOns/Blizzard_SharedXML/KeyCommand.lua#L112), [clock docs](https://github.com/Gethe/wow-ui-source/blob/8165d4cd6e48d606369336cc3a7977902310e81e/Interface/AddOns/Blizzard_APIDocumentationGenerated/OsDocumentation.lua#L26)

Every optional read and hook is feature-probed with `pcall`. Missing positions stay missing, with `coordinateAvailability = false` until a complete numeric position appears. The addon preserves `UnitPosition` return order and records its interpretation; scene alignment must confirm axis order. Without coordinates, recordings can compare input timing, reported speed, facing, and falling transitions, but cannot provide a 3D trajectory or jump height. A jump event denotes the manual request, not proven takeoff.

The README gives four short cases: idle on the ledge, standing jump followed by W, running jump with W released and mouse turning, and jumping into a wall. For speed stacking, export separate runs with no speed buffs, Zanza only, Cheetah only, and both. Keep character, talents, frame rate, and geometry unchanged. When coordinates work, fit a free jump's Z displacement to elapsed time and compare horizontal displacement before and after release, turning, and contact. Use a video with visible inputs when reads fail in the raid.

Standalone Lua checks passed syntax, JSON parsing, false booleans, missing coordinates, empty arrays, retention, and zero movement API calls. The addon has not been installed or exercised in a live client. No exact movement-fidelity claim is justified yet.

## Controller correction and its limits

The original regression reproduced a horizontal drift of `0.144929` units and
a height loss of `1.521586` after ten idle seconds on the ledge. Removing the
gate and distant room geometry, leaving 17 original nearby triangles, preserved
the same failure. Grounded gravity followed by capsule depenetration along a
walkable slope caused the drift; the center-only ray also missed the supported
foot sphere's height.

The correction uses vertical footprint support for faces, edges and vertices,
keeps supported X/Y fixed when there is no input, and resolves wall displacement
separately from ballistic Z. The former `0.15` profile and the model-dimension
profile both now hold the ledge for ten seconds with zero measured drift or
height loss in the minimized and full-room checks. Walking off loses support
and falls. An unobstructed jump and a jump into a vertical wall reach the same
conditional `1.64039` apex. These are controller regression checks, not live Era
physics measurements.

The model-dimension defaults are deliberately labeled provisional for terrain
collision. They were not selected by searching for a successful gate jump.
The original scene geometry and gate collider have not been widened or modified.
