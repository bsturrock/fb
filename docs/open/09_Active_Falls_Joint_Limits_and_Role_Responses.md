# Active falls, joint limits and role responses

Repository-aligned plan • 2026-11-05 • Planned after integrated passive falls in document 08.

Previous: [locomotion integration](08_Locomotion_Transitions_and_Tackle_Integration.md).

## Existing mechanics and remaining scope

`src/sim/ragdoll.ts` already constructs ten bodies with elbow/knee/neck revolute limits and spherical shoulders/hips. It validates candidates and transfers bulk momentum. `arms.ts` already handles passive retained palm links, reduced falling budgets, releases and clamp transitions. `rules.ts` and `Simulation.observeRules` already freeze the official ending/spot and allow a settle interval. Reuse those; do not implement them again.

Missing work: tested shoulder/hip swing/twist envelopes, bounded physical joint effort, per-role brace/protect/hold decisions and work accounting. Existing hinge limits need load tests, not replacement by default. Use installed Rapier 0.21.0 declarations/capabilities; do not assume a spherical cone-limit setter. Keep the existing ten-body/shin-owned shoe representation. No walking, get-up, spine, independent hands/feet, new adhesive grasps or world-root stabilization.

## Implementation order

1. Test passive hinge limits and add calibrated shoulder/hip envelopes using existing joint/body frames. Declare native versus soft enforcement and measured overshoot under stated loads. Keep anatomical constraints active when muscle budgets are zero. Never rotate bones after physics to hide a violation.
2. Add one bounded knee-flexion response, then hip flexion. Initialize targets from actual accepted-conversion angles. Apply equal/opposite internal torque pairs, clearing/accumulating application forces once per actual substep. Native motors are acceptable only with verified output caps/accounting; do not run both methods on the same coordinate.
3. Add arm task selection using current role (`runner`/`defender`), carry arm and retained contacts. The runner's right carry arm protects its actual feasible reference; a free arm may brace. A holding defender prioritizes its valid hold; only a free/released arm may brace. Do not voluntarily drop a hold just to play a brace animation.
4. Predict a reachable floor target from actual motion over a short horizon (initially 0.1–0.25 s). Use existing limb lengths/IK to propose joint targets, then let finite torque and real palm/forearm collision achieve or miss contact. No sticky floor anchor or imposed root force; yield at contact and allow slips, late reaches and misses.
5. Retain the existing passive grasp law/release history and physical wrap observation. Supported query-arm pulls/clamp forces must not continue on top of physical limbs. Allocate grasp tension and shoulder/elbow torque demand under the same reduced falling-owner budget before applying either; extend the existing arm allocator/ledger rather than adding a second independent allowance.
6. Bound positive work and response duration. Start with a brief delay/ramp, at most roughly one second of effort and a fade to passive settling. Repeated impacts cannot refill the budget. The existing official ending remains immutable; reuse its settle window for visual follow-through. Do not change eligible rule regions to improve a landing.

## Effort contract

All values are initial engineering settings requiring calibration, not measured athlete strengths. Start ceilings at shoulder 15 N·m, elbow 10 N·m, hip 18 N·m, knee 22 N·m; a multi-axis joint has one vector cap as well as any per-axis caps. Apply torque to child and its negative to parent. No supported player receives this layer's effort.

Use current falling budget scaling (rather than hardcoding a second 35% budget). Conservative arm demand is the sum of passive grasp tension plus shoulder torque magnitude / upper-arm length plus elbow torque magnitude / forearm length over both arms. Scale the combined contributions by available owner budget; lengths come from the calibrated profile. Keep overload exposure across activation.

Audit power as torque dot relative angular velocity. Initially bound total positive active power to 150 W and positive work to 100 J per episode; log negative work separately without refunding capacity. Log passive spring/damping work separately. Apply caps before stepping and audit realized substep work, with a declared controlled-test tolerance initially 5%. Exceedance fails the fixture; no velocity correction may hide it.

## Files and evidence

