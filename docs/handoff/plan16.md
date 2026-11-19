# Plan 16 handoff: blocking, the rough first slice (in progress)

Plan: `docs/open/16_Blocking.md` (what is left). Branches `prereq-ladder` and `model-integration`, both pushed.
State on 2026-11-17: the palm push, the block controller with its engaged state, the `BL` scenes and the base
(standing against a hard push from the planted feet) are in; the user has had a first lab look ("as a start this looks
ok"; the picture of a block that came from it is at the top of the plan). The punch as a timed strike is in. 601/601
tests; the 414 earlier fixtures' summaries and traces are byte-identical to before the plan. Current full-check
baseline: main checkout `.scratch/p33/on`.

## To resume

1. **The contest decides movement, on for `BL`** (`ddc0e07`, `a462cc3`; agreed by the user 2026-11-18 after the
   sole-moment base was parked three times, worktree `.scratch/p34`-`p36` `parked/`). `CONTEST_V1`
   (`BlockContest`, `contested()`): a planted man in his block is anchored upright; each man has a hold capacity
   along the push line from effort, how low he is, feet planted and flat against mid-step, and how stood up he is
   (a level that rises at a hit and releases), with a leverage input held at 1 until item 3; the net of the real
   strike and push forces against it moves his hips; `FLAT_V1` steps follow; he goes down `contest:overpowered` as a
   ragdoll when the margin holds against him. With it BL runs `ATHLETIC_V2` (trunk 20 deg; at `V1`'s 30 deg the
   under and over hands land 11 cm apart in height and the forearms cross 8-9 cm all block; the deeper trunk can
   return with the inside lane). `BASE_V2/V3`, `GIVE_V1`, `based`, `ATHLETIC_V1` are flag-off or test-only now
   (cleanup later). 627 tests; baseline main checkout `.scratch/p37/contest-flip2`. Under heavy outside machine load
   the runner can exit 1 with every test passing, and tests time out; rerun alone before believing either.
2. Seen: feet flat 98-100 % of planted time in even scenes (0-1 steps, 1-4 cm of travel, a jolt, hips up 5-7 cm and
   back in stance in about 1 s); the weaker man in `-F3`/`-F4` is knocked 11-14 cm in the first 0.5 s, then about
   0.4 m over the remaining 7.5 s in five flat 16-18 cm steps (before: walked back 2 m at constant speed in 16-27
   steps); `-F2` the walk-in's momentum knocks the set man 0.43 m in 0.5 s in three flat steps, then he anchors;
   `-F7` is a stalemate (equal men cancel until leverage exists); nobody falls in any BL scene (`-F8` both stood up
   again). Strike contact unchanged (elbow 63-80 deg, 54-66 % through, 273-965 N peak).
   **The lean-in** (`9073f58`, `6721d91`; user's third look: feet behind him, leaning in). BL now stands on
   `LEAN_IN_V1` (`LeanInStance`, `withLeanIn` in `controllers/block.ts`) in place of `ATHLETIC_V2`: hips 1-10 cm
   ahead of the feet's mid-point (before 10-25 cm behind), the whole man inclined 8-13 deg, rear foot on its ball
   (limit for the ball 14 deg / 7.4 cm heel; the flat rule's 10 deg / 3 cm unchanged), feet further apart than hips
   between the two men, the loser's hips ahead of his feet for all of the knock-back (before: none of it), every
   step back landing behind his hips. Outcomes unchanged, nobody falls. **Its cost: the men stand tall (hips 0.90 m
   against 0.82) and the load sinks only 0.5 cm**, because with the ankle at 25 deg feet behind the hips force the
   hips near standing height; a low lean-in needs about 35 deg or more of ankle. 632 tests; baseline main checkout
   `.scratch/p38/leanin-flip`. Other defects from it: the winner's trailing heel and the load-time heel pass the
   ball limit (8.1 cm, 15.5 deg); `-F2`'s strike barely moves the set man now (0.07 m/s, was 0.54); the set pose
   before the load has no stance input of its own (it is the engaged stance); `-F8` run-back 4.8 m.
3. Reference for stances (untracked, press photos, never commit): worktree `.scratch/refs/` `two-point/`,
   `three-point-offense/`, `three-point-defense/` (user's photos; offense and defense differ), and
   `/Users/brandon/Projects/football-player-creator/anims/3pt Stance Offense.fbx`, `3pt Stance Defense.fbx`.
4. **The low lean-in** (p39: `1ec5d17`, `311fb56`, `af56fa4`). User ruling 2026-11-18: "ankle can go that far if
   needed while blocking": a blocking stance's weight-bearing ankle bends to 38 deg (`FlatStance.dorsiDeg`,
   `LeanInStance.ankleDeg`, read through `pose-runtime.ts jointRangeOf`); every other player keeps 25 deg, and a
   ragdoll made from a blocker keeps 25. BL stands on `LEAN_IN_V2`: hips 0.82 m set, 0.76 at the load (sinks 6 cm,
   was 1), rising 7 cm in the 0.3 s after the palms land, 0.82 driving; knees about 90 deg at the load. Nobody
   falls, outcomes unchanged. 637 tests; baseline main checkout `.scratch/p39/low-flip` (flag-off step after it:
   `presnap-off`, 639 tests). Defects from it: **the losing man's hips are behind his feet's mid-point 66-70 % of
   the engaged time again** (up to 3.7 cm; `LEAN_IN_V1` had 0 %), and he takes 15 steps of 9-10 cm over 0.8 m
   (was 7 over 0.47 m); `-F5` and `-F8` load heels 1 deg past the ball limit; `-F8` run-back 4.5 m.
5. **Pre-snap stance, flag off** (`4ea1b19`): `BlockRequest.stance` `{kind: two-point|three-point, side:
   offense|defense}`, `BlockProfile.preSnap` a pose per stance, held from the reset to `fromS` (the snap), then
   the block runs; `LEAN_IN_V3` = `V2` + a two-point set (hips 0.78 m, trunk 25 deg, knees 84 deg). No fixture
   uses it. Left for the three-point entry, in order:
   a. **Fire-out deadlock.** From the two-point set at the 1.1 m gap one man strikes first and the other stays
      in the load for the whole run, hands at his chest (likely: he is inside the strike's 0.5 m least reach and
      the contest overrides his step back). Existing mechanism, reached by the set's wider gap. Fix first.
   b. Three-point poses: the suspension clamps the root at 0.72 m and a three-point needs about 0.62-0.68 (a
      stance-scoped lower bound, like `dorsiDeg`); the guard ball sits 0.62 m under the origin; trunk pitch
      60-75 deg against the block hinge's bound; the down hand needs a reach to a turf point (arms have no floor
      clamp); off arm and head up. The FBX clips are unchecked against the photos.
   c. The two-point trunk stops at 25 deg: deeper and the feet, placed for the lean-in, step during the set. A
      set needs its own foot placement under the hips.
   d. A first step faster than the load's 0.6 m/s close; the new scenes (three-point offense against three-point
      defense; two-point set against a three-point defender); tests with fault twins.
   Then item 3.
6. **p40: the deadlock, the three-point stances, two scenes** (`ad62a5c`, `fef43f6`, `d772a93`, `d6bdc0a`). 5a and
   5b are done, 5c and the fire-out of 5d are not.
   - Deadlock, real cause: the man with the shorter reach strikes first and his palms hold the other at arm's
     length with no closing speed, so the other's strike condition (`reach - closing x leadS <= contactM`) never
     holds. Rule: engaged, loaded and held off inside `engagedReachM` (0.66 m), he strikes (`BLOCK_STRIKE_V2`, on
     for BL). `-F8` was this: it now ends in a stalemate (was a 4.5 m run-back); its title is stale.
   - Three-point stances (`LEAN_IN_V4`, `PreSnapPose`, `StanceRequest.lowM`, `PostureIntent.headUp`,
     `FlatStance.level`, a slow hinge pace into the stance), authored from geometry; the offense FBX agrees and
     was a cross-check, the defense FBX contradicts the photos and is unused. Offense: hips 0.69 m level with the
     shoulders, knees 90 deg, feet flat, base 0.56 m, palm on the turf. Defense: hips 0.78 m, 8 cm over the
     shoulders, heel-to-toe stagger, rear heel up 8 cm, palm 1 cm over the turf.
   - Scenes `BL-F9-threePoint`, `BL-F10-twoPointVsThree`: set from the reset (takes 2.3 s), snap at 3.3 s. Nobody
     falls. The loser's hips are behind his feet 11-20 % of the engaged time here.
   - 642 tests; baseline main checkout `.scratch/p40/d-scenes2` (suite) with the pass from `d-scenes`. Both runs
     show 642/642 passed plus a runner exit ("vitest exited 1 with no report") or stack-trace errors under a
     machine load of 26-31; the five files named pass alone. A run on a quiet machine is still owed.
   - **The fire-out, p41** (`5a9403c`, `d6c45ef`; `BLOCK_STRIKE_V3`, `BlockStrike.fire`, on for `-F9`/`-F10`
     only). What stood him up was the free locomotion's run clip (its blend weight rose as soon as he asked for
     speed and took the suspension target to running height 0.90 m) and the walking start ramp (the creep); while
     firing his feet are now the block's contact stepping. The trunk also could not rise fast enough: `hipNm`
     (up to 400 N m of the hips' own torque, firing only). Now: hips stay at stance height through the first
     steps, 0.80-0.84 m at contact, contact 0.52 s after the snap (was 1.33), bodies closing at 3 m/s (was 1.2),
     steps 8-63 cm, nobody falls. 646 tests; baseline main checkout `.scratch/p41/b-fire-on` (tool's own HARD
     INVARIANTS PASS). **Defects, worst first:** (a) the collision is not held at arm's length: the palm pushes
     collapse in 0.05-0.09 s at 20-45 N, torso hits torso, and by contact + 0.15 s both stand upright chest to
     chest, facemask to facemask, arms folded; the hit moves neither man back (each keeps coming 0.22-0.27 m).
     (b) `-F9`'s defender's palms are rejected for 1.5 s (not facing / above the band on a pitched torso).
     (c) Helmets within a few cm 0.2 s after the snap. (d) The scenes start 2 m apart (hands 1.14 m apart); at
     1.7 m the defender falls (`contest:pastAnchor`), at 1.5 m the heads touch.
   - **The hit, p42** (`7f992f5`, `bfe21bb`; `CONTEST_V2` + `BLOCK_STRIKE_V4`, on for `-F9`/`-F10` only). Defect
     (a) above is fixed there. Cause: the palms landed past the flex where the arm starts to give, the palm force
     ramps over 0.08 s while the men close 0.24 m, and elbow torque caps it near 280 N against the 1300-1650 N
     the stop needs. Rule (`ContestHit`): while a strike is on with a palm push between two engaged men, a force
     pair at the centres of mass, reduced mass x (closing speed + punch) / 0.02 s, at most 3000 N; the man with
     the larger push capacity holds his share with his legs, the other takes it. Now: chests stay 0.35-0.52 m
     apart (was 0.06), the holder is knocked back 0.30 m (`-F9`) / 0.49 m (`-F10`) in 0.4 s at up to 1.0-1.7 m/s
     and anchors by +0.7 s, both men's palms on 1.6-1.9 s of the 2 s after contact (was 0), nobody falls. Who
     wins at equal effort is who lands first (the first to land has the unlimited burst). 649 tests; baseline
     main checkout `.scratch/p42/b-hit-on` (tool PASS). **Left:** the winner's palms come off when his man is
     knocked out of reach and he re-punches 0.5 s later on a straight arm; the knocked man stands up to hips
     0.85-0.87 m, trunk 10-14 deg; the winner's lean shallows to 15 deg; forearms cross where under and over
     hands meet; the pitched-torso acceptance (b) is unchanged (hands get on because the chests stay apart);
     start gap (d) unchanged: at 1.7 m the palms land collapsed and the holder is run 1 m without anchoring.
     **Not flipped: the eight older scenes.** On `CONTEST_V2` `-F4`, `-F5`, `-F6` get a new fall (A overpowered
     at 0.85-0.93 s); they already hold at arm's length. To be decided with item 3.
   - **Eyes and arms out of the stance, p43** (`501ca2a`, `67feb1d`, `29cd334`, `bb938f2`; `GAZE_V1` and
     `BLOCK_STRIKE_V5`, on for `-F9`/`-F10`). User's fourth look (2026-11-19): "honestly pretty solid to start",
     the starting stance "is good"; but the head must "come up quicker to look at opponent, they are looking at
     the ground too long", and "head drops a lot and arms go inside body". Causes: head up was asked only before
     the snap, so at the snap the face fell from 41 to 90 deg below the horizon in one tick; and the load point,
     fixed in the body frame and authored for a 20 deg trunk, sat between belly and thighs at a 90 deg trunk.
     Rules: a gaze at the other man's head, neck extension within the stance's range, through the block; while
     the trunk is deeper than the loaded trunk the load point and elbow pole are placed as under that trunk. Now
     the face never dips below its stance attitude (mean angle to the other man's head 42-48 deg to 10-19) and
     no arm is in the thigh during the load (11 cm to 0). Contact time and outcomes unchanged. 652 tests;
     baseline main checkout `.scratch/p43/d-load-on2` (tool PASS; pass in `d-load-on`). **Drift and left:** the
     holder is knocked back 0.54-0.57 m (was 0.30-0.49) and both men's palms are on 1.15 s of 2 s (was 1.6-1.9),
     because both of his palms now land about 2 cm inside the chest, past the arm's tolerance, and the push is
     released at once until 0.95 s (existing mechanism: a palm landing at 3 m/s of closing sinks in on the
     push's first substep; before, one arm escaped it by 2 mm). Tracked, own step. Getting set: the down hand is
     10-14 cm inside the thigh for the first second (the turf target is out of reach while he is upright). Upper
     arm 7-8 cm in his own trunk during strike and drive in every BL scene (`withUpperArmClearance`, not on for
     BL, cut it to 4-5 cm in a probe).
   - **Left from before p41, worst first:** (1) (done, see above) no low-to-high fire-out: out of the stance he stands up to hips 0.90 m and creeps
     in at 0.35-0.43 m/s for 1.2 s before the punch. A faster, loaded fire-out is parked (worktree
     `.scratch/p40/parked/fire-out-v3.patch`): the root climbs to 0.92 m while the trunk comes up, against a
     0.725 m target, and the suspension only pushes up; find what lifts it, with a twin capture. (2) No weight on
     the down hand (the arm only reaches). (3) Defense front knee 75 deg. (4) The two-point has no feet of its own
     (5c). (5) Getting set takes 2.3 s. One builder at a time in the worktree
   `/Users/brandon/.claude-wt/football-sim-7-ladder`; check results in the main checkout's `.scratch/p38/` onward. The lab on port 5180 runs from the worktree and picks up commits on reload.

Lab (`cam=front` is the profile view of two men facing each other; `cam=side` shows a back):

- `?fixture=BL-F1-even&cam=front&speed=0.25&t=0.3` load, strike, the jolt at about 0.5, flat feet, planted
- `?fixture=BL-F2-walkIn&cam=front&speed=0.25&t=1.3` the walk-in's hit knocks the set man back three steps
- `?fixture=BL-F3-blockerDrives&cam=front&speed=0.25&t=0.45` knocked, anchors, driven (steps at 0.83, 1.32, 3.15)
- `?fixture=BL-F4-defenderStronger&cam=front&speed=0.25&t=0.45` the weaker man knocked
- `?fixture=BL-F7-hard&cam=front&speed=0.25&t=0.45` stalemate
- `?fixture=BL-F8-hardNoHinge&cam=front&speed=0.25&t=0.7` defect: one man run back 4 m without his hands on

## Owner rulings (2026-11-17)

- Blocking comes before any polish; the footwork queue (plan 15) and the tackle's parked list stay on hold and are
  polished together with blocking afterwards.
- **Legs stay posed.** Load-bearing feet are physics, which this project does not do. Where a pushed man must resist
  from his feet, a rule reads the planted feet.
- **Each player eventually gets an internal state machine ("brain") that drives what he does.** Not to be built until
  asked. Behaviours are built as things a brain can start, stop and swap: their own controller kind with a small
  request, simulation rules keyed on the player's own state, not on a fixture-wide profile.
- The user is preparing blocking animations as the reference for the look (stance, punch, drive, giving ground).

## What was built

**The probe (step 1, no source).** What two supported men do with the pieces that existed: chest to chest they hold
each other up (the torso boxes carry 400-1200 N at 0.1-1.6 deg of lean) but stand upright as an A-frame, facemasks
meshed, arms hanging, thighs 16-21 cm through each other, then freeze; the forearm clamp chatters (about 3000 events in
8 s), puts hands against hands and twists the pair over under any asymmetry; the drive is a velocity servo, so the man
who asks for more speed wins and the other slides back upright and never falls. Hence the design: the men are held
apart at arm's length by their hands. Scenes and stills: worktree `.scratch/p29/`; the map of what existed:
`.scratch/p28/blocking-map.md`.

**The palm push** (`581dec4`, `7b76123`; `src/sim/arms.ts`). `ArmIntent.action: 'push'` with
`PushRequest { effort, lengthM }` (`ArmScriptSegment.push` in scripts); profile `ArmProfile.palmPush` =
`PALM_PUSH_V1`; reads `ArmSystem.pushOf`, `ArmObs.pushId`; events `pushBegin`, `pushEnd`, `pushRejected`; faults under
`SimDebug.arm`. The patch is held in the pushed man's frame (chest and shoulder fronts; the palm grip's band is
unchanged) and the arm is a strut from shoulder to patch: a spring on compression, damped, never negative, equal and
opposite at the patch, capped by elbow torque over the shown elbow's lever and tapering to zero as the elbow folds from
75 to 100 deg. It goes through the shared force allocator and yields under overload rather than releasing (a release
would snap from full force, and a sustained hard push is the normal case). A push counts as retention, so the feet
regime does not flicker. Tests `tests/palm-push.test.ts` (8, each with its fault twin).

**The block controller and engaged state** (`a219796`, `eb34b85`; `src/sim/controllers/`). `ControllerSpec` kind
`block`: target, effort, hold or drive, hands `under|over`; profile `BLOCK_V1` with `BLOCK_V1_HANDS`. It steers at its
man, closes, punches both palms on, keeps arm's length, re-fits when he moves, re-arms a lost hand from the ready
point. The posture is one stance request (lean, hinge, drop, height, stagger) that an authored pose can replace. State
`PlayerRuntime.block`, phase `approach|engaged|lost`, advanced by `advanceBlockState`, observed as
`ctx.observed.block`; `retained()` reads it (contact stepping while engaged) and the hinge runs for
`pl.block || pl.hinge?.limits`, no longer only `def.wrap.strike`. Faults `SimDebug.block`. Tests
`tests/block.test.ts` (6 with twins), including a swap to another controller that releases cleanly.

**The `BL` family** (`09ce348`, `ab4b7b2`; `src/sim/fixtures/`). Eight scenes, two `defender`s on the model body, no
ball, no rules: `BL-F1-even`, `-F2-walkIn`, `-F3-blockerDrives`, `-F4-defenderStronger`, `-F5-offCentre`, `-F6` its
mirror, `-F7-hard`, `-F8-hardNoHinge`. The layers the family takes are named in `registered()`
(`src/sim/fixtures/index.ts`): the L3 layers, with its own arm profile `+palm-push-block`. BL is in the leg and L4
matrices because it carries the leg guard and the fall response. The opt-in families' rule tests now name BL.

**The base** (`ae02599`..`35ce717`; `src/sim/block-base.ts`). Two profiles, both on for `BL` only and only for a man
engaged in a block. `BASE_V1`, the stance: feet about under the hips, 3 cm wider per side (user: "slightly wider, not
super wide"); the point where his pressure must be is the support's ground point moved by balance torque over weight,
and a foot's home moves until its heel is 8 cm past that point, so a step back happens only when a push needs
pressure behind his heel (and the home is more than a 12 cm step away). `BASE_V2`, the resistance: what he can resist
is his weight times how far his touching soles reach from the support's ground point, behind, ahead and to each side;
a foot mid-step gives nothing, a lifted heel gives only the toe. It replaces the fixed 240 N m balance cap, only ever
limits, and is exact for this model (torque on the support point is a shift of the centre of pressure). Lean target
and envelope are unchanged. At the default stance a man holds about 125 N m of tipping moment from his lean alone;
past that the rear foot goes back. Tests `tests/block-base.test.ts` (6 with twins). Seen: light and even scenes
unchanged, nobody steps; `-F7-hard` steps 0.3 m back at 0.75-0.9 s and stands all 9 s on a long base; `-F8` A falls
at 1.90 s (was 2.65), B stays up (was down at 2.76). Pushed harder than `-F7` (probe scenes, 2.4-4.4 m/s asked), the
pushed man goes at about 0.95 s in his step back and the pusher lurches forward into the gap at 1.2-1.3 s. The rule
would work for any supported man but is not applied outside blocking: heel lift in a crouch leaves no base behind, so
it would weaken many L3 and HC players; an opt-in trial (the carrier's brace) would be its own step.

**The punch as a strike** (`03bb832`..`4e5f442`; `src/sim/controllers/block.ts`, `PushRequest.extendMps`). Profile
`BLOCK_STRIKE_V1`, on for `BL`. Phases on the player's own block state: *load* (hands in at his chest, hips sink about
12 cm over 0.3 s; a man walking in sinks about 2 cm; loaded, he closes at no more than 0.6 m/s), *strike* (thrown
when, after the hands' 0.1 s of travel at the current closing speed, the other man's chest will be within 0.6 m of
his shoulders, a partial extension of a 0.72 m arm; inside 0.5 m he steps back instead), *drive* (0.12 s after
contact, or when the palms come off). A strike that misses (arm straight, or 0.4 s gone) loads again;
`BlockRequest.punch`, a number, restarts the move. No impulse is added: the push's held length extends at the palm's
landing speed, so the hit is the strut's force through the allocator. Measured at first contact in every scene: elbow
66-80 deg, 55-66 % through the extension, hand 3.1-3.9 m/s, peak 240-830 N against 37-315 N held, the other man's
trunk moved 0.1-0.56 m/s; before, every palm landed on a straight arm at 0.5-0.7 m/s with 15-58 N. Hips rise 4-6 cm
in the 0.15 s after contact. Even scenes and `-F7` stand; `-F8` A falls at 1.36 s (was 1.90) and B falls again, at
1.74 s. Tests `tests/block-strike.test.ts` (5 with twins).

**What a viewer sees.** Both sink with hands in at the chest, punch onto bent arms with a jolt, hips come up, then
settle; the men square, hips back, knees bent, chests 0.66-0.70 m apart, for
the whole scene; the stronger man drives the other back about 2 m at 0.24 m/s in short steps with no gallop; the man
walking in brakes and engages without a chest bump.

**Flat feet, flag off** (`0d3a2e9`, `8030882`; `FlatStance`, `FLAT_V1` in `src/sim/block-base.ts`, `withFlat` in
`controllers/block.ts`, `FootPlanInput.flat` into `contact-steps.ts`). Each foot's home moves ahead of its hip until
the shin over a flat foot leans at most 20 deg; a planted shin 4 deg past the range forces a step; the step dead zone
is a 16 cm cover and the want leads the hips by half the capture lead. On in the probe: even holds 100 % dead flat
(before 51-92 % of planted time with the heel over 3 cm, worst 19-21 cm), one 15 cm step then planted for 8 s
(before a stream of 6-13 cm steps); the driver takes 20 cm steps at 2.4 per second with 2.5 cm of lift (before 15 cm
at 3.2 per second, a toe drag); a constructed knock-back takes two steps and settles (the model's own settings: four,
dribbling back). Strike contact numbers unchanged. **The flip is parked**, see the plan for why and what is next.
Tests `tests/block-flat.test.ts`; the `load.closeMps` test is in `tests/block-strike.test.ts` (f). 608/608.
Found in the shared stepping model, not changed: swing lift is measured from the start height, so a lifted heel kills
the lift (the toe drag); an infinite gain overrides the feet taking turns (the 3 cm steps); step length stays near
cover plus lead whatever the speed; a planted foot cannot step while the other swings.

## Tracked defects (polish order by look)

From the contest (2026-11-18), ahead of the older list below, parts of which describe the toe stance it replaced:

- The first collision in `-F3`/`-F4` is modest (11-14 cm at up to 0.5 m/s, with 13 cm more in the next second): a
  one-second shove, not a violent burst. Leverage (item 3) is the intended lever; over hands deliver about half the
  strike force and collapse above about 300 N.
- `-F8`: a man mid-step has almost no capacity (a stepping foot weighs 0, a planted foot past the limit 0.5), so once
  he is stepping he keeps losing ground: 4.2 m in 30 steps, his punch never landing. And `-F8` has lost its meaning
  (the athletic stance gives it a hinge again): redefine or retire it.
- The stance reads as a squat from the side: stagger only 10 cm, knees over toes.
- Drivers' rear heels rise 6-7 cm for 20-32 % of planted time (`-F3` A, `-F4` B, `-F7` B).
- The overpower margin can read the other man's push from this substep or the last, by player order.

1. Forearm through forearm, 4.8-7.8 cm with the strike (8-9 before), sustained in every scene. Arms avoid bodies, not
   other arms. Named on `BLOCK_V1_HANDS`. Item 3 is the answer.
2. `-F2`: after the first exchange the walking man's palms come off and the plain re-arm sweeps through the other's
   forearms for about 0.4 s around 1.8-2.2 s (10.9 cm). The re-arm should be a re-punch.
   Also: the crouch is deep and A-framed, and the helmets nearly touch at contact. Wait for the user's animations.
3. The brace: the rear foot lands on its toe with the heel about 22 cm up, and the step back is the weak moment (no
   base behind him while the foot is in the air; `-F7` dips and gives a little ground, harder pushes fell him there).
   Placing the foot by its toe would give a longer base. A quicker or earlier step is the other lever.
4. `-F8`: the man left standing steps onto the fallen one, foot up to 3.4 cm inside him for about 0.5 s, left foot
   stepping twice. The stepping model's existing exception for a foot planted in another player; his block has ended
   by then. (The old "both feet off the ground 0.18-0.23 s" in `-F3`, `-F4` measured drawn ankle height, which the
   crouch's heel lift inflates; with both soles more than 2 cm up it is 0 s.)
5. `-F8`: the fallen man's upper arms cross 18.8 cm in his ragdoll; his fall gains energy in passive solves (up to
   10.65 J at 1.7 s; the mechanism L3 and HC already have, up to 70 J). B's fall with the strike on comes from the
   moved trajectory (switching the strike off at 1.6 s gives the same falls) but has no state-capture test yet.
6. The cap on closing speed while loaded (`load.closeMps`, 0.6 m/s) has no test or fault twin. Without it the walk-in
   crushes inside striking range and the men end chest to chest.
   A starting stance with a stagger (`initial.stance.staggerM`) slides the planted foot 5.8 cm at scene start. The BL
   scenes start square to avoid it; it needs its own fix step.
7. The drawn palm sits 2-3.4 cm off the drawn chest (the patch is on the proxy box, as grips are).
8. No force contest: push strength still follows requested speed; an overpowered man is driven back but only falls by
   the backward tip.
9. With the L3 rules on, `progressStopped` would end a block 0.7 s after contact, and `Role` is `runner | defender`
   with `runner` implying the ball. Both wait until blocking meets a ball carrier.

## The cleanup before it (p28, `09cb8fc`, `a70f463`, `8219cec`)

The 26 profile flips are one pass, `registered`, with a note per layer; eight unused fault switches and three unread
state captures are gone; `scripts/probe/p07-precheck.ts` moved to `scripts/probe-archive/`. No behaviour change
(576/576, all summaries, traces and matrices identical). **Not done, by decision:** collapsing the version ladders
(`WRAP_V1`-`V13` and the rest). Every L3, L4 and HC fixture already runs one version of each; most flag branches are
the base path that the older families and the L4 twins still run; 69 of 72 state captures were taken under earlier
versions. The whole collapse was estimated at 7-10 hours and 20-30 dropped tests for about 500 source lines. Inventory:
worktree `.scratch/p28/inventory.md`. Plan 15's unread footwork profile fields stay for the same reason: they are in
the L2 traces.

## Evidence

- Full checks (main checkout): `.scratch/p28/final` (cleanup), `.scratch/p30/final` (palm push),
  `.scratch/p31/final` with `final.compare.txt` (controller and BL), `.scratch/p32/stance` and `.scratch/p32/resist`
  with their `.compare.txt` (the base), `.scratch/p33/off`, `off2`, `on` with theirs (the strike; worktree
  `.scratch/p33/stills/`, `P-` = before).
- Probes and stills (worktree): `.scratch/p29/` (before), `.scratch/p30/` (palm push in the probe scenes),
  `.scratch/p31/` (BL), `.scratch/p32/` (the base; `stills/`, and `lab/vite.probe.config.ts` for the harder-push and
  feet-together scenes). Unregistered scenes can be viewed with `.scratch/p29/vite.probe.config.ts` and `stills.mjs`.
- Main checkout `.scratch` is 219 MB after pruning plan 15's check results; what is left is from plans before 15.
