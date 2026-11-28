# Plan 16 handoff: blocking, the rough first slice (in progress)

Plan: `docs/open/16_Blocking.md` (what is left). Branches `prereq-ladder` and `model-integration`, both pushed.

## Now (2026-11-28, after p54)

- **p54 (`6822ed5`, `6b3f4cd`): the outside man's palms on the inside man's upper arms** (`LANES_ARM`,
  `outsideOnArm` in `NEWER_SET`) in `-F1`, `-F2`, `-F5` to `-F12`, in place of the shoulder tops beside his neck:
  5-15 cm clear of helmet, facemask and neck in profile, never under 5 cm. The hands carry almost no force there
  (1-9 N against 60-130), so the outside man moves a little less in the standing scenes and 15-30 cm further after
  a snap; the inside lane goes to the same man everywhere and nobody falls. The inside man's elbows were not
  changed (the route p52 proposed); the arm aim made it unnecessary. `-F13` stays on the shoulder tops: see defect
  2. Numbers per scene are in the two commit messages. 720 tests; check `.scratch/p54/b-flip` (compare against
  `a-flag` PASS: only those ten BL summaries changed). Not yet seen by the user.

The bullets below are as of p53 (2026-11-24) except where p54 is named.


- **What a block is.** Thirteen `BL` scenes. A man sets (two-point, three-point offense or defense, or runs in),
  loads, fires out low and strikes; the inside lane goes to whoever gets there with a strike; the inside man wins the
  hit, stays low and drives while the other is stood up, knocked back 0.4-0.6 m in a burst and anchors by 0.9-1.5 s;
  both men's palms stay on, at arm's length. Nobody falls in any scene. `-F12-passRush` adds the first hand fight:
  the rusher swipes a blocker's hand off twice and the blocker re-fits it; since p51 each swipe is a wound-up chop
  with the trunk in it, and the knocked hand is carried off and the shoulder gives. `-F13-rePunch` (p52, reworked in
  p53) has the re-punch with sides: the blocker (offense) holds with his hands inside on the rusher's chest; the
  rusher (defense) re-punches through one of his arms onto his chest, breaking that hold, standing him up (which
  breaks the other) and driving him back half a metre; the blocker re-punches inside onto the chest, both holds come
  back and the rusher stops. Twice.
