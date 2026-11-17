# 16. Blocking

Status (2026-11-17): planned; step 1 (the probe) is next. Nothing built.

## What a viewer should see (first slice; orchestrator's assumption, user to correct in the lab)

Two men meet upright. Hands come up, punch out onto the other's chest or shoulders and stay on. The blocker holds his
ground or drives; the defender pushes back. Short choppy steps under the hips. Nobody falls unless genuinely
overpowered. Not in the first slice: shed moves, getting round, pass-rush choices, a ball.

## Direction

- **Rough and end to end first**, then polish what looks worst in the lab, together with the parked footwork queue
  (plan 15) and the parked tackle list.
- **Legs stay posed** (user, 2026-11-17: load-bearing feet are physics, which this project does not do). If a pushed
  man looks wrong (slides back with both feet planted behind him, or holds like a wall on one foot), the fix is a rule:
  how hard he can push back reads where his feet are planted. Only if the lab shows the need.
- **A behaviour a brain can pick** (user, 2026-11-17: each player eventually gets an internal state machine that
  drives what he does). Blocking is its own controller kind with a clear request, beside `wrapAttempt`
  (`ControllerSpec`, `src/sim/fixture.ts`; `makeController`, `src/sim/controllers/index.ts`). Rules it needs in the
  simulation are keyed on the player's own state, not on a fixture-wide profile the way the tackler's drive, ride and
  bound-legs rules are keyed on `def.wrap`. No selection logic until asked.
- Arms in the existing three stages (authored source pose, one task, one final pass); no per-case guards.

## What exists and what is missing

Map with paths and line numbers: worktree `.scratch/p28/blocking-map.md` (2026-11-17, head `e73335e`). In short:
controllers, arm reach onto another body, force budgets and contact stepping exist; a palm that pushes does not (the
palm grip is tension-only, only the forearm clamp pushes, and the palm band stops below the upper chest); the only
ground resistance is the drive motor's cap; `Role` is `runner | defender` and `runner` implies the ball; there are no
stance, punch, shuffle or backpedal clips, and `../football-sim-6` is empty.

## Steps

1. **Probe (no committed source).** Two supported model-body players, existing pieces only (`ScriptController`,
   ready hands, reach/close at a focus-frame chest point, forearm clamp), pushing for several seconds. Answers, with
   numbers and a lab look: do they hold each other up or does one tip at once (chest-height force against the balance
   cap and the drive cap); is the forearm clamp an acceptable hands-on-chest look and force; do contact stepping, the
   leg guard and physical legs stay calm at about 0.5 m for many seconds; does anything convert a player without a
   wrap profile.
2. **Design from the probe**, recorded here: the push (palm or clamp), the stance pose, the role, the fixture family
   (a new prefix gets no flips; `L3-` ids get all of them and enter the matrices), which simulation rules move off
   `def.wrap`.
3. **Flag off first, then on**, one step each (`CLAUDE.md`): the push task; the block controller; the stance and
   punch pose; the fixtures (even match, blocker stronger, defender stronger, off-centre, mirrored).
4. **Milestone:** lab review by the user.

## Acceptance (viewer rules)

- Hands on the other man's chest or shoulders, not through him; elbows and shoulders anatomically possible.
- Feet: plan 15's rules (short steps, no gallop, a foot down when pushed, no foot inside the other man).
- An even match stays up for the whole run; the overpowered man gives ground before he falls, and falls as a ragdoll.
- No skate, snap or energy from nowhere; G, L1, L2 and RH byte-identical; existing L3, L4 and HC summaries
  byte-identical until a flip step says otherwise.
