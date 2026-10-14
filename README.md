# Gothik gate jump practice

Play at **https://snieking.github.io/gothik-gate-practice/**.

A separate Naxxramas gate-jump calibration prototype. It uses original room
geometry, textures, and collision triangles extracted offline from Classic Era
`1.15.9.70003`. The room geometry is unchanged. The closed gate uses its original
solid collision box, including the narrow seam beside the stone plinth.

The browser movement controller is provisional. A success here does not yet
establish that the same attempt succeeds in live Era. Gate placement comes from
a reconstructed Classic database rather than measurements from a live server.

## Practice

Choose **Full approach** to practice reaching the ledge, or **From the ledge**
to focus on the seam. The latter uses a reproducible prototype position and
facing, not a verified live-client checkpoint.

| Input | Action |
| --- | --- |
| W / S | Forward / backward |
| A / D | Turn; strafe while holding right mouse |
| Q / E | Strafe left / right |
| Right mouse | Turn the character and camera |
| Left mouse | Orbit the camera |
| Both mouse buttons | Move forward |
| Space | Jump |
| Mouse wheel | Zoom between first and third person |
| V | First person, third person, room overview |
| R | Restart the selected starting position |
| P / Escape | Pause |
| T | Show the last attempt's path |

The runner is the original Classic Era Night Elf female, with her original
skinned mesh, 141-bone skeleton, clothing textures, run, backward walk, jump,
landing, falling and occasional flip animations. The unit portrait is rendered
from that same model. Animation timing comes from the model; the browser's
animation state transitions and strafe orientation still need live comparison.

## Calibration

Calibration exposes movement speed, jump velocity, gravity, collider dimensions,
step height, slope limit, contact margin, ground snap, and air steering. You can
also correct the gate's placement. The same transform moves its visible model
and original collider.

The default speed is untalented **Aspect of the Cheetah + Zanza, 130%,
9.1 yd/s**. Current client data places both spells in the same speed-aura
category; Classic emulator code selects the strongest effect. Pathfinding
presets include 133% and 136%. A live recording should confirm the particular
hunter's speed. No-buff and Zanza-only presets are also available.

Baseline run speed `7`, backward speed `4.5`, and gravity `19.2911` follow Classic
emulator references. Jump velocity `7.9555` remains unverified. Collider defaults
now use radius `0.27777779` and height `2.25`, based on the Night Elf model's
original width and height. **That metadata does not prove the player's live
terrain collider.** The old radius `0.15` was chosen to permit a route and is no
longer the default. The revised profile uses a new local-storage key so those
old fitted settings do not silently carry over.

The controller advances at 240 fixed steps per second. Ground support sweeps
the foot sphere across the original triangles without applying sideways
correction from gravity. Wall blocking is horizontal; it cannot manufacture
upward velocity. Jump motion follows the selected ballistic parameters,
ceilings stop ascent, unsupported ledge exits fall, and valid landings stop
gravity. These corrections remove artificial sliding and wall boosts; they are
not a reconstruction of Blizzard's private movement solver. Airborne launch
direction is retained by default, with adjustable running-jump air steering for comparison.

There is no correct-angle trigger, shortcut through the bars, or modified
opening that awards a success. Success requires reaching the ledge and landing
beyond the closed gate. A clear remains a prototype result.

Export attempt JSON to record position, facing, key and mouse events, contact
profile, gate transform, and asset build. Calibration exports can be imported.
Data stays in the browser unless you choose to export or share it. Settings use
local storage. The app has no analytics or backend.

Compare repeated successes and near misses against the same race, speed buffs,
camera, and starting position in Era before relying on training transfer. The
[reference video](https://www.youtube.com/watch?v=cRF7w0OOX-U) demonstrates the
route but does not establish numeric contact tolerances or input timing.

## Standing jump and W tap

Press **Space first** while standing still, then briefly tap **W** after takeoff.
The first forward input starts a small drift that continues after W is released.
Pressing W before Space produces a running jump instead. The controller preserves
this key order even when both events arrive in the same browser frame.

Standing-jump input works with forward, backward and strafe movement. It
initiates a reduced horizontal speed rather than granting every running jump
full air steering. The provisional nudge speed is **1 yd/s**, adjustable in
Calibration. This number is not a verified Era constant and was not chosen by
searching for a successful gate-jump profile. Exact drift speed and buff scaling
still require live measurements. The user's observed release behavior confirms
that the drift should continue until landing.

The [jump research](research/jump-w-tap.md) cites firsthand Classic ledge reports,
current client bindings and the distinct zero-to-nonzero jump-speed case in
movement validation code. Those sources support implementing the input sequence,
not claiming a recovered Blizzard contact solver.

## Compare with Era

**Compare Era** accepts JSON from the optional
[GothikMovementRecorder](addons/GothikMovementRecorder/README.md). Download it
from the dialog, install it yourself, then record one manual case at a time:
standing on the ledge, jumping from a standstill, a running jump with key release
and mouse turning, and a jump into a wall. The addon is passive and has not been
installed or exercised in the live client by this project.

The browser plots available height, horizontal distance or reported speed and overlays the first
browser jump. A measured run speed can be staged in Calibration before applying.
Unavailable coordinates remain unavailable. Instance restrictions may prevent a
height plot; speed and input timing can still be recorded. The tool does not
invent a 3D path or silently align unknown coordinate axes. Recordings are not
uploaded or saved in local storage.

The [movement research](research/movement-contact.md) separates current client
data, emulator rules, player observations, and the measurements still needed.

## Local development and assets

Serve `docs/` with Python 3. From the repository root, in fish:

```fish
python3 -m http.server 8768 --bind 127.0.0.1 --directory docs
```

Then open http://127.0.0.1:8768/. No build or package installation is required.
For the ledge-contact regression needed to validate movement changes:

```fish
npm run check
npm run check:movement
```

The movement check also runs with `node scripts/check-movement.mjs --local` on
17 nearby original room triangles. It verifies idle ledge support, falling after
walking off, a blocked wall, and absence of extra jump height from wall contact.

Three.js r160 is vendored with its MIT license. GitHub Pages serves `main:/docs`.

The [offline importer](scripts/README.md) explains how to rebuild the narrow
scene from a local client without changing its installation or downloading
replacement files. The [asset manifest](docs/assets/scene/manifest.json)
records source file IDs, build, and hashes. Client archives, raw database files,
credentials, and unrelated assets are excluded.

The [research notes](research/) distinguish client-derived assets, reconstructed
gate placement, and unverified movement parameters.

## Credits

Practice concept by **Sniekin-Pyrewood Village**. World of Warcraft art and
assets belong to Blizzard Entertainment. This is an unofficial fan prototype.
The [MIT license](LICENSE) covers the trainer code, excluding Blizzard assets
and third-party files with their own licenses.
