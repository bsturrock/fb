# Milestone 4 — Hands and bent knees absorb the landing

## Visual target

A free hand reaches down ahead of the falling defender. When its palm actually lands, it briefly becomes a stable support point: the torso continues over it while the elbow bends and shoulder yields. It should read as catching body weight, not tapping the ground and springing back up. Sliding is allowed under excessive sideways load. The hand releases naturally when unloaded or overtaken by the body. Knees flex before landing, then the knee/shin contact absorbs the remaining descent; legs do not remain rigid or fold backward. A retained wrap arm continues holding until released, rather than abandoning its target to brace.

## Diagnose first

Inspect `fall-response.ts` contact detection/task transitions, its impact guard and power accounting; `ragdoll.ts` collider geometry and joint axes; and `profiles.ts` contact coefficients, knee targets and response timing. Current brace contact records a reference pose and uses yield gain. Current default restitution is already zero: do not assume simply lowering restitution fixes the bounce. Separate collision restitution, spring/motor energy, excessive penetration correction, target motion and incorrect palm/forearm geometry using traces.

## Implement

1. Confirm palm/forearm contact geometry matches visible landing and reports the correct surface. Preserve misses and obstructed reaches. Distinguish an actual load-bearing palm contact from a nearby arm segment touching the floor.
2. On real contact, transition seeking into a compliant load-bearing response. Stop chasing a moving predicted floor target. Use bounded elbow/shoulder damping and controlled flexion to absorb descent while the collision solver supplies normal force and friction. Keep the target continuous at contact and release it when contact/load is lost, with short hysteresis to prevent flicker.
3. Tune ground tangential friction only if sliding is the measured failure. Prefer existing contact material controls; any hand-specific material must also be valid outside this one fixture. No permanent floor weld or arbitrary downward suction. If current contact cannot provide stable support, first correct geometry/solver resolution and demonstrate why before adding a contact constraint. Any such constraint must require actual contact, allow lift-off, and cap tangential load by available normal load.
4. Check knee hinge sign and accepted initial angle, then tune existing knee/hip response timing and damping so flexion develops before impact and yields through it. Verify the visible knee/shin and physical collider strike consistently. Avoid forcing knee contact when hips/side legitimately hit first, and do not add a second knee motor on top of existing torque control.
5. Preserve impact guards and shared positive-work budgets. If a guard suppresses all useful support, revise its targeted behavior with measured energy evidence rather than disabling it globally. Damping must not be a disguised energy source.

## Acceptance

Extend `tests/falls.test.ts` and existing fall fixtures with successful free-hand support, blocked/late reach, loaded sliding, hand lift-off and mirrored bent-knee landings. Record palm contact duration, tangential travel while loaded, separation/rebound velocity, elbow/knee angles and active work. Compare the contact interval with baseline; set numerical limits from controlled fixture geometry and solver tolerances.

Require a visibly sustained hand support interval, reduced rebound, flexing elbow, plausible knee/shin contact and eventual passive settling. Retained arms must not simultaneously brace; missed hands must not become anchored. Run coupled-tackle scenes from milestone 3 as the final integration check, including referee-ending follow-through. Ground support may change landing timing and rule outcomes legitimately; inspect and explain those changes rather than rewriting expected results blindly.
