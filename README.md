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

The third-person marker shows the controller's capsule. It is not a replacement
for the player's original character model. Original room textures supply the
ledge and seam alignment cues.

## Calibration

Calibration exposes movement speed, jump velocity, gravity, collider dimensions,
step height, slope limit, contact margin, ground snap, and air steering. You can
also correct the gate's placement. The same transform moves its visible model
and original collider.

Run speed `7`, backward speed `4.5`, and gravity `19.2911` follow Classic emulator
references. Jump velocity `7.9555`, capsule height `1.95`, radius `0.15`, and the
contact rules are unverified parameters. Radius `0.15` is a provisional profile
that permits a physically resolved ledge route in the exported scene while the
closed gate blocks direct movement. It is not a measurement of Era's player
collision radius.

The controller advances at 240 fixed steps per second. Its collision solver
resolves capsule contacts against original triangles. There is no correct-angle
trigger, shortcut through the bars, or modified opening that awards a success.
Success requires reaching the ledge and landing beyond the closed gate.

Export attempt JSON to record position, facing, key and mouse events, contact
profile, gate transform, and asset build. Calibration exports can be imported.
Data stays in the browser unless you choose to export or share it. Settings use
local storage. The app has no analytics or backend.

Compare repeated successes and near misses against the same race, speed buffs,
camera, and starting position in Era before relying on training transfer. The
[reference video](https://www.youtube.com/watch?v=cRF7w0OOX-U) demonstrates the
route but does not establish numeric contact tolerances or input timing.

## Local development and assets

Serve `docs/` with Python 3. From the repository root, in fish:

```fish
python3 -m http.server 8768 --bind 127.0.0.1 --directory docs
```

Then open http://127.0.0.1:8768/. No build or package installation is required.
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
