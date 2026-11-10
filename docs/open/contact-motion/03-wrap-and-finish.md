# Milestone 3 — Open, close, retain, and go down together

## Visual target

On approach, elbows and hands open outside the carrier's silhouette, creating a visible cradle. As the torso enters it, forearms sweep inward promptly and hands settle against reachable sides/back of the torso. There is no long pause with hands hovering beside the target. Once securely connected, the defender lowers and commits their chest/hips into the takedown, knees yielding as both players descend. The defender stays attached through the first part of the fall rather than standing upright over the fallen carrier and tripping afterward.

## Existing starting points

`controllers/wrap.ts` has ready/spread/arc/close/sustain phases, ring targets, observed retention and a supported finish. Its current defaults include engage gap 0.35 m, spread azimuth 60 degrees and wrap azimuth 115 degrees. `arms.ts` already distinguishes surface holds and clamps; grip birth requires a valid achieved palm hit, closing intent, eligible region and reach/facing/band checks. Faster controller waypoints do not necessarily mean faster achieved arms.

## Implement in two checkpoints

### A. Acquisition and retention

Trace fixture arm modes/profiles first. Widen the ready and spread targets relative to actual target torso width and available reach, and start spreading early enough at the measured approach speed. Tune the existing target progression and bounded actuator speed/effort together; increasing azimuth alone may move the hand behind the target instead of widening the opening.

Allow a valid hand contact to request close immediately rather than waiting for an unnecessary arc threshold. Retain every physical acquisition guard. Diagnose grip rejections, saturation and overload before raising force. Prefer existing surface-hold acquisition when the palm lands validly; retain a compressive clamp when the forearm, rather than palm, contacts. Do not turn any incidental touch into a permanent weld or acquire through the torso. Tune grip stiffness/damping, closure effort and break exposure only where traces show a specific limitation; preserve the shared arm budget.

### B. Committed coupled descent

Extend the existing finish policy with a committed takedown phase driven by useful retained contact to the intended target. Two-arm retention is the initial secure case; a one-arm finish requires demonstrated useful load/geometry, not just a non-null ID. Lower stance and lean into an achievable descent while still supported. When committing to leave support, use the existing validated conversion path with an explicit policy reason if required by its contract. Never wait for a secondary trip to initiate the defender's fall.

Maintain genuine grips/clamps across conversion through existing transfer logic and falling-owner budgets. Let those forces transmit the defender's descent to the carrier. If the carrier falls first while securely held, the defender should follow promptly through the same finish policy. Do not convert the carrier simply because the defender entered this phase: carrier balance/contact mechanics decide that. Failed conversion remains a real failure to handle, not permission to force a pose.

Release/break according to existing physical rules. On contact loss before commitment, recover pursuit; after leaving support, continue a physical fall and free released arms to brace. Keep referee ending and settle-window behavior intact.

## Acceptance

Extend gate2/gate3, handoff and fall coverage as appropriate. Measure achieved opening width, first valid contact-to-retention latency, retention duration, overload/break causes and both players' support-loss times. Compare those with baseline; define calibrated tolerances from fixture scale before freezing assertions.

Require visible wider approach arms and quicker closure; retained contact during initial descent; defender descent as part of the tackle rather than a later incidental collision. Include one-hand misses, broken holds and target evasions: these must remain escapable. Check momentum continuity, finite force/work and no duplicated supported-plus-ragdoll arm forces. Review front, side and rear wraps at normal speed before accepting stronger grip tuning.
