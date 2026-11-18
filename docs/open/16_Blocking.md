# 16. Blocking

Status (2026-11-17): the rough first slice is in the lab (palm push, block controller with its engaged state, the `BL`
scenes); what was built, the owner's rulings, the tracked defects and the lab links are in the
[handoff](../handoff/plan16.md). Outstanding: the user's first lab look. Left: the list below.

## What a viewer should see (first slice; orchestrator's assumption, user to correct in the lab)

Two men meet upright. Hands come up, punch out onto the other's chest or shoulders and stay on. The blocker holds his
ground or drives; the defender pushes back. Short choppy steps under the hips. Nobody falls unless genuinely
overpowered. Not in the first slice: shed moves, getting round, pass-rush choices, a ball.

## Direction

- **Rough and end to end first**, then polish what looks worst in the lab, together with the parked footwork queue
  (plan 15) and the parked tackle list.
- **Legs stay posed** (user). Where a pushed man must resist from his feet, a rule reads the planted feet.
- **A behaviour a brain can pick** (user: each player eventually gets an internal state machine). Own controller kind,
  small request, simulation rules keyed on the player's own state. No selection logic until asked.
- Arms in the existing three stages (authored source pose, one task, one final pass); no per-case guards.
- The men are held apart at arm's length by their hands, not chest to chest (from the probe).

## Left

1. **The base.** A push at shoulder height is a moment the balance torque (240 N m) cannot hold, so at hard pushes
   both men tip backwards. The moment a man can resist comes from his base: weight times the distance from his hips to
   his rear planted foot along the push line, read from the posed feet. With it, the stance must keep a foot back
   (today the rear foot sits at +0.03 m and the requested stagger is not kept), so a man with a foot back leans in and
   holds and a man with his feet together goes over. Flag off, then on for `BL`; `BL-F8-hardNoHinge` is the scene.
2. **Stance and punch from the user's animations** (being prepared): hips back, trunk pitched, knees clear; replaces
   the controller's one stance request. Reference for the look, and source poses if on the model skeleton.
3. **Force contest**, as far as the lab shows the need: push strength from effort rather than requested speed, choppy
   steps while giving ground, lean building to a real fall when overpowered.
4. **Polish** in the handoff's defect order (forearm through forearm first), after the user's look.
5. **Milestone:** lab review by the user after 1 and 2.

Each is flag off first, then on, full-checked (`CLAUDE.md`). Later, when blocking meets a ball carrier: a blocker role
and the rules (`progressStopped`).

## Acceptance (viewer rules)

- Hands on the other man's chest or shoulders, not through him; elbows and shoulders anatomically possible.
- Feet: plan 15's rules (short steps, no gallop, a foot down when pushed, no foot inside the other man).
- An even match stays up for the whole run; the overpowered man gives ground before he falls, and falls as a ragdoll.
- No skate, snap or energy from nowhere; G, L1, L2 and RH byte-identical; existing L3, L4 and HC summaries
  byte-identical until a flip step says otherwise.
