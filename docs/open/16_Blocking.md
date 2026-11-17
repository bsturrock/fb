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

## Step 1, the probe (done 2026-11-17, no source change)

23 untracked scenes built from `L3-F6-hold` with every L3 flip, no `wrap`, no `rules`, two model-body script players
(worktree `.scratch/p29/`: `scenes.ts`, `probe.ts`, `out/*.json`, `stills/`; lab view of unregistered scenes through
`vite.probe.config.ts`). What two men do today with existing pieces only:

- **Chest to chest they hold each other up easily, and look wrong.** The torso boxes carry the whole push (400 N at a
  1 m/s request, 1200 N at 3 m/s), lean 0.1-1.6 deg, balance torque 6-9 N m of 240. They stand upright as an A-frame,
  facemasks meshed, arms hanging or swept back to the hips, thighs 16-21 cm through each other for 0.5-1.0 s (the leg
  guard leaves 0.18-0.22 m unresolved), then freeze to the millimetre.
- **The forearm clamp is not a push.** Elbows tucked about 85 deg, the two men's hands meet between the chests; contact
  on the torso box's side edges; force chatters (about 3000 clamp events in 8 s, mean 95-230 N); the flickering contact
  flips the feet between the clip and contact steps several times a second; any asymmetry twists the pair until both
  fall (2.7-5.5 s). The palm grip is rejected `outsideBand` (chest at local y 0.42, band ends 0.40) and only pulls.
- **No force contest.** The drive is a velocity servo: whoever requests more speed wins. The weaker man is pushed back
  steadily (3.0 m, or 7.6 m out of bounds with his drive saturated 4.3 s), upright at 1.8 deg with no foot under his
  hips for 4.1 s, and nothing ever makes him fall. Men driven back gallop (14-16); a still pair re-steps 2-4 mm about
  40 times.
- **Nothing ends it wrongly** without wrap and rules. With the L3 rules on, `progressStopped` ends the play 0.7 s after
  contact. A `runner` braces (reads well) and keeps his carry arm. Prep mode's same-role filter was not reached.
- Legs stay posed: nothing here needs load-bearing legs; what fails is where the legs are put and what the hands do.

## Design (orchestrator, 2026-11-17, from the probe)

The men must be held apart **at arm's length by the hands**, not chest to chest: that one change removes the meshed
facemasks, the crossed thighs and the hanging arms. So, in order:

1. **Palm push** (`arms.ts`): a compressive palm contact on the other man's chest or shoulder, a steady patch like the
   torso contact rather than the clamp's on/off force, inside the existing arm budgets, with its own target band that
   reaches the chest and shoulders. Flag off.
2. **Block controller and engaged state**: a new `ControllerSpec` kind that steers at its man, keeps arm's length,
   punches the hands on and holds them, and asks for push by effort. "Engaged" is a persistent state owned by the
   player (the feet regime must not follow a flickering contact); the hip hinge and whatever else it needs read that
   state, not `WrapProfile.strike`. No fixture uses it.
3. **Fixtures on**: a new family `BL` (its own prefix, so nothing existing changes; it names the profile layers it
   takes explicitly) with even, blocker stronger, defender stronger, walk-in, off-centre and mirrored scenes; in the
   lab list. First rough look.
4. **Stance and punch pose** from the user's blocking animations (promised 2026-11-17; reference for the look, and
   source poses if on the model skeleton): hips back, trunk pitched, knees clear of the other man.
5. **Force contest** (only as far as the lab shows the need): push strength from effort, push-back capacity read from
   the planted feet (a rule; legs stay posed), choppy steps while giving ground, and lean building to a real fall when
   overpowered.
6. **Milestone:** lab review by the user.

**Item 1 done (2026-11-17, `581dec4`, `7b76123`; flag off, 584/584, all 414 fixtures, traces and matrices
byte-identical to `.scratch/p28/final`).** `ArmIntent.action: 'push'` with `PushRequest { effort, lengthM }`
(`ArmScriptSegment.push` in scripts), profile `ArmProfile.palmPush` = `PALM_PUSH_V1`, reads `ArmSystem.pushOf`,
`ArmObs.pushId`, events `pushBegin`/`pushEnd`/`pushRejected`, faults under `SimDebug.arm`
(`tests/palm-push.test.ts`, 8 cases with twins). The patch is held in the pushed man's frame and the arm is a strut
from shoulder to patch (spring on compression, damped, never negative, capped by elbow torque over the shown elbow's
lever, tapering to zero as the elbow folds 75-100 deg); it yields under overload rather than releasing; a push counts
as retention, so the feet regime no longer flickers. Seen in the probe scenes (worktree `.scratch/p30/`): the men stay
0.3-0.4 m apart, arms out onto the chest, force steady (62 N per hand at a 0.3 m/s request, 102 N at 0.5), 4-8 push
events a scene against the clamp's thousands. Open from it:

- **Both men tip over backwards at about 4 s once the request reaches 1 m/s.** A push at shoulder height is a moment
  the balance torque (240 N m) cannot hold, and chest contact no longer carries it between them. A 10 deg forward
  posture lean does not help. This is the force contest's rule arriving early: the moment a man can resist must come
  from his base, the distance from his hips to his rear planted foot (weight times that distance), so a man with a
  foot back leans into a push and a man with his feet together goes over. Legs stay posed; the planted feet are read.
- Symmetric hands share a lane, so the two men's forearms pass through each other; arms avoid bodies, not other arms.
- The drawn palm sits 2-3.4 cm off the drawn chest (the patch is on the proxy box, as grips are).

Each is flag off first, then on, full-checked (`CLAUDE.md`). Roles: first slice uses two `defender`s; a blocker role
and the rules (`progressStopped`) wait until blocking meets a ball carrier.

## Acceptance (viewer rules)

- Hands on the other man's chest or shoulders, not through him; elbows and shoulders anatomically possible.
- Feet: plan 15's rules (short steps, no gallop, a foot down when pushed, no foot inside the other man).
- An even match stays up for the whole run; the overpowered man gives ground before he falls, and falls as a ragdoll.
- No skate, snap or energy from nowhere; G, L1, L2 and RH byte-identical; existing L3, L4 and HC summaries
  byte-identical until a flip step says otherwise.
