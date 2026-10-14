# Standing jump followed by a W tap

Investigated on 14 October 2026 for the Gothik prototype. A standing takeoff followed by forward input must be able to produce horizontal movement. Setting every airborne input to zero prevents the technique reported by the user and described by other Classic players. This supports a distinct standing-jump input mode. The public sources do not establish full run-speed steering or a numerical air-control rate. The user separately confirmed continued drift after W release.

## Evidence tiers

The user's current Era experience is the closest first-hand reference for this trainer: jumping from a standstill and briefly pressing W can reach tight ledges. The user subsequently confirmed Space first, then W once airborne, and continued forward drift after W is released. The supplied [Gothik clip](https://www.youtube.com/watch?v=cRF7w0OOX-U) confirms the right-hand plinth and successful gate route, but has no visible input timeline or numeric movement readout. Its motion cannot settle those details.

A January 2020 Classic player explicitly describes pressing Space first, then W after takeoff, changing a vertical jump into slight forward motion. The author reports a bug that reduces this drift while normal forward jumps remain unaffected. This is first-hand support for standing initiation being different from a running jump. It is older Classic evidence, with no numeric speed, acceleration, or release measurement. The linked Twitch VOD was unavailable during this research. [Player's report](https://www.reddit.com/r/classicwow/comments/eqa59b/)

A January 2024 Classic ledge discussion instructs the player to stop W before landing on a tiny lip, then jump upward and press W in midair for the next step. That is another account of the technique. The retrieved text does not identify an exact client build or establish whether releasing W brakes in the air or merely prevents walking off on landing. Do not infer aerial braking from that advice alone. [Ledge discussion](https://www.reddit.com/r/classicwow/comments/19a03zh/)

The 2021 wall-jump video author explains using separately bound jump and forward keys pressed together, and confirms the footage was recorded on live Firemaw EU. That supports a separate near-simultaneous ground-impulse technique, where input ordering matters. It does not prove the later W-tap behavior or a particular air speed. [Author's explanation](https://www.reddit.com/r/classicwow/comments/m0kaak/i_spend_8_months_making_the_ultimate_wall_jumping/)

## Current client input source

Offline extraction from the installed Era `1.15.9.70003` client recovered `Bindings_Vanilla.xml`, FileDataID `5613921`. The `MOVEFORWARD` binding calls `MoveForwardStart` on key down and `MoveForwardStop` on key up. It has no airborne guard. `JUMP` separately calls `JumpOrAscendStart` on key down. Those two blocks exactly match the pinned public Era UI mirror; the whole file is not byte-identical. This proves the current client forwards both input edges to native movement functions. The XML does not implement the native movement algorithm or promise that a stop request removes airborne momentum. [Forward binding](https://github.com/Gethe/wow-ui-source/blob/8165d4cd6e48d606369336cc3a7977902310e81e/Interface/AddOns/Blizzard_FrameXML/Bindings_Vanilla.xml#L11-L17), [jump binding](https://github.com/Gethe/wow-ui-source/blob/8165d4cd6e48d606369336cc3a7977902310e81e/Interface/AddOns/Blizzard_FrameXML/Bindings_Vanilla.xml#L53-L59)

No current Era standing-jump speed limit or acceleration was recovered from the client metadata inspected for this project. Character collision dimensions and animation data do not specify that rule. The client was not patched, injected into, or exercised through automated movement.

## What the vanilla protocol reference shows

VMaNGOS is a Classic emulator source, not Blizzard's current Era controller. Its movement packet decoder reads facing separately from `jump.cosAngle`, `jump.sinAngle`, and `jump.xyspeed` whenever the jumping flag is present. Those fields describe airborne direction and horizontal speed rather than deriving every airborne step from current facing or a held forward key. [Packet decoder](https://github.com/vmangos/core/blob/53d24d5c748bef5e0cde7b1155bcb3d979af614c/src/game/Objects/Object.cpp#L62-L104)

Its movement validation checks increases in jump XY speed only when the previous packet's XY speed is already above `0.0001`. Consequently, initial zero-to-nonzero horizontal speed is exempt from that particular check. This is consistent with a standing jump gaining horizontal motion after takeoff. The `0.0001` value is a validation tolerance, not an air-control speed or acceleration. The code neither computes a standing-jump cap nor specifies W-release behavior. [Initial-zero exception](https://github.com/vmangos/core/blob/53d24d5c748bef5e0cde7b1155bcb3d979af614c/src/game/Anticheat/MovementAnticheat/MovementAnticheat.cpp#L646-L657)

The emulator extrapolates a jumping trajectory using jump direction and XY speed even when no forward movement flag is set. This supports separating airborne travel from current facing and held keys. It still cannot settle release semantics: the client could send a changed XY speed in the next packet. No current Era packet capture or numeric live movement recording was used here. [Extrapolation](https://github.com/vmangos/core/blob/53d24d5c748bef5e0cde7b1155bcb3d979af614c/src/game/Objects/Unit.cpp#L2913-L2925)

## Consequence for the prototype

Keep running-jump launch direction and the standing-jump input case separate. Space after W, Space before W, and two presses in one rendered frame can represent different takeoff conditions. A correction that allows a small forward movement after stationary takeoff can match the reported technique while leaving an already running jump's launch direction intact. Its magnitude, acceleration, timing window and buff scaling remain provisional until measured. Continued drift after release follows the user's current Era observation. Neither unrestricted full-speed aerial steering nor permanent zero aerial input follows from these sources.

Use the existing [passive recorder](../addons/GothikMovementRecorder/README.md) on level ground to compare a stationary jump with no W, jump followed by W held, and jump followed by a short W tap. Record an already running jump with W held and with W released as separate cases. A visible input overlay or synchronized video should establish the actual order. Repeat the short tap at two different delays and then with Cheetah. When real coordinates are readable, displacement during the held interval and after release distinguishes stop-on-release, continued drift, and gradual acceleration. If instance coordinates are unavailable, do the free-air comparison outside Naxx before comparing the actual ledge contact in video. Keep the unsupported numerical constants out of claims about verified Era behavior.

## Implemented behavior

The controller now snapshots movement when Space is pressed. Space followed by W
in the same browser frame therefore remains a standing takeoff; W held before
Space is a running takeoff. With stationary takeoff, the first directional input
initiates a reduced horizontal drift. Releasing W preserves that drift until a
landing. Running takeoff retains its existing launch speed and direction.

The initial standing nudge speed is a provisional `1 yd/s`, separately exposed in
Calibration. This is a browser default, not a measured or recovered Era constant.
It was set before checking any successful room route. The standard ballistic
jump and original room/gate collision geometry remain in use.

The original failing check jumped from rest, waited 125 ms, and tapped W for
62.5 ms. It moved `0` units before the correction. It now moves, keeps drifting
after release, and remains much shorter than a running jump. Additional checks
preserve a purely vertical jump without W, running-jump direction after turning,
and Space/W event order. The same sequence reaches a supported plinth from the
normal approach in the original exported Gothik room, without extra jump height.
A real browser keyboard run also reached the ledge and stayed supported.

Compare Era now includes horizontal distance relative to the first jump request,
so an available live position recording can check the actual nudge distance.
This comparison does not require inventing or aligning a room-coordinate path.
