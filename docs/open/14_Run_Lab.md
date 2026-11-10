# 14 — Run lab: live speed and Fast Run keyframes

Designed and implemented on 2026-11-09. The user wanted a fixture showing one player running, with live speed control and a way to edit the run animation's keyframes.

## User decisions

- **Player:** the real simulated L3 player (physics, foot planner, retargeted clip), not a raw clip playback. Edits show how the run looks in the simulation.
- **Speed:** a live slider; the player speeds up or slows down without a restart.
- **Editing:** a frame strip with angle sliders per joint. A stick-figure ghost beside the runner shows the selected frame.
- **Keeping edits:** a save button writes a file from the lab, and a copy button puts the same text on the clipboard to paste into a session.

## What it is

`L3-F18-runLab` (`src/sim/fixtures/transitions.ts`, `runLab()`) is one player on the model, on the full L3 set, using the L3-F16-sprint source (the sprint motor, 6.8 m/s ceiling). The registered fixture runs at a constant 5 m/s, with no ball, for 6 s, on a 40 m half-length area. It is in the review set as "Run lab: live speed, edit Fast Run keyframes".

In the lab (`src/lab/run-lab.ts`), opening that fixture shows the run lab panel. The lab runs its own copy of the fixture: 60 s long, an 800 m area, starting at x = 0, with the current speed, ball choice and edited clip.

- **Speed (0–6.6 m/s):** a slider change adds a script segment at the simulation's current time, so the request changes on the next tick. The look-ahead is capped at 3 ticks (`Playback.maxLeadTicks`), so the change shows within about 50 ms. The whole range plays as in a game fixture: Fast Run, the jog below its slowest cadence, the walk, and standing.
- **Restarts:** the run starts again at the current speed (a running start) when it reaches x = 350 m or its 60 s end, and after every committed edit. Reset does the same. The camera stays where the user put it across reloads of the same fixture (this also applies to the tune panels).
- **Frame strip:** the 16 cycle frames. Blue means the left foot is down, brown the right; a white ring marks the runner's current frame and a dot marks an edited frame. Next to the strip are the frame time and which feet are down.
- **Joints, per side:** hip (flex: thigh forward; abduct: leg out), knee (flex: more bend), ankle (flex: toes up), shoulder (flex: arm forward; abduct: arm out), elbow (flex: more bend). Each channel is limited to ±45°.
- **Spread:** an edit on one frame can also go to its neighbours on the loop. ±1 gives each neighbour half; ±2 gives two-thirds and one-third.
- **Applying edits:** the ghost follows the slider while it moves. On release, the edit is committed and the edited clip goes through intake (`analyzeRunClip`, `decodeRunClip`). If intake passes, the run restarts with the clip; the analysis line shows the nominal speed, stride, stance and flight before and after. If it fails (for example, a foot lifting mid-stance), the panel shows the intake error and the runner keeps the last edits that passed. Undo, reset frame and reset all are available.
- **Save and copy:** save writes `models/animations/fast-run.edits.json` through the dev server (`vite.config.ts`, `/__lab/clip-edits`). The lab reads that file when it opens, and ignores it if it was made for a different Fast Run bake (`baseDataSha256`). Copy puts the same text on the clipboard.

## Edit math (`src/sim/clip-edit.ts`)

An edit turns a joint's child joints and their rotation tracks about the joint, so every bone length stays exactly the same. Hip and shoulder turn in the pelvis (Hips) and chest (Spine2) frames the decoder reads. Knee, elbow and ankle turn about their hinge: the normal of the plane of their two segments, with the frame's axis as a fallback when the joint is straight. Edits on one frame apply proximal first. The closing source frame repeats frame 0's edit, so the loop stays closed. With no edits, the data and the decoded clip are the committed ones.

## Arm swing fix

The user saw the model's forward arm swing rise past the shoulders, far above the clip (the ghost). Two causes, both on the composed (L3) pose that L3, L4 and HC players use; G, L1, L2 and RH poses are unchanged.

**Elbow pole (`src/sim/pose.ts`, arm continuity).** The plan 07 limb continuity rate-limited the elbow pole as if it were a departure, at 3 rad/s. A clip arm's elbow plane turns about 110° each half cycle, so the shown pole lagged and stayed pointing out and back; on the forward swing the IK then threw the elbow out and up. At 5 m/s the shown upper arm reached 12.7° above horizontal, against the clip's 12.9° below. Fix: a clip arm on a composed pose turns its shown pole with the request's own pole each substep (memory `:q`, the previous request pole), as the palm departure is already measured from the moving request. Only a departure from the request (an alternative, a push-out) is still rate-limited, and a request jump (`handed`) is not carried. Ready hands, the brace, the carry hold and the achieved arms are unchanged.

