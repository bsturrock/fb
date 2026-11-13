# Milestone 4 — Hands and bent knees absorb the landing

## Rough-first slice (2026-11-13; do this before anything else in this file)

Per the direction in the [README](README.md): rough and visible end to end, judged in the lab, polish later.

Starting fact (M3 handoff): only L4 ragdolls have an active fall response (`FALL_L4`). L3 and HC ragdolls are
passive apart from a takedown's arm hold, because the response needs a hip envelope they lack. So on most scenes a
falling player is limp: legs trail or cross, arms flop, the carrier's tuck is lost.

1. **Every falling player on L3, L4 and HC reacts, flag off then on.** Give L3 and HC ragdolls the envelopes the
   existing fall response needs and start it on every conversion (reuse `FALL_L4`'s tasks; one response, not a
   second system). Knees and hips flex before landing and yield through it; a free arm reaches for the ground; an
   arm that is holding keeps holding (M3) and a carry arm keeps the ball tucked (the M2 step 4 carry-over, in rough
   form: the reference at conversion is the achieved braced pose).
2. **A landed palm bears load, flag off then on.** On real palm contact the arm stops chasing a target and yields
   (elbow bends, shoulder gives) instead of tapping and springing back; it releases when unloaded. No floor weld, no
   suction.
3. Each flip is its own step, judged on the visible bar and by the user's look; changed fall outcomes are listed,
   not blocking.

Known looks to check while here: a held ragdoll's trailing legs read as running (`HC-F3-lowRunner`); the limp
defender's legs cross in the front wrap (`L3-F19-front`); the carrier's passive upper arms fold into his trunk on
landing (`UPPER_ARM_IN_TRUNK`).

Not in the slice: measured tolerances, hand-specific friction, knee/shin strike tuning, get-up. Logged for polish
after it: the rear-wrap carrier still runs on because forearm clamps cannot carry the defender's weight (locked hands,
the candidate fix, cannot reach each other around these bodies: measured in the M3 handoff, "Locked hands"), plus
one-arm finishes for the side wrap.

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
