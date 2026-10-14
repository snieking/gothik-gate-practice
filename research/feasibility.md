# Gothik gate trainer feasibility

Investigated on 14 October 2026. This is a feasibility record, not a claim that a faithful trainer already exists.

A browser trainer can use the exact installed Classic Era art and geometry. The remaining risk is reproducing the jump's movement and collision behavior closely enough that practice transfers to the real client. Textures provide the visual alignment cues. They do not define the surfaces the player can stand on.

## Local extraction is possible

The root agent found `/Applications/World of Warcraft/_classic_era_/World of Warcraft Classic.app`, with active Era build `1.15.9.70003` and build key `2417084b8b041ee120d02d4adf31b0bc`. An offline, read-only extraction from this installed product succeeded for:

| Asset | FileDataID | Extracted bytes | Header |
| --- | ---: | ---: | --- |
| `World/WMO/Dungeon/LD_Stratholme/Stratholme_raid.wmo` | 110251 | 186,292 | WMO `MVER` chunk |
| `World/Lordaeron/STRATHOLME/ActiveDoodads/Doors/nox_door_portcullis.m2` | 203994 | 10,482 | `MD21` |
| Room material texture, referenced by local `MOMT` | 127844 | 44,876 | `BLP2`, 256 by 256 pixels |
| Room group `Stratholme_raid_015.wmo` | 110267 | 311,948 | WMO group with triangle flags |
| Room group `Stratholme_raid_016.wmo` | 110268 | 91,298 | WMO group with triangle flags |
| Room group `Stratholme_raid_017.wmo` | 110269 | 597,176 | WMO group with triangle flags |

The extracted files are in the workspace's `work/gothik-local-assets` directory. The room groups contain `MOVT` vertices, `MOVI` triangle indices, and `MOPY` triangle flags. This establishes access to actual local textures and geometry. It does not establish that the portcullis is the exact gate variant and transform used for the desired jump.

The probe needed a temporary storage view containing a copy of the Era build manifest and symlinks to the client's shared configuration and archive files. It used a throwaway CascLib build with a read-only file-existence fix and a macOS type alias fix. The game installation was not modified. The Era product directory has newer revision-8 archive indices, but the shared revision-7 indices still resolved these files. Broad claims of extractor compatibility should not replace this empirical check.

[wow.export](https://github.com/Kruithne/wow.export) supports local Classic assets, WMO/M2 previews, and OBJ/glTF exports. Its [June 2026 releases](https://github.com/Kruithne/wow.export/releases/tag/0.2.19) include macOS ARM64 builds. However, its current [local CASC reader](https://github.com/Kruithne/wow.export/blob/c2fd7bde36a712be78a5da896c995b84fbfa2545/src/js/casc/casc-source-local.js#L256-L286) still assumes the old shared layout and 18-byte index entries. Its fallback can use CDN files, so an import must record and verify the selected build instead of quietly accepting another product version.

## Which room and gate

The [wowdev filename index](https://github.com/wowdev/wow-listfile/blob/a5fd56b5d382d2173c492d470e870f47a21f68e4/parts/world-wmo.csv#L3517) identifies the root Naxx WMO above. Groups `_000` through `_064` map to IDs `110252` through `110316`. Later groups have other IDs. The local root WMO contains 73 groups with a `GFID` list and group names in `MOGN`, so use its actual IDs to select files. Its materials reference modern FileDataIDs rather than a `MOTX` filename block. The [model index](https://github.com/wowdev/wow-listfile/blob/a5fd56b5d382d2173c492d470e870f47a21f68e4/parts/world.csv#L14867) identifies the portcullis and its skin file `508777`.

[CMaNGOS Classic's instance definitions](https://github.com/cmangos/mangos-classic/blob/master/src/game/AI/ScriptDevAI/scripts/eastern_kingdoms/naxxramas/naxxramas.h#L127-L131) distinguish entry gate `181124`, exit gate `181125`, and the central combat gate `181170`. The speedrun technique is expected to use the exit toward Four Horsemen trash, pending frame inspection. Do not substitute the central divider because both are called Gothik's gate.

Viktor supplied the exact first-hand reference, [Huntard Gothik Gate jump - Classic Era](https://www.youtube.com/watch?v=cRF7w0OOX-U), by Feline-Dragonfang. The title and author were verified through YouTube's public oEmbed API. The root agent inspected the 10-second clip at 0:03, 0:05, 0:08, and 0:09. It shows a Night Elf hunter using the right-hand stone plinth beside the portcullis, entering the wall/gate gap, changing angle, then reaching the far side. The description covers positioning in the gap and a precisely angled forward jump. This confirms the visual approach, but supplies no numeric angle, contact tolerance, or exact key timing.

## Collision must be preserved separately

The [M2 loader](https://github.com/Kruithne/wow.export/blob/c2fd7bde36a712be78a5da896c995b84fbfa2545/src/js/3D/loaders/M2Loader.js#L461-L506) reads dedicated collision positions, indices, normals, and bounds. The [M2 exporter](https://github.com/Kruithne/wow.export/blob/c2fd7bde36a712be78a5da896c995b84fbfa2545/src/js/3D/exporters/M2Exporter.js#L892-L902) can write a separate collision OBJ.

For WMO groups, the [loader](https://github.com/Kruithne/wow.export/blob/c2fd7bde36a712be78a5da896c995b84fbfa2545/src/js/3D/loaders/WMOLoader.js#L390-L460) reads vertices, triangle indices, render batches, and per-triangle flags separately. The [glTF exporter](https://github.com/Kruithne/wow.export/blob/c2fd7bde36a712be78a5da896c995b84fbfa2545/src/js/3D/exporters/WMOExporter.js#L311-L343) exports render batches. Treating that visible mesh as the complete collider can omit hidden collision faces or include decorative faces. [VMaNGOS's extractor](https://github.com/vmangos/core/blob/development/contrib/vmap_extractor/vmapextract/wmo.cpp#L354-L372) explicitly filters triangles by collision, render, and detail flags. That is a source for extracting a candidate collision mesh, not proof of the current Blizzard movement solver.

Keep original coordinates, gate scale/rotation, triangle flags, and dynamic closed-gate state. Do not simplify or weld collision geometry around the jump before verifying behavior.

## What remains unproven

[Blizzard describes Classic as modern code processing old game data](https://worldofwarcraft.blizzard.com/en-gb/news/21881587). A private server using an old client is therefore not automatically the same movement reference. No primary evidence found in this investigation establishes the specific cause of the private-server failure Viktor reported.

The trainer still needs measurements for jump velocity and trajectory, player collision shape, ground detection, step and slope behavior, contact tolerances, input timing, and camera alignment. These are engineering requirements inferred from the task's sensitivity. The asset files alone do not prove them.

The appropriate next proof is a small local scene using the actual room and gate collision. Compare repeated successes and near misses against current Era footage, ideally with the same race, speed buffs, camera, and input sequence. A visually exact scene that accepts jumps the live client rejects would teach the wrong timing. Publish it as a precise trainer only after that comparison supports it.
