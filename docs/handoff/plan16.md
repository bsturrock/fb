# Plan 16 handoff: blocking, the rough first slice (in progress)

Plan: `docs/open/16_Blocking.md` (what is left). Branches `prereq-ladder` and `model-integration`, both pushed.
State on 2026-11-17: the palm push, the block controller with its engaged state, the `BL` scenes and the base
(standing against a hard push from the planted feet) are in; the user has had a first lab look ("as a start this looks
ok"; the picture of a block that came from it is at the top of the plan). The punch as a strike is next. 596/596
tests; the 414 earlier fixtures' summaries and traces are byte-identical to before the plan. Current full-check
baseline: main checkout `.scratch/p32/resist`.

## To resume

1. Build the punch (plan, "Left", item 2), flag off then on for `BL`, full check against `.scratch/p32/resist`.
2. Then the user's lab look at base and punch together; ask for the path of the blocking animations being prepared.
3. One builder at a time in the worktree `/Users/brandon/.claude-wt/football-sim-7-ladder`; check results in the main
   checkout's `.scratch/p33/` onward. The lab on port 5180 runs from the worktree and picks up commits on reload.

Lab (`cam=front` is the profile view of two men facing each other; `cam=side` shows a back):

- `?fixture=BL-F1-even&cam=front&speed=0.25&t=0.5` punch and hold
- `?fixture=BL-F2-walkIn&cam=front&speed=0.25&t=1.2` walk in and engage
- `?fixture=BL-F3-blockerDrives&cam=front&speed=0.25&t=4` the drive
- `?fixture=BL-F5-offCentre&cam=front&speed=0.25&t=4` off centre
- `?fixture=BL-F7-hard&cam=front&speed=0.25&t=0.6` the pushed man steps a foot back and braces, then holds (`t=3`)
- `?fixture=BL-F8-hardNoHinge&cam=front&speed=0.25&t=1.5` the pushed man is overpowered in his step back and falls;
  the other now stays up (before the base both fell)

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

**What a viewer sees.** Hands on in about 0.5 s; the men square, hips back, knees bent, chests 0.66-0.70 m apart, for
the whole scene; the stronger man drives the other back about 2 m at 0.24 m/s in short steps with no gallop; the man
walking in brakes and engages without a chest bump.

## Tracked defects (polish order by look)

1. Forearm through forearm, 8-9 cm, sustained in every scene. Under/over hands cut it from 12 cm; arms avoid bodies,
   not other arms. Named on `BLOCK_V1_HANDS`.
2. The crouch is deep and A-framed. Waits for the user's animations.
3. The brace: the rear foot lands on its toe with the heel about 22 cm up, and the step back is the weak moment (no
   base behind him while the foot is in the air; `-F7` dips and gives a little ground, harder pushes fell him there).
   Placing the foot by its toe would give a longer base. A quicker or earlier step is the other lever.
4. `-F8`: the man left standing steps onto the fallen one, foot up to 3.4 cm inside him for about 0.5 s, left foot
   stepping twice. The stepping model's existing exception for a foot planted in another player; his block has ended
   by then. (The old "both feet off the ground 0.18-0.23 s" in `-F3`, `-F4` measured drawn ankle height, which the
   crouch's heel lift inflates; with both soles more than 2 cm up it is 0 s.)
5. `-F8`: the fallen man's upper arm 11.4 cm in his own trunk from 2.65 s, and one substep each way over the power
   ceiling in his fall (165 W against 135 W predicted): the two new L4 matrix entries (12 over the ceiling, 10 before).
6. A starting stance with a stagger (`initial.stance.staggerM`) slides the planted foot 5.8 cm at scene start. The BL
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
  with their `.compare.txt` (the base).
- Probes and stills (worktree): `.scratch/p29/` (before), `.scratch/p30/` (palm push in the probe scenes),
  `.scratch/p31/` (BL), `.scratch/p32/` (the base; `stills/`, and `lab/vite.probe.config.ts` for the harder-push and
  feet-together scenes). Unregistered scenes can be viewed with `.scratch/p29/vite.probe.config.ts` and `stills.mjs`.
- Main checkout `.scratch` is 219 MB after pruning plan 15's check results; what is left is from plans before 15.
