# 13e — Idle and walk where they belong

Repository-aligned plan • 2026-11-09 • Part of [plan 13](13_Lab_Review_Pass.md). Follows 13d. **Implemented 2026-11-09** ([handoff](../handoff/plan13.md#13e--idle-and-walk-where-they-belong)).

**Goal:**
- A standing player plays the supplied idle cycle, not one frozen frame.
- Every current-path fixture on the player model stands, walks and runs on the supplied clips: idle, walk and Fast Run.

## Why

The user (2026-11-09): use the idle and walk animations where appropriate.

**Idle today.** Plan 08 took one frame (71 of 251) of the supplied 8.33 s idle and fitted it as a static posture (`IDLE_POSE_RECORD`, `LOCOMOTION_L3.idle`). The cycle is not played. Plan 08 left the cycle as optional: "only play the idle cycle if its motion adds value after the posture fits". The intake measured the cycle: seam 0, root drift 1.26 cm, root bob 0.14 cm, feet move 0.08 cm. The pose's head is rigid on the core (`segs.head` takes the core rotation).

**Coverage today.** Of the 194 L3, L4 and HC fixtures, the full set (L3 locomotion, the walk and the run clips) is on 87. On the player model:

| Path | Fixtures | Today |
| --- | --- | --- |
| L3, model | 74 | Full set |
| L3, model | 20 | L3 locomotion (static idle, procedural walk arms) but no clips: procedural gait at every speed. `asL3` adds clips only when the source fixture had them. |
| L4, model, from L3 | 13 + 3 | As their L3 source |
| L4, model, tipped falls | 12 | No locomotion; converted at 0.05 s |
| HC, model | 10 | L2 foot planner and the run clips, no walk, no idle |
| HC, model | 12 | No foot planner, no clips: legacy legs |
| L3 and L4, authored body | 50 | Drawn as primitives in the lab |

## User decisions (2026-11-09)

- **Play the idle cycle:** arms, head and the small weight sway follow the 8.33 s loop. Feet stay planted; the physics still owns support and height. Players start at different phases, so two players do not sway together.
- **Scope:** L3, L4 and HC. HC moves from the L2 to the L3 foot planner. Changed summaries are listed, not tuned back.

## Design

**Where the set applies.** A new helper `withLocomotion(def)` (fixtures/transitions.ts) sets `footwork: FOOTWORK_L3`, `locomotion: LOCOMOTION_L3` and `runClips: runClipsL3(def.runClips ?? runClipsBew())`. `asL3` and the HC `label` builder call it; `asL4` inherits it through its L3 sources. Two kinds of fixture are left as they are, each for a reason recorded in the fixture notes:
- **Authored body** (50): the clips and the fitted idle are calibrated to the player model, and these fixtures exist to test physics on the test body.
- **Converted before it can stand** (the 12 L4 tipped falls, `diagnostics.conversions` with `atS < 0.5` for every player): the player never stands or moves while supported. Giving it locomotion would only change its starting pose and so its fall evidence.

HC keeps its support profile, carry, rules and diagnostics; only the foot planner, locomotion and clips change. L3 already runs the L3 planner on the RH support (L3-F9-playerBelow, L3-F10).

**Idle cycle.**
- *Intake.* `scripts/model/idle-intake.ts` records, for all 251 frames: each arm's upper and forearm directions in the chest (Spine2) frame, as frame 71 is recorded now; the head's rotation relative to the chest; and the hips' horizontal offset from their cycle mean, in the root frame. `idle-pose.record.json` gains `cycle: { frames, upper, fore, head, hips }`. The static `arms` and `stance` stay for the stance width and the stagger.
- *Phase.* Each player's idle phase is `frac(t / 8.333 + u0)`, from simulation time, with `u0 = frac(0.618 × player index)`. It needs no state, so a reset or a pause cannot shift it.
- *Weight.* The idle weight is the existing `idleStanceFade(speed)` (1 at rest, 0 from 1.5 m/s), and 0 outside locomotion mode `free` (prep, contact and exit keep their poses) or when not supported.
- *Arms.* A free arm's rest target (`lo.profile.idle.arms[s]` in `procedural`, pose.ts) becomes the cycle's arm at the player's phase, interpolated between frames, blended with frame 71 by the idle weight. The walking swing is added around it as now. Carry arms, ready hands, achieved and held arms keep their owners. Clearance, joint range (plan 12) and self-clearance (plan 11) apply as to any candidate.
- *Head.* The head's rotation is the core's times the cycle's head rotation, slerped from identity by the idle weight. The rotation is bounded by the cycle itself (measured at intake and recorded; expected a few degrees). The ragdoll candidate takes the head pose as it takes every segment, so conversion from idle is audited as before.
- *Sway.* Physical, not drawn: while the idle weight is above 0 and the player's own request is zero, the locomotion request gains the time derivative of the cycle's hip offset, scaled by the idle weight, in the body frame. The motor moves the body; the planted feet stay where they are and the legs follow. Fallback, if sway makes a plant slip past the plan 07 limit or starts a step: drop sway (arms and head stay) and report it.

**Walk.** The walk still plays only for a walking request, forward within the clip's heading limit (`headingMaxDeg` 30). Backward and side walks (L3-F14-backward, -lateral) stay procedural: the supplied walk is a forward cycle.

## Tasks

- [x] **Tests first.** In the files 13b leaves: the idle record's cycle reproduces from the supplied clip (as the frame does now); two standing players' free arms differ at the same time and each repeats after 8.333 s; the idle weight is 0 in contact and above 1.5 m/s; every model-body L3, L4 and HC fixture outside the two exemptions carries the full set, and every exempt one is in a listed reason group.
- [x] **Intake.** Extend `idle-intake.ts`; run `npm run intake-clips`; update the manifest's `posePolicy` and `models/animations/README.md`.
- [x] **Coverage.** Write `withLocomotion`; call it from `asL3` and the HC `label`; check the exemptions.
- [x] **Arms and head.** Sample the cycle in `procedural` and in the head segment.
- [x] **Sway.** Add the sway request in the locomotion composition; measure plant slip on L3-F13 and L3-F15; apply the fallback if needed.
- [x] **Sliding plant (from 13d, user ruling 2026-11-09).** L3-F16-stop1.9's right foot is planted at the clip crossing while it still slides at 0.33 m/s, and the plant fails (`footPlantFailed`, slide, 1.5 cm). The `settled` test in footwork.ts passes any foot moving up to 1 cm per substep (2.4 m/s). The candidate from 13d: measure `settled` over `C.arriveS`, not one substep (about 0.2 m/s), so a sliding foot continues as a swing. It clears stop1.9 and leaves the other ten stops byte-identical, but changes the L3-F14 walks and L3-F7-phase50/75/mirror50, which 13e changes anyway. Remove the stop1.9 allowance in `BRAKE` and `SETTLES` (tests/l3-pass.ts) with it.
- [x] **Look review.** The user reviews L3-F13-carrier, L3-F13-free, L3-F14-walkRunStopCarrier and two HC fixtures in the lab, at 1×.
- [x] **Evidence.** Full suite, typecheck, build, all fixtures. List every changed summary (HC, L3 and L4 expected), with result, ending, ball spot and handoff changes.
- [x] **Audits.** The transition audit at idle–walk–run boundaries, the plan 07a handoff audits on every HC fixture, the plan 09 power audit, and the plan 11 and 12 checks on the newly covered fixtures.
- [x] **Close.** Handoff section.

## Acceptance

- **Idle plays.** On L3-F13-free, each free palm's path over 8.33 s matches the cycle's, through the fitted chest frame, within 2 cm; a second player's is a different phase; the static frame is used only for stance width and stagger.
- **No marching.** On L3-F13 and L3-F15, no foot leaves its plant while idle, and each plant's slip stays inside the plan 07 limit.
- **Ownership.** Carry, ready and held arms are as before, in every covered fixture.
- **Coverage.** Every model-body L3, L4 and HC fixture except the 12 tipped falls carries the full set; the test lists them.
- **Transitions.** 0 boundaries over 1 cm in the transition audit, including the new HC fixtures.
- **Handoff.** No new ragdoll validation failure against the 13d tip. If an HC or L4 conversion is newly rejected, it is listed for the user's ruling, as L4-F10-wrap-off was in plan 12.
- **Physics.** The plan 09 power audit stays clean.
- **Evidence.** Changed summaries listed; G, L1, L2 and RH unchanged from the 13d tip.

## Known limits

- The spine and collarbones are not driven (plan 12), so the idle's chest motion does not show; the arms and head carry it.
- Backward and sideways walks stay procedural.
- Sway is about 1 cm. If the plan 07 plants cannot hold it, it is dropped, and the cycle shows in the arms and head only.