Extend `ragdoll.ts` joint metadata/constraints, `profiles.ts` for explicit response settings, `simulation.ts` substep integration, and `arms.ts` shared allocation. Keep policy in a small simulation module only if it keeps those responsibilities clear. Extend existing trace/export, fixture registry and tests. Report solver/profile identity, requested/applied effort, contact state, task changes, work and limit error.

## 16. Required fixtures

| ID | Fixture | Pass evidence |
| --- | --- | --- |
| L4-F1 | Muscles disabled; knees/elbows and shoulder/hip twist/swing loaded | Limits/envelope work independently of pose motors; native/soft mode and overshoot reported |
| L4-F2 | Same falling state with knee-flex response on/off | Active case visibly attempts finite flexion; no root lowering, foot stepping, or promised knee-first landing |
| L4-F3 | Carrier forward/oblique fall with free arm | Reachable brace can contact through physical hand/forearm; carry arm stays assigned to protection |
| L4-F4 | Brace target too far, late, obstructed, or arm occupied | Miss/yield remains a failure; no remote anchor or fake floor reaction |
| L4-F5 | Holding tackler with two arms, then one arm | Holding priority suppresses automatic ground bracing; valid wrap can persist or break under shared effort |
| L4-F6 | Tackler's last useful contact breaks | Arm task can switch to bracing only from current achieved pose and remaining budget/time; no new palm acquisition |
| L4-F7 | Joint effort saturation and zero-cap intervention | Motor can be overcome; zero active torque yields bounded passive baseline; caps/torque pairs audited |
| L4-F8 | Whole-body airborne torque-pair test without contact, in a labeled zero-gravity diagnostic | Joint actuation adds no external net linear/angular momentum; energy change explained by work; gameplay gravity unchanged |
| L4-F9 | Fall from run/preparation/contact/exit, either or both players | Original boundary audits pass before response; no gait reactivation or candidate pre-posing |
| L4-F10 | Knee/elbow ending, palm brace, and post-whistle follow-through | Correct ending subset; spot frozen at event; later motion does not change result |
| L4-F11 | Settling, exhausted work, and repeated disturbance | Effort decays; limits remain; no work refill/get-up/forever pumping |
| L4-F12 | Mirrored bodies, render rates, pause/single-step and 20 resets | Same fixed-step policy/effort trace; no stale joints/tasks/targets or growing counts |

Use forward, sideways, and backward fall configurations. Include a fast fall with insufficient time to brace and a carrier with no free arm. Outcome variation should follow pose/contact/velocity differences, not randomized winners or a required landing script.

## 17. Acceptance, evidence, and limits

Retain Gate 4 boundary tolerances and document 08 pose/representation continuity. Additionally require:

- Measured bend/twist violations within the selected profile's declared tested tolerance; for a first calibrated soft envelope, target <= 5 degrees overshoot in its stated load fixtures and fail persistent violation. Do not call that a hard guarantee at arbitrary impact.
- No active joint torque, passive grasp contribution, or accounted arm total above its configured cap beyond numerical tolerance.
- Positive work/power audit within the stated 5% controlled-test tolerance; no unlogged velocity correction.
- No supported-proxy torque from this layer, no physical stepping, no world-root stabilizer, and no automatic standing recovery.
- Correct per-role/per-arm decisions, no held tackler reflexively dropping a wrap, and no duplicate clamp/shoulder/grasp forces.
- Same-runtime fixed-step determinism under camera/material/visibility/render-FPS changes.

Review normal and slow motion on the installed player. Inspect knees actually flexing, feet/shoes following bodies, hands meeting/missing ground honestly, arms yielding under load, and either participant continuing to interact during a fall. Measure motor-off versus motor-on trials rather than claiming realism from one successful clip.

Known limits: a small rule-based controller, fixed-core ragdoll without a spine, simplified hands/ankles, no injury model, no physical gait/get-up, and initial handoff without relative limb-swing velocities. Research systems demonstrate broader capabilities; this plan does not promise their performance from these heuristics.

Run the passive Gate 4/model regression suite alongside the new L4 fixtures, typecheck and build. Review motor-off/on comparisons on the installed model at normal and slow speed. Retain existing boundary tolerances; later active work is accounted separately from the initial momentum transfer. Do not claim general biomechanical realism from the heuristic response.