- **What runs where.** `NEWER_SET` (`fixtures/blocking.ts`) on `-F1`, `-F2`, `-F5` to `-F13`; `-F3`/`-F4` (mismatch)
  on the older set, their flip parked (p49). The hand fight `HANDS_V5` only in `-F12`, `HANDS_V7` (the re-punch with
  sides: holds, strikes) only in `-F13`; `HANDS_V6` (p52's symmetric re-punch) is flag-only, read by one test.
- **Baseline:** main checkout `.scratch/p54/b-flip`, 720 tests. All non-BL fixtures byte-identical to before
  the plan.
- **Waiting on the user:** his look at the p53 sides in `-F13` (links below). Open questions with him: what a
  beaten inside man's hands do when held off past his reach (`-F11`); whether a truly overpowered man in a mismatch
  should end in a fall (`-F3`/`-F4`).
- **Next, in order** (plan item 7): hands that come off past reach and never return (`-F11`, and `-F12` above
  rusher effort 0.55; the hold does not fix it, p53); the outside palm off the facemask, by the inside man's elbows
  in (p52 found the outside aim alone cannot do it); c, rip and swim around a shoulder (the first of the angles;
  where the hold's front rule and `holding` first matter); d, the beaten blocker's recovery and the final loss (with
  it a re-punch can turn the drive back, not only stop it). After that the mismatch's time structure (p49 parked)
  and the offense three-point's knees (ankle roll).
- **Working practice.** One builder at a time, in the worktree `/Users/brandon/.claude-wt/football-sim-7-ladder`;
  check results in the main checkout's `.scratch/pNN/`; the lab on port 5180 runs from the worktree and picks up
  commits on reload. Research for item 7: main checkout `.scratch/research/` (film frames are private reference,
  never commit). Full checks take about 7 min under the machine's usual outside load.

The numbered entries below are the history of each step, oldest first; the latest (p46-p53) are at the end of 6.

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
   - **Landing palms, arms out of his own body, the two-point's feet, p44** (`a7e90ef`, `c265070`; `39ed7ac`,
     `13314f4`; `30f7bc9`, `0ef74fa`; `e66d41c`, `cdf3fb7`). The p43 drift and the getting-set and upper-arm items
     above are fixed here.
     - The landing palm seated (`PalmPushProfile.seat`, `-F9`/`-F10`): the patch is held where the shown palm rests
       on his surface, not at the landmark's projection (the palm ball sat 2 cm in on the push's first substep and was
       released, `invalidPose`). `-F9`: both men's palms on 1.57 s of the 2 s after contact (was 1.15), knocked back
       0.38 m in 0.4 s, anchored 0.70 s after contact (0.54 m, 0.82 s), nobody falls. `-F10` not reached (1.20 s):
       B's palms land on A's pitched trunk top (p41 (b)); its own step (probes parked, worktree
       `.scratch/p44/parked/f10-strike-probes.*`).
     - Upper arm out of his own trunk, all ten BL scenes (`BlockSceneOpts.upperArm`: `withUpperArmClearance` with
       `PalmPushProfile.ownBodyKeeps`, a held push takes the pose least into his own trunk among those clear of
       everything else, in place of being released). Elbows 5.0-5.2 cm into the trunk on the meter's 9.9 cm deltoid
       (was 7.3-8.0; the rule's own shape reads them on the ribs); no outcome changed.
     - The three-point's down hand in front of his knee (`PreSnapHand.kneeClearM`, `LEAN_IN_V5`): getting set no
       piece of the down arm is in his thighs (was 10.9-14.5 cm for the first second).
     - The two-point set on its own feet (`LeanInStance.twoPointSet`, `LEAN_IN_V6`, `-F10`'s A): 56 cm wide (was 37),
       flat, 8 cm stagger, hips 0.74 m, knees 85, trunk 43 (28), hands 20 cm in front of his knees at 0.55 m. The
       defender is now knocked back 1.34 m in all (was 0.85): the burst (0.9 m by 0.7 s after contact), 0.6 s with
       both men's hands off and 0.9 m apart, then A re-lands and drives him 0.27 m; nobody falls.
     - Not done: knees out over the toes (the knees stand on the hip-ankle line, 9 cm inside each ankle: the leg's
       knee pole is the foot heading; a knee-out pole needs an eased hand-over at the snap, or the knees jump); the
       defense front knee stays 75 deg (90 on a flat front foot needs his hips at about 0.69 m, below his shoulders,
       against "hips over the shoulders"; stagger alone gives 80); no weight on the down hand.
     - Defects, worst first: `-F10` both men's hands off 0.6 s after the burst; the offense three-point's off hand
       rests 4-6 cm in his thigh while set (`-F9` A); getting set from the reset a foot steps back once as the trunk
       tips in (all three set stances, by 1.3 s; the two-point also widens in two steps at the reset); the older BL
       scenes' held palm balls 1.3-1.5 cm deep (no seat; `-F8` at the tolerance).
     - 658 tests; baseline main checkout `.scratch/p44/c-two-on` (tool PASS).
   - **Hands on a pitched chest, the inside lane, its leverage, p45** (`501c370`, `da3b6f3`; `785172b`, `c1a29c8`;
     `4a9ea67`, `a292cfa`; `0474e4a`, `27030bf`; on for `-F9`/`-F10` only). The p44 `-F10` hands-off gap and the
     forearms crossing where under and over hands meet are fixed here; who wins is now the inside man, not the first
     man on.
     - Landing on a pitched chest (`BlockProfile.aimThrough`, `PalmPushProfile.stanceCone`): a palm aims at its point
       on the chest front and on along the shoulder-to-point line, and the arm line's cone is judged against the chest
       turned back up to the men's set trunk (20 deg). Both are needed: on A pitched 40-46 deg, B's palms were refused
       (`notFacing`) for 0.25 s.
     - Follow-through (`BlockProfile.followThrough`, `ContestHit.untilStraight`): the winner's request counts his
       man's speed away, and the hit's punch parts the pair only while his arms still extend. Both are needed: the
       punch-until-straight alone overpowers A (a fall).
     - Inside lane (`BlockProfile.lanes`, `LANES_V1`, `decideLane`, `BlockState.lane`, a `blockLane` event): both
       men aim inside (0.36 m up, 7 cm out, elbows under the shoulders) until the first palm is 0.6 m short of his
       man's chest. Then the man whose palm is nearer has the inside (level: the lower man), and the other's palms go
       to the front of the shoulders (0.56 m, 15 cm out, elbows out and a little up). Called later, as the palms land,
       the outside man's hands go outside through the inside man's forearms (11.6 cm). Each man's lane is kept with
       his engaged state, so it can change hands later; the re-punch is not built.
     - Leverage (`BlockContest.inside`, `INSIDE_LEVERAGE` 1.5): the outside man's push, brake and hold are divided by
       1.5 after his drive's bound. The burst runs at that bound, so a factor applied before it changes nothing.
     - Now, both scenes:
       - A has the inside. In `-F10` his palm is 6 cm nearer at the call (the two-point man's reach); in `-F9` it is
         1 mm nearer, in effect a tie. His palms land 7 cm either side of B's centre line; B's land on A's shoulders,
         13 cm out.
       - Forearms no longer cross: at most 1.9 cm (`-F10`) and 3.4 cm for 0.12 s (`-F9`), against 2.3 and 10.6 before.
       - A wins the hit, though B's palms land 0.02 s first. B is stood up (0.81-0.94) and his hips rise 12 cm by 0.3 s,
         against A's 7-8. He is knocked back 0.17/0.12 m in 0.4 s and 0.56/0.29 m by 1 s (`-F10`/`-F9`), anchors at
         1.28/1.07 s, then gives 0.13/0.09 m in 3 s. A is never stood up.
       - Both men's palms are on for 1.93 s (`-F10`) and 1.88 s (`-F9`) of the 2 s after contact (p44: 1.10, 1.57),
         with the chests 41-45 cm apart. Nobody falls.
     - Defects, worst first:
       1. The winner rises too: his hips go up 7-8 cm into his drive stance (the strike's low-to-high, drive stance
          0.84 m), only 4-5 cm below the stood-up loser, so "the winner stays low" is not met.
       2. B's outside palms sit 5-7 cm into the top of A's upper arms at the shoulder through the hold.
       3. `-F9`: A's palms are out of reach 0.22-0.35 s while B is knocked back, and re-land with a forearm 3.4 cm into
          B's.
       4. `-F10`: B's arms fold under the hit (0.04-0.12 s, `collapsed`).
       5. `-F9`'s lane is decided by 1 mm.
     - **Not flipped: the eight older scenes.**
       - The landing and follow-through flags leave who moves and who falls unchanged. `-F8`'s forearms cross more:
         over 1 cm for 7.7 s instead of 0.3 s.
       - Corrected in p46: the run-backs and falls first written here came from running the lanes without the palm
         seat (`seat`, p44). An outside palm meets the man at a slant; unseated, its patch puts the palm ball inside
         him and the push ends `invalidPose` one substep after landing. With `seat` the lanes alone leave all eight
         close to their registered runs. See p46 for what the full set does.
     - 664 tests; baseline main checkout `.scratch/p45/c1-on` (tool PASS).
   - **p46: the winner stays low, the hands stay on, the knock-back ends** (`358bf29`..`394e78e`, each flag off then
     on for `-F9`/`-F10` only).
     - Flags: `BlockProfile.under` (`UNDER_V1`, `BlockContest.beaten`: the winner's stance goes to a low under
       stance by how far the hit beat his man past him, held while his palms are on; the beaten man stays up);
       `LANES_TOPS` (outside palms on the tops of the shoulders); `PalmPushProfile.foldKeeps` (a folded push stays on
       at no force up to 130 deg); `BlockContest.armsGive` (palm effort times 1 less the stood level);
       `BlockLanes.tie` (`LANE_TIE_V1`: inside 2 cm of reach and 1 cm of hips the man driving beats the man holding);
       `BlockContest.burstTaper` (once his man is beaten half way, the burst's extra over the ordinary push runs to
       zero over the drive's window); `BlockContest.lowUnheld` (the contest does not read the beaten man's held
       posture lift as him being high).
     - Now, both scenes, both orders: A's hips 0.82 at 0.3 s then 0.77, trunk 27 deg, under B's 0.87 for the whole
       hold (p45: both about 0.82 by 1 s). Both men's palms on for all of the 2 s after contact; no fold-off, no
       out-of-reach, no forearm crossing. B knocked back 0.14-0.16 m by 0.4 s, 0.42-0.49 by 1 s, anchors at
       1.22-1.28 s, 0.56-0.64 m at the end, 8 steps (A 4-5). Nobody falls.
     - Why the taper and the low reading: with the hands staying on, the full burst knocked B back a second time
       0.25-0.35 s after contact and ran him 1 m in 12 steps, with his overpowered clock at 0.29-0.30 of its 0.3 s in
       all four runs; reversed `-F9` fell (B, 4.26 s). Decision: not accepted, the outcome was decided by noise and
       the picture is a burst that ends. The overpowered clause is unchanged; the clock now peaks at 0.09-0.11 s
       (`tests/block-taper.test.ts` resumes the reversed `-F9` capture both ways).
     - Defects, worst first: (1) B's outside palms still 4.1-4.3 cm into A's upper arms (mean 2.3-2.7) while his arms
       are folded and giving; (2) B's 8 steps, whether they read as committed; (3) `-F9`'s lane is still a tie in
       effect, now by rule.
     - The older eight under this set: superseded by p47's table below. Twin for the seat finding: worktree
       `.scratch/p46/dtwin.ts`.
     - 673 tests; baseline main checkout `.scratch/p46/e2-on` (tool PASS against `p45/c1-on`: only `-F9`/`-F10`
       changed).
   - **p47: the outside palms on the shoulders, the run-in scene** (`73331a0`..`9efeb8a`).
     - `PalmPushProfile.slide` (`PALM_SLIDE` 1 m/s, on for `-F9`/`-F10`): a held palm slides on to its aim, so the
       outside palms ride up to the shoulder tops within 0.1 s. Into the upper arm: max 2.3-2.7 cm in the landing
       frame only, mean 0.1-0.2 (before 4.1-4.3 / 2.3-2.7), past 1 cm for 0.02-0.18 s (before 1.9 s). Knock-back,
       anchor, hips, steps as p46; overpowered clock 0.07-0.09 s; nobody falls.
     - **`BL-F11-runIn`** (new): A runs in from 8 m at up to 3 m/s, upright (hips 0.88-0.91), onto B set in his
       two-point, who steps up at the snap (3.3 s). `BlockProfile.runIn` (`RUN_IN_V1`: the approach no longer brakes
       the runner before the hit) and `ContestHit.legsHold` (the hit's winner holds at most his push capacity of it;
       without it the set man holds all 3000 N and the runner bounces back at 0.9 m/s). Contact 4.08 s at 2.6 m/s;
       B has the inside (his palms land first) but A wins the hit: B knocked back 0.27 m by 0.4 s, 0.49 by 1 s,
       anchors at 0.87 s, 4 steps; A drives from under. Nobody falls.
       **Defect, a design question for the user:** B's inside palms come off 0.4 s after contact and stay off (on
       0.40 s of 2 s), arms out straight short of A's chest: A is low and pitched behind 0.57 m of arm, his lower
       chest 0.81-0.90 m from B's shoulders against 0.72 m of reach. Measured, none landed: inside aim at 0.56 m
       (on 100 %, A's forearm 9.5 cm into B's upper arm), 0.46 m (25 %, 7.2 cm), lanes off (100 %, 7.7 cm, the old
       crossing), stay-low off (no change).
     - **The older eight under the full set, not flipped** (registered -> full set; both orders agree):
       `-F1`, `-F5`, `-F6`, `-F7` look ready: the inside man wins, the other gives 0.3-0.5 m in 4-10 steps and
       anchors by 0.4-1.3 s (registered: about 0, 0-2 steps). `-F3`/`-F4` (mismatch): run back 2.4 m, no anchor,
       25-39 steps (registered 0.8 m). `-F2`: a 4 m chase, B never anchors, his palms on 3 %: his outside arms
       fold past 130 deg under the walk-in, the push ends `collapsed`, his ready point is inside A and re-arming
       needs 8 cm (`hold.withdrawM`), while A follows his speed (fold-keeps off: 1.06 m, anchored 2.12 s). `-F8`:
       **B falls at 2.00 s** (`contest:pastAnchor`; he wins the hit from outside and goes under). The inside hands
       stay on 99-100 % now (the tie rule gives the lane to the man who drives; p46's out-of-reach finding needed
       the lane decided by noise). **The lane is called at rest** there (0.08-0.19 s, ready hands inside 0.6 m);
       in `-F1` and `-F7` sub-millimetre differences decide it. Next: call the lane only once a strike is thrown,
       with a stated rule for a true tie. Reproduce: worktree `.scratch/p47/mcli.ts <ids> --both --full`.
     - 678 tests; baseline main checkout `.scratch/p47/c3-f11` (tool PASS against `p46/e2-on`: `-F9`, `-F10`
       changed, `-F11` new).
   - **p48: what the older eight needed, all flag off** (`a1b747b`..`cabe06b`; no summary changed; supersedes
     p47's older-eight readings).
     - `laneOnStrike` (on for `-F9`/`-F10`/`-F11`, motion identical, only ids and the lane event's payload): the
       lane is called only once a strike is thrown, with a stated, order-independent tie rule. `-F1` on the full
       set: called at 0.53 s, one substep after both men throw (before: 0.08 s, from hands at rest).
     - `frame` (flag off): arms folded against his man hold him there as if his hands were on. `heldByPush` (flag
       off): a hit's outcome is held only while the palms actually push. `strikeAtLoadGap` (flag off): a man
       stopped at his load's close gap strikes from there (both `-F8` men stood loaded 0.61 m from a chest against
       0.6 m of strike range, no strike for 9 s; registered `-F8` has the same standoff until 4.08 s).
     - `-F2` under the full set: B gives 0.45 m and anchors at 0.93 s, his folded arms against A as a frame (was
       the 4 m chase); he never re-arms, palms push 3 %. `-F8`'s fall was a defect: B's folded palms, kept on at
       no force, still held A beaten and B low while A pressed his chest, so B tipped rigidly 8 to 21 deg and went
       down; now nobody falls, B knocked back 0.56 m, anchors 1.52 s.
     - **Older eight under the full set plus these four flags** (ground given, anchor after contact; registered in
       brackets): `-F1` B 0.51 m, 0.95 s (about 0); `-F2` B 0.45 m, 0.93 s (0.51, 0.68); `-F5` B 0.47, 0.95 (0);
       `-F6` B 0.42, 0.93 (0); `-F7` B 0.53, 1.10 (0.1); `-F8` B 0.56, 1.52 (A 0.11); `-F3` B and `-F4` A driven
       2.40 m in 39 steps, no anchor (0.8 m). No falls, overpowered clock at most 0.13 s, palms on 97-100 % except
       `-F2` B. Reading: six ready; `-F3`/`-F4` are not (a constant-speed drive, which the plan rules out). A flip
       changes who wins the even scenes (the inside man now knocks the other back), so it is the user's decision.
       Table: worktree `.scratch/p48/older8-final.txt`.
     - **Parked: knees out over the toes** (main checkout `.scratch/p48/parked/d-knee-out/`). The shoe is rigid on
       the shin and only pitches, so a knee turned out yaws the shoe 15-21 deg while the plant's footprint stays
       on the body heading; the plant anchor jumps 6.9 cm when the pivot goes from toe to heel corner (a skate
       while getting set). Ways on: (a) toe the set stance's plants out in the foot plan so the knee follows the
       toe; (b) an ankle roll and twist in the pose and in the ragdoll's `shoeOnShin`. Now: knees 8.8 cm inside
       the ankles in the set stances.
     - 684 tests; baseline main checkout `.scratch/p48/c2-atgap-off` (tool PASS against `p47/c3-f11`: no summary
       changed, three BL traces).
   - **p49: six older scenes on the newer set, toed-out set stances** (`4960a2a`..`6df5764`; the user's seventh
     look, "looks good", taken as the go for the flips).
     - `NEWER_SET` (`fixtures/blocking.ts`; tests on the older scenes spread `WITHOUT_NEWER` from
       `tests/helpers.ts`) is the full `-F9` set with `frame`, `heldByPush`, `strikeAtLoadGap`. On for `-F1`,
       `-F2`, `-F5`, `-F6`, `-F7`, `-F8`, `-F9`, `-F10`, `-F11`; `-F3`/`-F4` still run the older set.
     - Flipped scenes now: the lane is called at the strike, the inside man wins, the other gives 0.42-0.56 m and
       anchors 0.93-1.52 s after contact in 6-10 steps (registered: standoffs, 0-0.1 m), palms on 97-100 %, no
       forearm crossing (was 3.6-5.0 cm). Nobody falls in either order; overpowered clock at most 0.13 s (`-F1`).
       `-F2`: B's arms fold at the hit and stay folded as a frame (palms on 3 %), and from 1.90 s the chests touch
       (15 N s first touch); the re-fit of the hand fight is the fix.
     - Toe-out (`FlatStance.toeOutDeg`, `withToeOut`, `BlockSceneOpts.toeOut`): two-point 20 deg (knee from 8.7 cm
       inside the ankle to 0.6 outside, still 7.2 inside the toe; 0 steps getting set, was 2), defense three-point
       10 deg (knee 2.9 cm outside the ankle; 2 steps, was 4); no plant jump; the first step after the snap lands
       straight. The offense three-point is not toed: his hip is already 31 deg past its range at the snap (older
       defect) and folds further; he needs an ankle roll/twist or more hip twist range at deep flexion.
     - **Parked: `-F3`/`-F4` under the newer set** (main checkout `.scratch/p49/parked/c-mismatch/`). The contest
       has no time structure: the hold is a damper (zero at rest), the driver's request stays 0.8 m/s ahead, the
       capacity ratio is about 5.4 (effort 2.5, lower 1.44, inside 1.5), so the pair settles at 0.25 m/s for 2.4 m.
       Pushing only between steps pulses the speed but never anchors him. Needs: a static anchor for a set loser,
       the push arriving in strides, committed steps back (6 cm now), and for a true mismatch a route to a fall
       (a steady drive never stands him up, so the overpowered clause never runs; that changes who falls: the
       user's decision).
     - 686 tests; baseline main checkout `.scratch/p49/d2-toe-on` (tool PASS against `p48/c2-atgap-off`: nine BL
       scenes changed, same results and end representations).
   - **p50: the hand fight, step a** (plan item 7; `96b0c00`..`3bc13cd`; no existing scene changed).
     - Per-hand state: `BlockState.hands`, one `HandState` per side (`advanceHands`, in the snapshot as
       `block[id].hands`): doing (home, striking, swiping, knocked, refitting), on, pushing, where, lane, the last
       knock. Flag `BlockProfile.handFight` (`withHandFight`, `HANDS_V1`..`V3`, `BlockSceneOpts.handFight`). Each
       hand's lane is still the man's lane.
     - Swipe: a request per scene, `BlockRequest.swipes {atS, hand}`. The hand rises 9 cm over the middle of his
       man's forearm and chops to 16 cm under and 14 cm out; contact is geometric (`Simulation.handContacts`,
       palm within 1.5 cm of the forearm capsule, men in id order); a hit ends the push (`ArmSystem.knock`,
       reason `knocked`) and rides the arm down; a chop that meets nothing is a miss.
     - Cost of a knocked pushing hand: the hand driven 20 cm along the chop and 12 cm off his man for 0.15 s, the
       trunk 6 deg further over, his contest capacity halved while knocked and 30 % down until the hand is back on
       (`handsLeverage`); the swiper bursts into the opening until then (`openedBy`; the cut alone moved about
       50 N net). Re-fit: the knocked hand pushes straight at its lane's aim at 3 m/s, the other stays home;
       after 0.4 s it falls back to the ready point.
     - **`BL-F12-passRush`** (new; A two-point blocker, B rushing at effort 0.55, swipes at about 4.25 and 5.55 s;
       both orders the same): each swipe meets the arm 0.05 s in and is over in 0.2 s; A's hand is off
       0.21-0.23 s and re-fits. Exchange 1 lands while B is still being driven back from the hit (he gains
       nothing); exchange 2 gains B 5 cm and turns A 1 deg. Nobody falls; overpowered clock 0.05 s.
     - Defects, worst first: (1) the gain is small and the knocked shoulder does not give (0.3 cm; trunk 5 deg);
       (2) the swipe reads as a tap: no wind-up, 0.2 s in all; (3) B's chopping palm 5 cm into A's arm for 0.2 s
       (arms do not collide); (4) at rusher effort 0.65 or more A's hands come off past his reach after the hit
       and never return (existing; B's outside arms hold his chest out of reach; the `-F11` defect), so the scene
       sits at 0.55; (5) the swiper's own hand returns through the ready point (0.27 s).
     - For step b: a rule that changes one hand's lane, and the inside leverage counted per hand (`contestDrive`
       reads the man's lane). For step c: the swipe's path, contact and ride generalised to over/under the arm,
       a lateral move request, a contest rule for "past him"; `openedBy` is the window.
     - 693 tests; baseline main checkout `.scratch/p50/a4-passrush` (tool PASS against `p49/d2-toe-on`: only the
       new scene).
   - **p51: the swipe made fluid** (plan item 7; user 2026-11-24 on `-F12`: "the chops are ok but a bit robotic and
     short; more fluid, larger motions"; `9cd27ed`, `609012f`, `28e765a`, `d882f15`; only `-F12` changed).
     - The swipe as one move (`HandSwipe.arc`, `SwipeArc`, `HANDS_V4`): every part an eased curve (minimum jerk) in the
       swiper's level frame at his shoulder. Wind-up 0.14 s to 20 cm over the shoulder, 15 cm ahead and 4 cm out (by
       his ear, the elbow out); chop 0.18 s through a point 10 cm over the middle of his man's forearm (held once met)
       to 50 cm under the shoulder, 22 cm out and 35 cm ahead; then back onto his man along a curve that lands along
       the shoulder's line (`HandRefit.path`, 0.17 s), never through the ready point. The knock is along the line to
       the follow-through's end. A request carries its own palm top speed (`ArmIntent.speedMps`: the arc 10 m/s, the
       carry 9; the arm's everyday 4 m/s would cut it) and its own twist rate (`ArmIntent.twistRadPs`, the arc 50
       rad/s against the joint range's 12: the hand passing close in front of his shoulder turns the upper arm about
       itself fast, and at 12 the twist window flipped the elbow over or under the shoulder in one frame, 4 shoulder
       snaps of 65-130 rad/s in `-F12`).
     - The knocked hand carried 30 cm over 0.15 s, fastest as struck (`HandKnock.carry`), and re-fitted along the
       same kind of curve from where it is.
     - The body (`HandBody`, `handsBody`, `HANDS_V5`): the swiper's trunk turns with the swing ahead of the hand (6
       deg back, 10 through by the chop's middle), dips 6 deg onto the hinge and leans 4 deg to that side; the knocked
       man falls into the side his hand left (16 deg forward, 8 deg down), all eased back over 0.17 s. Asked of the
       facing and the lean; the yaw controller follows late and at about a third (time constant about 0.27 s).
       Larger values made landings late and pushes refused (`notFacing`, `collapsed`; one hand off 0.84 s).
     - In `-F12` (V3 against V5, first swipe / second): the hand's rise over its start 0 against 0.23 / 0.28 m;
       contact 0.05 s in at 4.0 / 3.4 m/s against 0.237 s in (the chop's middle) at 7.7 m/s; on under the shoulder
       0.19-0.20 against 0.45-0.50 m; path to back on 0.57 / 0.52 against 1.8 / 1.9 m; off 0.27 / 0.26 against 0.44
       s; the ready point 2 / 1 steps against 0; the palm's largest frame-to-frame change of velocity 269 / 228
       against 153 / 158 m/s^2. Palm into the arm 5.3 / 3.4 cm for 0.17 s against 4.3 cm for 0.05 s / 0.8 cm.
       Knocked hand carried 0.18 / 0.16 against 0.25 m, its largest change 143 / 156 against 66 m/s^2, back on
       0.21-0.23 against 0.23-0.24 s after the knock. Swinging shoulder forward 5.1 / 5.8 against 9.7 / 9.3 deg,
       down 1.8 / 0.2 against 4.4 / 3.1 cm; knocked shoulder forward 1.6 / 1.4 against 8.4 / 7.8 deg (most 0.26 s
       after the knock, half back 0.2 s later), down 7.5 / 1.3 against 7.1 / 2.6 cm. B's ground over the 0.5 s after
       each swipe -5.5 / +5.2 against -6.9 / +0.5 cm (his own hand is off longer). No shoulder snap (B's fastest
       joint 32 rad/s, V3 31). Nobody falls; both orders the same.
     - End of the rep (the still the user sent: chest-close, arms tangled, a hand at the facemask): not the hand
       fight. `-F10` without it ends the same: B's outside-lane palms sit on the tops of A's shoulders beside his
       neck (`LANES_TOPS`, p46), the palm 0.39 m from A's head centre at neck height, which in profile reads as a
       hand at the facemask; the heads 0.80 m apart; the forearms 6 cm apart (they cross only in projection).
       Proposed step: the outside aim on the front-top of the shoulder pad (lower and further out, about 0.60 m up
       and 0.16 m out) with the elbow out, now that lanes keep the inside man's arms level; flag off, then BL,
       judged on arm overlap (the p46 reason for the tops).
     - Defects, worst first: (1) the swiper's trunk never visibly loads back (the 0.07 s back phase is shorter than
       the yaw's lag; the forward turn shows); (2) the knocked man's give is a turn of 8 deg and 3-7 cm of shoulder:
       no ground follows, the contest's cost is unchanged, and B now gains less ground on the second swipe (0.5
       against 5.2 cm) because his own hand is off longer; (3) the palm still passes up to 4 cm into the arm for 3
       frames at contact (arms do not collide); (4) the hand off 0.44 s, at the top of the film's range; (5) from
       the front the rising forearm crosses his facemask in projection at 4.33 s (beside the helmet from behind);
       (6) the outside palm at the shoulder top beside the neck (above, older).
     - For step b (the re-punch): `HandRefit.path` is the eased way onto a new aim; a lane change can reuse it with
       its own aim. For step c (rip and swim): `SwipeArc`'s frame and timing take an over or under path, and
       `ArmIntent.twistRadPs` any fast move past the shoulder; `handsBody` is where the trunk's dip and turn for a
       rip go.
     - 702 tests; baseline main checkout `.scratch/p51/e-passrush` (tool PASS against `p51/d-elbow-off`: only the
       one scene, no visible column worse). Stills: main checkout `.scratch/p51/stills/before/`,
       `after/` (`s1_` the first swipe, `s2_` the second, `end_` the end of the rep).
   - **p52: the outside palm (parked) and step b, the re-punch** (plan item 7; `c9265b2`, `74449b3`; only the new
     scene).
     - **Parked: the outside palm on the front of the shoulder pad** (main checkout `.scratch/p52/parked/part1/`,
       `NOTE.txt`, grids and stills; no source patch). The palm-to-head gap in profile stays 13-17 cm for any aim on
       his chest (y 0.54-0.65 x 0.13-0.22 in `-F10`), so the read barely moves; lower or wider aims put the palm into
       his upper arm (up to 11 cm, for about 4 s of the rep); the pad top (y 0.66-0.68) stands him up (pitch 26 to 18
       deg) and y 0.70 or more holds no push; across BL, y 0.65 x 0.23 loses every hold in `-F7` and puts the palm in
       his arm for 4-7.5 s in `-F1`/`-F5`/`-F6`. Why: the inside man's upper arms run level across the front of his own
       pad and his chin is over his upper chest; the pad top beside the neck is the only clear patch. Proposed: the
       inside man's elbows in (the inside lane's pole tighter, upper arms angled down), then the outside aim down
       onto the cleared pad, judged in the lab.
     - The re-punch (`HandRePunch`, `HANDS_V6`; `BlockRequest.rePunches {atS, hand}`, per scene, no selection). Load
       0.18 s: off his man along an eased curve bowed 14 cm out and 6 cm back to 30 cm under his shoulder, 12 cm
       ahead, 4 cm in, elbow down and back; his shoulder 8 deg back, trunk 5 deg over. Punch 0.16 s (landing within
       0.12 s more): up and in along a curve through 12 cm under his man's forearm's middle onto his chest plate 46
       cm up and 10 cm out, 12 deg through, the dip held until it lands, eased back over the re-fit's time. Top
       palm speed 9 m/s. The gap: as the punch begins its way must keep 10 cm from his man's upper arm (`punchClearM`);
       closed, it goes onto his own lane's aim and nothing changes hands. The wash (`Simulation.rePunchContact`):
       the punching palm or forearm within 4 cm of his man's forearm on that side, or landing, knocks that arm up,
       out and back off him (`HandKnockFact.wash`, opening nothing: a wash that opened the knock's burst felled the
       washed man stiff, `contest:overpowered`), its elbow eased onto the outside lane's over the carry (without
       it, an 83 rad/s shoulder snap at the re-fit); his lane outside, the puncher's inside.
     - Leverage per hand (`lanesLeverage`, read by `contestDrive` under `rePunch`): both hands outside 1/1.5, one
       each 1/sqrt(1.5) for both men, none 1; a hand off to re-punch costs the existing off cut (0.3). No force of
       its own.
     - **`BL-F13-rePunch`** (new; `-F10`'s even rep, A drives with the inside, B holds; B re-punches his right at 3.9
       s and his left at 4.5 s). Right / left: drawn back 0.47 / 0.46 m and down to 0.41 / 0.40 m under his
       shoulder, path 1.14 / 1.10 m, top speed 8.2 / 7.6 m/s, off A 0.31 / 0.33 s, washed 0.26 / 0.25 s in, landed
       0.41 / 0.42 m up A's core, 18 / 12 cm out (inside his arm: his shoulder at 23 cm); the palm's largest
       frame-to-frame change of velocity 362 / 296 m/s^2, at the landing (the palm stopping on his chest); palm into
       his arm 0 / 1.4 cm, forearm into his forearm 0.5 / 1.4 cm for one frame. A's hand back on him outside 0.27 /
       0.31 s after the wash. A's drive: from 4.9 s to the end -0.2 cm (`-F10`: +12.2 cm). Nobody falls, no snap,
       the same in both orders; visible columns as `-F10` but the own arm-trunk overlap 8.1 s against 7.45 (the
       loaded hand by his ribs).
     - Defects, worst first: (1) the drive stops but does not turn back: B stays stood up by the hit (`beaten` 0.9,
       held while A's palms are on him), recovery is step d; at B effort 0.55-0.6 A is walked back 5-6 cm over 2.6
       s; (2) the first wash meets A's left just after both his pushes ended past his reach in the drive (4.125 s,
       the `-F12` defect), so it ends no push and A's shoulder does not give for it (the second does); (3) the
       right lands wide on A's turned chest (18 cm out, 5 cm inside his shoulder); (4) with the punch 12 cm under
       his forearm the forearms still meet up to 5 cm for 1-2 frames when his arm sits lower (F10's rep at 4.4 s:
       4.9 cm); deeper passes are worse (the punching forearm sweeps up into his); (5) `-F1`-style hold against
       hold: the drive does not move either way after it.
     - 706 tests; baseline main checkout `.scratch/p52/b-scene` (tool PASS against `p52/a-flagoff`, itself PASS and
       byte-identical against `p51/e-passrush`: only the new scene). Stills: main checkout `.scratch/p52/stills/f13/`
       (profile 3.88-7.5 s, oblique 4.22/4.68/4.84/7.5 s; `F10-` the same times without), `before/` (p51's ends).
   - **p53: the hands have a side** (plan item 7; user 2026-11-24 after p52: "The repunches should be (defense trying
     to push oline back / break their grip) and (offense trying to reestablish a good hold on their inside chest)";
     `bed6c24` plan, `2586d7f` flag off, `95d0aa0` the scene; only `-F13` changed).
     - Sides: `BlockRequest.side`, else the stance's (`blockSide`). `HANDS_V7` = `HANDS_V6` + `sides`
       (`HandSides {hold, strike}`) + the wash mostly out.
     - **The hold** (`HandHold`, `nextHold`, `Simulation.advanceSides`). An offense hand on his man's chest plate
       (within 17 cm of his centre line and no higher than 0.58 m up his frame: the shoulder tops are outside), not
       folded, his man within 35 deg of his heading and facing him within 45, has a hold, formed once per push. It
       ends at once when its push ends (a knock, a wash, past his reach) or he is stood up past 0.5; it is given up
       0.12 s after its other conditions end and is kept until then, counted as holding (`BlockState.holdingS`, the
       snapshot's and the summary's `holding`; a meter, nothing reads it). While it holds, its push may pull
       (`PushRequest.hold`, `arms.ts pushStep`): past 6 cm over the push's rest length (near his full reach), the
       strut's spring and damper in tension, at most 300 N at effort 1. Control is leverage only (`sidedLeverage`,
       read by `contestDrive` under `sides`): the defense man is cut per hold on him (two 1/L, one 1/sqrt(L), none 1;
       L = 1.5), the offense man per hand of his man's on him inside. The defense's hands never hold.
     - **The strike** (`HandStrike`, `motor-step.ts struckNow`). The defense's re-punch landed (`handStrike`) makes
       his contest strike for 0.25 s: its burst and the hit's parting (`blockHits`), so the blocker is knocked back
       and stood up, which breaks his other hold. Either man's re-punch landed puts him back under (his `beaten` cut
       to his stood level's excess over his man's); without it a man held beaten by the hit cannot answer.
     - **The wash** (`HANDS_V7`): up 0.2, out 1, back 0.4. `HANDS_V6`'s carried a three-point man's arm on the
       shoulder top back over his shoulder to straight up (a 97-134 rad/s shoulder snap); the washed elbow is turned
       from the pole its pose had (`HandKnockFact.poleL`, `ArmSystem.poleOf`).
     - **`BL-F13-rePunch`** (reworked): the pass-rush set (A two-point offense holds at 0.5, B three-point defense
       rushes at 0.6, snap 3.3 s, 10 s). A's hit puts both his hands inside on B's chest holding him (3.78 s; off
       past reach in the hit's parting at 4.0, holding again at 4.25); B at 1/L and stalled. Per move
       (back = drawn back from where it was; under = below his shoulder at the load; jerk = largest frame-to-frame
       change of palm velocity; off = hand off his man; landing in his man's core frame where the push takes hold, x
       from his centre line, his shoulder at 23 cm):

       | move | back | under | path | top speed | jerk | off | landing x / up | his hand back on |
       |---|---|---|---|---|---|---|---|---|
       | B right 5.0 s | 0.42 m | 0.36 m | 1.00 m | 8.1 m/s | 211 m/s^2 | 0.31 s | 13 / 42 cm | 0.90 s |
       | A right 5.7 s | 0.59 | 0.31 | 1.08 | 7.4 | 241 | off from 5.35 | 20 / 60 | 0.25 |
       | A left 6.3 s | 0.42 | 0.34 | 1.00 | 7.4 | 206 | 0.30 | 14 / 40 | 0.24 |
       | B left 7.2 s | 0.42 | 0.37 | 0.99 | 7.5 | 166 | 0.31 | 14 / 45 | 0.48 |
       | A left 7.9 s | 0.58 | 0.31 | 1.12 | 7.6 | 245 | off from 7.66 | 20 / 58 | 0.25 |
       | A right 8.5 s | 0.45 | 0.34 | 1.05 | 7.4 | 121 | 0.32 | 12 / 40 | 0.24 |

       B's right goes through A's left arm (washed 0.25 s in, that hold off with its push) and strikes his chest at
       5.32 s: A stood up to 0.97 (hips 0.78 to 0.89 m), his right hold broken (stood, 5.35), driven back 0.49 m by
       6.3 s. A's right re-punch inside B's left arm (washed) holds at 6.05 s, his left inside B's right (washed) at
       6.61: B back at 1/L and stopped, A's hips back to 0.78, A pushes him back 6 cm to 7.2 s. Again: B's left
       (washes A's right 7.47, strikes 7.52) breaks A's left hold (stood, 7.56), A to 0.57 and driven back 0.47 m by
       8.8 s; A's left holds at 8.25 (off past reach 8.35, on again 8.45), his right at 8.82; B stopped (0.5 cm on
       from 8.8 s to the end). Holds, per hand: A left 3.78-4.00, 4.25-5.26 (washed), 6.61-7.56 (stood), 8.25-8.35,
       8.45-end; A right 3.78-4.00, 4.25-5.35 (stood), 6.05-7.47 (washed), 8.82-end. `holding` 0 for both. Nobody
       falls, no snap; the same in both orders (diverging slightly after 7.0 s: no 8.35 off). Palm into his arm at
       most 3.7 cm (A's left at 6.3), forearm into his forearm at most 6 cm for one frame (A's right at 8.5).
     - Holding, constructed (`tests/block-sides.test.ts`, the scene's set with nobody re-punching, the front
       narrowed to 1 deg, B shoved sideways at 5.0 s): both holds given up after their 0.12 s, `holding` 0.24 s
       (two hands); the twin that never gives up, 0.87 s.
     - **The hands off past reach** (`-F11`, `-F12`, p52's defect 2): the hold does not fix it. A strike or the hit
       stands the blocker up past 0.5, which breaks his holds, and parts the men past reach; the 300 N pull begins
       only near full reach. In this set at 0.6 the hands come back by themselves after the hit (0.25 s); an offense
       re-punch brings back a hand lost past reach (A's right, 5.35 to 6.05 s). At rusher effort 0.65 and up A
       loses the hit and his hands hang off for the rest of the rep, as before.
     - Not moved: `-F12` stays on `HANDS_V5` (no clear gain: its subject is the swipe, which ends a hold at once,
       and its off-past-reach defect is unchanged). `HANDS_V6`'s symmetric re-punch is now flag-only, read only by
       p52's test (`tests/block-repunch.test.ts`, on `-F10` with B re-punching); cleanup later.
     - Defects, worst first: (1) after A's restore B only stops (A pushes him back 6 cm); turning the drive back
       is step d; (2) A's washed left in the first exchange is back on B only 0.9 s later, outside, while he is
       driven back (the others 0.24-0.48 s); (3) A's first re-punch of each exchange lands high and wide (20 cm out,
       58-60 cm up, by the inside of B's shoulder) and holds only when the push settles inside the frame 0.05-0.35 s
       later; (4) a hold has no look of its own (the hand cannot grip; what reads is the hand staying on and the
       man not getting off); (5) the 8.25 s hold goes off past reach after 0.1 s (A still being driven back); (6)
       forearm into forearm up to 6 cm for one frame, palm into arm up to 3.7 cm.
     - What step c needs from it: the hold's front (35 deg) and square (45 deg) never fail in a straight-on scene
       (both men track each other within about 2 deg), so `holding` stays 0 everywhere; rip and swim put the
       defender off the blocker's centre line, where a hold must be given up (or counts as holding), and his hand
       on the blocker's arm is a defense hand that ends a hold (a knock, as the swipe's). The strike is the defense's
       tool there too (a club is a strike on the shoulder).
     - Visible columns: as p52's `-F13` (no snap, no impossible joint beyond the set's own hip flexion); the shallow
       own arm-trunk overlap 11.75 s of 20 player-s (p52 8.1 of 16; `-F12` 7.47 of 16): six loads by the ribs.
     - 714 tests; baseline main checkout `.scratch/p53/b-scene` (tool PASS against `p53/a-flagoff`: only `-F13`
       changed, no run worse; `a-flagoff` PASS and byte-identical against `p52/b-scene`). Stills: main checkout
       `.scratch/p53/stills/f13/` (profile 4.5-9.9 s, oblique 5.25/6.0/9.9 s; the man on the left in profile is B).
   - **Left from before p41, worst first:** (1) (done, see above) no low-to-high fire-out: out of the stance he stands up to hips 0.90 m and creeps
     in at 0.35-0.43 m/s for 1.2 s before the punch. A faster, loaded fire-out is parked (worktree
     `.scratch/p40/parked/fire-out-v3.patch`): the root climbs to 0.92 m while the trunk comes up, against a
     0.725 m target, and the suspension only pushes up; find what lifts it, with a twin capture. (2) No weight on
     the down hand (the arm only reaches). (3) Defense front knee 75 deg. (4) (done, p44) The two-point has no feet of
     its own (5c). (5) Getting set takes 2.3 s.

Lab (`cam=front` is the profile view of two men facing each other; `cam=side` shows a back; `&order=rev` runs the
players in reversed order):

- `?fixture=BL-F10-twoPointVsThree&cam=front&speed=0.25&t=5.5` p54: the outside palms on his upper arms, clear of
  the facemask (`BL-F12-passRush&t=7.5` the end of a rep; `BL-F1-even&t=3` a standing scene)
- `?fixture=BL-F13-rePunch&cam=front&speed=0.25&t=4.9` (B on the left) B attacks: load (5.1), through A's left
  arm onto his chest (5.3), A stood up and driven back (5.5-6.3); `&t=5.6` A restores: his right inside (load 5.8,
  lands 6.0), his left (6.3-6.6), B stopped (7.0); `&t=7.1` the second exchange (B's strike 7.5, A's left 8.2,
  right 8.8); `&t=9.9` the end (`cam=oblique&t=5.25` B's punch through A's arm)
- `?fixture=BL-F10-twoPointVsThree&cam=front&speed=0.25&t=4.5` p52's symmetric re-punch's set without it: A drives on
- `?fixture=BL-F12-passRush&cam=front&speed=0.25&t=4.2` the first swipe: wind-up, chop, re-fit (`&t=5.5` the
  second; `cam=side&t=4.3` the elbow out at the wind-up's top)
- `?fixture=BL-F12-passRush&cam=front&speed=0.25&t=7.5` the end of the rep: the outside palm on the shoulder top
  beside the neck (p51's finding; p52 parked the aim fix)
- `?fixture=BL-F12-passRush&cam=side&speed=0.25&t=3.9` defect: the blocker's hands briefly off past his reach
- `?fixture=BL-F10-twoPointVsThree&cam=front&speed=0.25&t=2.5` the set stances, toed out
- `?fixture=BL-F10-twoPointVsThree&cam=front&speed=0.25&t=3.6` the hit: the winner low, hands on, burst then anchor
- `?fixture=BL-F9-threePoint&cam=front&speed=0.25&t=3.6` the same from two three-points
- `?fixture=BL-F11-runIn&cam=side&speed=0.25&t=3.9` the run-in hit (`cam=front&t=4.5`: the set man's hands off,
  the open question)
- `?fixture=BL-F7-hard&cam=side&speed=0.25&t=0.4` the hard drive, now with a winner
- `?fixture=BL-F8-hardNoHinge&cam=side&speed=0.25&t=1.0` the strike from the load's gap
- `?fixture=BL-F2-walkIn&cam=side&speed=0.25&t=1.8` defect: folded arms as a frame, the chests touching
- `?fixture=BL-F3-blockerDrives&cam=side&speed=0.25&t=2` the mismatch on the older set (its newer-set conveyor is
  parked)

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

**Current (after p53), worst first.** Each step's own list is in its entry above.

1. The swipe costs little: the knocked shoulder gives (8 deg) but no ground follows, B gains 0.5 cm on the second
   swipe; the swiper's trunk never visibly loads back (p51). A re-punch stops a drive but cannot turn it back
   (p52's held `beaten`; p53's restore stops the rusher and pushes him back 6 cm; step d).
2. The outside palm beside the neck (a hand at the facemask in profile, and a foul): fixed in p54 by resting it on
   his upper arm, except in `-F13`, which stays on the shoulder tops. With the arm aim there the rusher's first
   re-punch overpowers the blocker, who falls at 5.7 s; a twin from 4.95 s shows the fall follows the state
   reached by then, not the arm push after it. So: an existing overpower mechanism reached by a moved trajectory.
   Owed: a capture-based test of that state and its own fix step, then `-F13` onto the arms.
3. Hands that come off past reach and never return: `-F11`'s beaten inside man; `-F12` above rusher effort 0.55
   (the outside man's longer arms hold the other's chest out of reach). The hold does not change it (p53).
4. `-F3`/`-F4` on the newer set: a steady 2.4 m drive with no anchor (parked, p49; the contest has no time
   structure).
5. `-F2`: the set man's arms fold at the hit and stay folded as a frame; the chests touch from 1.90 s. No re-arm
   from folded arms.
6. The offense three-point's knees 8.8 cm inside his ankles, and his hip 31 deg past its range at the snap; the
   two-point's knees 7.2 cm inside the toes.
7. Palms and the swiping hand into the other man's arm: up to 4 cm for 3 frames per swipe, up to 3.7 cm on landing;
   the re-punching forearm meets his up to 6 cm for 1-2 frames (arms do not collide with arms).
8. A hold has no look of its own (the hand cannot grip); the offense's re-punch, first of an exchange, lands high
   and wide by the inside of the shoulder and holds only when its push settles (p53).
9. Men set from the reset step 2-4 times in the first 1.5 s (`-F9`).
10. With the L3 rules on, `progressStopped` would end a block 0.7 s after contact, and `Role` is `runner | defender`
    with `runner` implying the ball. Both wait until blocking meets a ball carrier.

**History.** The lists below are from 2026-11-17/18. Most are fixed or superseded: forearms crossing (lanes, p45),
`-F8`'s run-back and fall (p48), the force contest (p37), the toe stance (p34-p39). Not rechecked since: the
closing-speed cap's missing test (6), the staggered start's foot slide (6), the drawn palm off the chest (7).

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
- Full checks p34-p54 (main checkout): `.scratch/pNN/`, each step's dirs named in its entry above; latest baseline
  `.scratch/p54/b-flip`. Parked patches: `.scratch/p36/parked/`, `p40/parked/`, `p48/parked/d-knee-out/`
  (superseded by p49's toe-out), `p49/parked/c-mismatch/`, `p52/parked/part1/` (evidence only).
- Main checkout `.scratch` was 219 MB after pruning plan 15's check results; prune p33-p45 check dirs once p50 is
  accepted (keep the latest baseline and parked patches).
