# Gothik movement recorder

This optional addon records manual movement for comparison with the browser prototype. It is saved in the repository and is not installed in your game client. It reads your own position, facing, reported speed, falling state, directional inputs, race, sex, and client version. It never moves your character or sends data anywhere. Secure posthooks observe manual movement calls without replacing them.

If you choose to use it, copy this `GothikMovementRecorder` folder into your Classic Era `Interface/AddOns` folder, then reload the UI. The interface version is 11509 for the locally inspected 1.15.9 client. API availability is checked at runtime; the addon has not been run in a live game by this project.

Record with `/gothikrecord start 10 idle`. End early with `/gothikrecord stop`. `/gothikrecord export` stops any current recording and opens the most recent session as selected JSON for copying. `/gothikrecord export 1` through `3` selects retained sessions in oldest-first order. `/gothikrecord status` reports whether recording is active. Without a duration, recording lasts 60 seconds; the hard limit is 120. Sampling targets 60 Hz, uses actual game timestamps, and takes at most one sample per rendered frame. It does not invent missing frames.

SavedVariables retain only the last three sessions in `GothikMovementRecorderDB`. WoW writes them to disk during its normal logout or UI reload. The JSON export contains no character name, account identifier, realm, chat, or other players' data.

## Four short recordings

Keep the same character, client, buffs, and frame rate for comparisons. Record one case per session, export it before making a fourth recording, and accompany the measurements with a screen recording if possible.

1. `/gothikrecord start 10 idle`. Stand on the Gothik plinth for ten seconds without touching movement controls. This checks real support and unintended sliding.
2. `/gothikrecord start 10 standing`. On level ground, jump from a complete standstill, then press W just after takeoff. Repeat with W and jump pressed together. Keep the cases distinct in the accompanying video.
3. `/gothikrecord start 10 running`. Run straight, jump, release W just after takeoff, and turn with the right mouse button while airborne. Repeat while keeping W held. Compare the airborne direction and distance before judging stop-on-release or mouse steering.
4. `/gothikrecord start 10 wall`. Run into a solid wall and jump while holding W, then try a shallow angle along it. Finish with the actual Gothik gate attempt. Check whether contact stops, slides, redirects, or raises the character and where it regains support.

For the buff question, use `speed-base`, `speed-zanza`, `speed-cheetah`, and `speed-both` instead of `idle`, run straight on the same level ground, and export each session. `GetUnitSpeed` reports the active speed; when coordinates are available, displacement over time gives an independent comparison.

## Data limits

The exported schema is `gothik-era-recording-v1`. `samples` contain `t`, optional `x`, `y`, `z`, `mapId`, `facing`, `speed`, `falling`, and `inputs`. Directional input names are `forward`, `backward`, `strafeLeft`, `strafeRight`, `turnLeft`, and `turnRight`. `events` contain timestamps and `kind`, including `jump`, `key`, `movement`, and `recording`.

`UnitPosition` may return nil or fail in an instance. The addon omits unavailable coordinates and sets `coordinateAvailability` to true only after a complete numeric position appears. `capture.coordinateSamples` counts those samples. It preserves return order as `x`, `y`, `z`, `mapId`, which are API return values 1 through 4. Confirm their axis order against a known position before aligning a recording with the extracted room. Missing coordinates cannot support a 3D ghost or jump-height measurement. Facing, reported speed, input timing, and falling transitions may still be useful.

Missing input or falling fields mean the API was unavailable. A jump event is an observed manual jump request, not proof of takeoff. Held keys and secure posthooks describe directional intent, which can differ from physical motion at a wall or during a jump. Autorun toggles are recorded as events without guessing the resulting state. The addon records only fixed case names and does not save binding key names.

The generated API documentation and stock Classic Era UI confirm several reads and events, but do not publish Blizzard's terrain contact solver. Measurements from this addon can validate a browser controller; they do not reveal its private implementation. See [movement research](../../research/movement-contact.md) for source details.
