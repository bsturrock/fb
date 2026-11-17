# 15. Contact footwork: polish queue

Status: steps 1-5b done; the contact stepping model alone has the feet outside the clip regime (handoff:
`docs/handoff/plan15.md`, with the model, the tracked defects' lab links and the coverage step 5b dropped). Left: step 6,
polish what looks worst in the lab, one defect per step, flag off first.

## What a viewer should see (owner, 2026-11-15)

Short choppy steps under the hips. Feet never inside the other man. A foot always down when pushed. No galloping.
A clear system that works, not more rules: polish fixes the model's own terms; it adds no guards to it.

## Queue (handoff numbering)

1. 8, two feet landing together at a stop: hold the trailing plant until the swing foot is down, or shorten the swing
   to land first; then remove `STOP_FEET_TOGETHER` and footwork.test's crossing exception.
2. 7, the run-rejoin float: the run clip comes back with both feet up; join it on a stance. Then remove
   `RUN_REJOIN_FLOAT`.
3. 2, a leg in the other man with no free place (holds, the L2 side hit).
4. 3, a landing rolled on the shoe's edge (no subtalar roll in pose, rig, render and ragdoll).
5. 4 and 5, plants shown off their anchor (and holdMirror's skate, `PLANT_OFF_ANCHOR`) and a shoe in the turf.
6. 9, pose pops at ownership changes; restore a gate on the shown pose once they are under it.
7. 6, initFeet plants at once (no tentative path outside a clip), then plant/release pairing as a contract.
8. Cleanup: the unread reactive trigger fields on `FootworkProfile`.

Defect 1 stays pinned on its captures; no registered run reaches it.

## Acceptance (viewer rules over all L3, L4, HC and L2 runs)

- No step longer than the short-step limit; step times within the floor and ceiling.
- No same foot stepping twice while the other is planted (gallop).
- While supported and pushed, never more than one step time without a planted foot.
- No foot landing inside another player's footprint; no leg through another player's leg (defect 2 tracked).
- Existing: no skate, foot continuity, hip range, no snap, no stiff fall.