**Arm frame (`src/sim/run-clip.ts`).** The clip stores the arms in its chest (Spine2) frame, and Fast Run's chest leans about 32° forward; the simulated chest stands within about 1° of upright. Put on the upright chest, the arms turned up by the lean, and the forward swing carried the wrist above the shoulder. Fix: the decoder also keeps each arm in the ground frame (`WorkFrame.armG`: the clip's own arm direction in the world, about its heading), and the composed retarget (`groundArms`, `src/sim/pose-runtime.ts`) shows that one, so the hand is as high as the clip shows it whatever the chest lean. The upper arm is eased into the plan 12 shoulder cone (`easeDirIntoEnvelope`, `src/sim/joint-cone.ts`: untouched to 10° inside the boundary less 1°, then compressed onto it), and the forearm turns with it. A hard clamp turned a corner at the boundary and jolted the L3-F16-runStop wrist past its bound (9.1 cm against 9 cm); eased, its peak is 4.9 cm. The back swing, which an upright chest takes further behind, now stops at 42.2° behind the side line.

At 5 m/s the shown wrist runs 0.579 to 0.120 m below the shoulder, against the clip's 0.578 to 0.116 m, and the shown elbow stays within 6° of the request's own elbow (`tests/locomotion.test.ts`, plan 14).

**Impact guard (`src/sim/fall-response.ts`, profile `fall-response-l4-v3`).** With the arms changed, L4-F9-defenderFalling D realised 171 W at 1.192 s, against the 150 W ceiling (157.5 W with the 5% tolerance). R's core was closing on D's right thigh at 3.0 m/s. The guard held D's right leg, as plan 09 has it, but the hit (57 N·s in the next solve) went through the hip into D's core and moved every joint the core parents: the right shoulder realised 44.6 W against its predicted 20.0, the left hip 19.4 W against 0. Fix: a segment jointed to the core (thigh, upper arm) closing faster than `impactGuard.bodyClosingMPerS` (2 m/s) holds the whole body, as a core or head hit already did. It changes 14 L4 summaries, with no result changes, and every fall response stays within its power and work caps.

Consequences: 76 of 411 summaries change (HC 14, L3 37, L4 25: the contact, tackle and fall fixtures); no result changes, and every free run, walk and idle summary is byte-identical. Tests:

- **Gone, known limits:** HC-F3-falling D (13f, rejected at 1.68 cm) converts and is audited like every other HC variant. L3-F9-defenderRising, L3-F9-defenderFalling and L3-F1-falling D (13d and 13f) convert at their labelled conversion again, audited, with nothing rejected (`DEFENDER_13F`). The request seam of L3-F9-lift-free R is back under its 15 m/s bound (the first fix's `KNOWN_SEAM` is gone).
- **Moved controls:** the 13e settle fault (`settleOneSubstep`) now shows on L3-F7-phase50 D left at 0.575 s. The 13f guard fault keeps only reversed L3-F9-noProbe-contact (1.74 cm), since HC-F3-phase75 now converts without the prediction too. The step-as-is check runs on L3-F4-twoArm (D's only supported-to-airborne boundary, 1.36 s); no L3-F1 run has one now. The first-solve load check runs on HC-F2-lift1.4 (1.76 BW). The self-clearance control is 2.17 cm and the ragdoll shoulder control 47.3° behind (L3-F1-low).
- **Test fix:** L4-F9 compares conversion audits with its L3 source only when both convert at the same time: L4-F9-defenderRising D converts at 1.4125 s in both, after R's conversion at 0.804 s has made the runs differ.
- **Known limit (user ruling 2026-11-10, pinned at the measured value):** the transition audit's L3-F3-side R right shoe at 0.592 s, 1.029 cm (limit 1 cm; `KNOWN_AUDIT`).

## Scope

Only the run lab reads the edits file. `fast-run.json`, its intake record and every other fixture are unchanged. The static floor now grows with the practice area (`max(40, half length + 10)` m, `PhysicsWorld`), so only the run lab's floor changes. `evidence/summary.json` gains the `L3-F18-runLab` entry; the arm swing fix changes the 76 summaries above.

Not done: baking edits into `fast-run.json` (with `npm run intake-clips`). That changes every L3, L4 and HC run fixture and waits for the user's word.
