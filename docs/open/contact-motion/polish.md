# Contact motion polish (after the rough whole tackle)

The rough slices of M2, M3 and M4 are on for L3, L4 and HC (handoffs: [M2](../../handoff/contact-motion-m2.md),
[M3](../../handoff/contact-motion-m3.md), [M4](../../handoff/contact-motion-m4.md)). The user reviewed them in the lab
on 2026-11-13. This is the ordered list that review produced. Work it top down, one item per step, same rules as
before (flag off, then flip, visible bar, lab look).

## The user's reference for a tackle

"Hit, wrap, roll" (Hawk tackling). The user's words: the tackler is "more leaned forward, head/shoulder down and
forward, arms wide and out, driving through the runner. Like think bear hug for initial wrap". "Tackler won't let go
in real life."

- **Entry (all tackles):** track the carrier's near hip; last step lands the near foot close to him; trunk low and
  pitched well forward; head to the side of the carrier, never across his front; the shoulder is the strike point;
  arms thrown wide from the shoulders, then wrap and squeeze.
- **High hit (near jersey number): wrap and drive.** Shoulder into chest or ribs, wrap, legs keep driving through
  the carrier until he goes down.
- **Low hit (thighs): hit, wrap, roll.** Shoulder into the thighs, wrap the legs, squeeze, then the tackler rolls
  his own body; the roll's torque takes the carrier down. He does not release.

## Next steps (2026-11-13, after the user's look at the ride-down and the bound-legs fall)

On for L3, L4 and HC: `WRAP_V8` (strike, drive, ride-down, bound-legs fall). Flag off: `WRAP_V6` (low tackle, on
V8), `compose.lateLanding`. The user's review: the front ride-down looks good; the drag mirror looks better; the
rear wrap and the drag (`L3-F5-drag`, to confirm which scene he meant by "the side one") need more oomph from the
tackler, and in the drag the tackler lands underneath the carrier, which is unlikely; the side wrap
(`L3-F4-twoArm`) looks ok but reads as a hit, not a wrap; the low rear wrap (`&wrap=v6`) does not look good: from
behind it should read as a drag-down, the tackler holding on with his own legs dragging, not the carrier trying
to keep stepping while wrapped. Direction is ours. In order:

1. **A hold that holds.** The tackler keeps a real, breakable grip on the carrier through his own conversion and
   the landing (today his ragdoll hold is a 100 N press that lasts about 0.1 s). This is what keeps him on his
   man, and it is the base for the drag-down, the lock and the roll. Flag off, then flip.
   Built flag off (`d10605e`; `WRAP_V9` = V8 plus `fallLink`, lab `&wrap=v9`, no fixture uses it): at his switch
   each clamp becomes a tension-only spring link from his forearm to the patch it held (10 kN/m, 150 N s/m, breaks
   on overload under the 700 N arm and 1000 N owner ceilings, on 0.25 m of stretch, out of reach, target gone; not
   at the whistle; `tests/fall-link.test.ts`). It forms in 2 of 10 evidence runs only (drag: both arms held to the
   end, he rests 0.76 m from the carrier instead of 0.89; front: one arm 0.47 s, then overload): elsewhere the
   whistle comes 0.08 to 0.19 s before his switch and ends his clamps and ride hold, so he has nothing to carry.
   Through the whistle, still flag off (`02a45de`; `fallLink.throughEnding`, `onArm`): a riding tackler's clamps
   and ride patches outlive the referee's ending until his own switch (nothing new is acquired after it), and the
   link's end sits on his arm's surface, the gap taken in as slack. The link now forms in 6 of 10 runs: rear wrap
   and drag mirror keep one hand on through the fall; the fast falls (side wrap, low runner, `L3-F1-low`,
   `L4-F10`) still lose the carrier out of reach 0.05 s before his switch. He does not end on top: rear wrap 0.99 m
   from the carrier (0.67 before), a hold at arm's length; that is for item 2 and the drag-down. Open for the
   flip: the drag's hand may hover 11 to 15 cm off the carrier under the slack.
   Thigh rotation bound on for L3, L4 and HC (`9c6319e`, `JOINT_RANGE_V3`): V9's longer ride reached the knee
   turned back (`CLEARANCE_KNEE_TURNS_BACK`) a third time; the old park reason (a thigh in a shoe) no longer
   occurs, and pose comes first. Posed impossible-joint time HC 4.08 to 0.05 s, L3 1.25 to 0.77 s. Who falls: a
   player who stood now goes down in `HC-F2-lowCarrier` (B), `HC-F3-phase50` rev, `HC-F3-phase75`, `L3-F1-phase4`,
   `L3-F1-phase6` (D), all reached. Tracked: `ARM_HELD_IN_HEAD` on `HC-F2-lowCarrier` (`tests/thigh-defects.test.ts`;
   its fix is the born separation). Not twinned: two carry-forearm pinches (84 and 60 J, looks like `CARRY_PINCH`);
   two runs over 4000 shape queries a tick.
   **On for L3, L4 and HC** (`f3eb1bd`, `c37496c`; lab `&wrap=v8` is before). The first flip try held a carrier's
   arm, born inside the tackler's torso at a double switch, in him for 0.5 to 0.8 s (`HC-F1-low`, `HC-F1-at1.6`).
   Rule added (`bornYield`): the link gives way (no pull, its length let out, still alive) to born pairs between
   the two players that begin at or after the link does; pairs older than the link it pulls through (the drag
   needs that). Who falls: unchanged everywhere; the tackler's switch is 0.02 to 0.17 s later. What changed: the
   drag keeps both arms on the carrier to the end; rear wrap, drag mirror one hand; front one arm 0.44 s.
   Accepted, to show the user: the linked upper arm sinks into the tackler's own chest (`L4-F5-twoClamp-off`
   11.75 cm past idle for about 1 s, caused by the link; also `L4-F5-twoClamp-on` rev, `HC-F1-at0.9`), at the level
   of own-arm overlap already in the baseline; the reversed rear wrap rests with both arms straight, one
   overhead, 1.38 m from the carrier; the drag's forearm ends trapped under the carrier's arm.
   Evidence: main checkout `.scratch/p11/hold/`, `whistle/`, `thigh/`, `hold-on2/summary.txt`.
2. **More oomph, and who ends on top.** Measure what the tackler puts into the carrier on the rear wrap and the
   drag (speed and mass behind the shoulder at contact, drive force and how long it acts, the carrier's speed
   change), find why the drag's tackler ends underneath, then raise what is low. No energy from nowhere.
   **User, 2026-11-14, after the look at the hold (all else "good to continue"):** the tackle from behind pushes
   the runner and speeds him up too much; it should lead to a tackle quicker, or to a failed tackle. Cause: the
   drive asks for the carrier's velocity plus `extraMps` along the line through him, which from behind is his own
   direction of travel (rear wrap: carried 6.9 m, down after about 1.9 s). So from behind "oomph" is not a push:
   the tackler is an anchor. Rule being built (`drive.behind`, `WRAP_V10`, flag off first): while the line through
   the carrier lies along his travel the tackler never asks for more than the carrier's speed along it; he sits
   back against the hold, and after a short time on a carrier still up he commits his weight to the hold (leaves
   his feet holding on, legs dragging, the fall link of item 1 carrying it). The outcome is the physics': the
   carrier goes down (bound legs, his balance) or the hold breaks under its ceilings and he runs on. The push
   stays for the front and the side. This is item 3's drag-down at torso height.
   Built flag off (`WRAP_V10` = V9 plus `drive.behind`, lab `&wrap=v10`, no fixture uses it; `tests/wrap-behind.test.ts`):
   from behind (decided as the drive begins: carrier up, 1 m/s or more, line within 60 deg of his travel) every
   request of the drive is his velocity less 2 m/s along it, and the tackler commits his weight at once (exit r,
   `commitS` 0). Why at once: a supported tackler's clamps press and cannot pull, so sitting back loses them in 0.1 to
   0.15 s; the anchor alone leaves the carrier up and carried 15 m, a commit at 0.15 s or later has no hold left to
   carry. Rear wrap, from the secure hold: V9 +0.28 m/s over his speed, down after 1.13 / 1.18 s and 5.4 / 5.6 m; V10
   +0.03 / +0.02, down after 0.88 / 0.75 s and 3.6 / 3.0 m, backward (his own balance), the tackler on the fall link
   1.0 to 1.2 m behind. The drag never satisfies the test. Open for the flip: the carrier goes down backward, not forward;
   the drag mirror's line starts 68 deg off his travel and swings onto it, so it still pushes (+0.42 m/s).
   **On** (the behind flip: every L3, L4 and HC wrap fixture runs `WRAP_V10`; lab `&wrap=v9` is the view before,
   `tests/runs.ts` `preWrapV10`). Only the rear wrap changed, both orders: the tackler leaves his feet at 0.74 s (was
   2.4), the runner is down at 1.62 / 1.48 s (was 1.87 / 1.91), the same players fall; the other 52 wrap fixtures run
   identically (their traces differ only in the exported profile). Trend only, no tracked defect: the tackler's palm
   in his own thigh 11-14 cm (V9 12.5), the runner's ragdoll shoulder rotation 70.9 deg for 0.12 s rev (V9 56.9 fwd).
   Open: the runner falls backward; the drag mirror still pushes; the tackler leaves his feet the moment the wrap closes.
   **User, 2026-11-14, on the V10 rear wrap: "doesn't look good".** The tackler goes limp the moment the wrap
   closes, slides down the runner's back to the ground and hangs from one straight arm at full reach; the runner
   stands, then is pulled over backward. The instant weight commit is wrong at torso height (a ragdoll has no
   legs under him and no squeeze; the link is a straight line). Replacement, "ride his back" (`WRAP_V11`, flag
   off first): from behind he stays posed and tight on the runner's back at the runner's speed (no brake, no
   extra, no commit), `ride` on, and sags his weight onto him (stance and hinge drop; the clamps' friction and
   his chest carry it). A supported runner's legs never give under load (the suspension holds 3.5 body weights;
   a loss is lean or bound legs only), so a third bound-legs clause: a runner carrying a secure holder's weight
   from behind for a short time goes down, leaning forward; the ride-down then brings the tackler down on him.
   The hold lost before that is a failed tackle. The low hold keeps the hang (item 3): there it is the drag-down.
   Two tries parked (main checkout `.scratch/p14/parked/`, its README): the sag with a measured load (`back.patch`): a
   supported clamp from behind re-forms every substep, so its friction carries 5 to 30 N, and the sag puts his shoulders
   under the runner and lifts him; (c) on the strict secure test (`back2.patch`): both arms read on after the solve in 11
   of about 480 substeps, the clock 0.15 s at most. Both need a pinned hold on a supported carrier first.
   Built flag off (`WRAP_V11` = V10 with no brake and no commit from behind plus `bind.behind`, lab `&wrap=v11`, no fixture
   uses it; `tests/wrap-stay-on.test.ts`): from behind he stays posed in the strike at the runner's velocity, riding. Clause
   (c) binds a runner whose tackler's drive from behind is alive (`PlayerIntent.behind`; the drive begins only on a secure
   hold) with an arm's clamp or grip on him after the solve for 0.25 s, grace 0.05 (that reading lasts 0.34 to 0.36 s on the
   rear wrap); the drive ended or no arm on him binds nothing, and he runs on. Rear wrap, from the secure hold, fwd / rev:
   +0.02 m/s (V9 +0.28), bound after 0.26 s and 1.2 m, falls forward (V10 backward); the tackler rides down to the come-down,
   chest 0.55 m, shoulders 0.84 / 0.83 at his switch 0.66 s after the hold (V9 0.75 / 0.70). The other 104 wrap runs: as V10.
   Open for the flip: the tackler lands 0.8 to 1.1 m to the runner's side, no link alive; the drag mirror still pushes (its
   behind test fails as its drive begins); from behind the finish mode alternates reposition and contact every substep.
   **On for L3, L4 and HC** (`WRAP_V11`, lab `&wrap=v10` is before; only `L3-F19-rear` changes): from behind the tackler
   stays on the runner's back, the runner goes down forward first (V10: pulled over backward), and the tackler lets go
   with an arm the runner falls away from (`letGoM` 0.35 m past his shoulders, not overhead) and goes down after him.
   **Closed for now by the user** (2026-11-14: a tackle from behind will be rare in the game). Debt: the tackler ends 0.8
   to 1.1 m to the side with no hold alive; the drag mirror still pushes; real weight on the runner needs a pinned hold on
   a supported carrier (patches in `.scratch/p14/parked/`); the low rear drag-down (`WRAP_V6`) stays flag off.
3. **The low rear tackle as a drag-down.** With a secure low hold from behind the tackler commits his weight and
   lets his legs drag while holding on; the carrier's legs are bound and he goes down forward. Needs 1. The
   parked posed dive is the general form if a supported tackler cannot do it.
   Built flag off (`WRAP_V6` = the low strike on V10, lab `&wrap=v6`; before it `tests/runs.ts` `WRAP_V6_PRE_V10`;
   `tests/wrap-drag.test.ts`): a holder off his feet binds by clause (a) while 2 live fall links hold the carrier below
   his pelvis centre for 0.05 s (`WrapBind.linked`; 0.075 s or more and the registered rear goes down sideways or kneels).
   Low rear, registered fwd / rev / 2 m longer: V6 on V8 bound at +0.15 s, sideways; respread on V10 without the rule the
   tackler hangs on two links but the carrier steps on (down after 1.55 / 1.62 s, the long one never); now he is bound
   0.05 s after the tackler leaves his feet, +0.03 m/s, no plant, core under 0.5 m after 0.32-0.37 s and 1.6-1.8 m,
   forward, the tackler 0.7-0.8 m behind on live links (two, two, one). Front, side, drag runs identical. Open for the
   flip: from 2 m back reversed he commits with one clamp (one link: runs on); the tackler ends at arm's length.
4. **The side wrap reads as a wrap.** The arms close round the carrier and stay on him through the fall instead
   of a hit and a release; needs 1, and the narrow footwork step (item 2 of the order below) so the tackler is
   not cut loose high in the fast falls.
   **Measured, and replaced by the hit (user, 2026-11-14).** Evidence: main checkout `.scratch/p15/side/summary.txt`.
   The five fast-fall fixtures (`L3-F4-twoArm`, `L4-F10-wrap-on`, `L3-F1-low`, `HC-F3-lowRunner`, `HC-F3-phase0`)
   are one tackle: the tackler arrives at about 7 m/s closing across the runner; the hit fells the runner 0.10 s
   after contact, the first forearm clamp forms at 0.15 to 0.17 s, there is never a hold before he goes; the
   tackler loses his one clamp, turns ragdoll upright holding nothing and ends beside him. His head goes across
   the runner's front (`wrap.ts` side rule: on a collision course the motion across the approach is under
   `sideRuleMps` and the fallback offset is 0 by construction, so the default side is taken). A cap on his
   closing speed (a "gather") gives the wrap picture and was rejected by the user: never slow a tackler to make
   a fixture read as a wrap. His ruling: **wraps and hits are different tackles.** A hit is a violent shoulder
   collision: no arms coming out to wrap, more a collision than a wrap and fall; the tackler does not have to go
   down but can. So the tackle's kind is decided as the strike starts (a request from above when given, else by
   closing speed) and a hit gets its own form: the shoulder leads with the head to the side away from the
   runner's front, the arms tucked, no clamp, drive hold, ride or link; he runs through the contact at his own
   speed and falls only by his own balance. `WRAP_V12`, flag off first; its flip makes these five fixtures hits.
5. Then the rest of the order below: the low tackle's flip on long-approach fixtures (side offset out before the
   carrier goes down, a secure hold on the long front approach, the posed hip twist), the hand lock, a sideways
   roll with the carrier, brace amount, falls, whiff, debt.

## Order

1. **Real tackle form.**
   1. **Done** (`cd4d92e`, M3 handoff "The strike"). Strike posture and wide arms: the tackler leans in, shoulder
      leads with the head to the side, arms open wide from the shoulders (was: upright trunk, hands at elbow width,
      "robotic").
   2. **Done** (`48c9403`, M3 handoff "The drive"). Drive: with the wrap on, the tackler keeps his legs driving
      through the carrier and goes down with him, instead of lowering and going limp. Covers the user's notes on the front wrap, the drag tackle
      (`L3-F5-drag`: he falls on top) and the side wrap (`L3-F4-twoArm`).
      **User review 2026-11-13 of the strike and the drive: "good foundation"; next, the ride-down.** The tackler
      must stay engaged longer, secure the wrap, drive more, and not become a ragdoll until he is close to the
      ground. Today he leaves his feet nearly upright: when the carrier leans 30 degrees (front, rear), at once when
      the carrier is already falling (side), or when his own balance check trips (drag), which ignores that he
      leans on the carrier. The ride-down: he stays supported through the takedown, feet driving without easing
      off, trunk following the carrier down on the hinge, hips sinking; he converts when his chest is within about
      0.5 m of the ground, the carrier is flat, or the hold is lost and he is truly falling. Before the low tackle.
      Built flag off (`e478bb8`, `eadf8fc`; `WRAP_V7` = V5 plus `ride`, lab `&wrap=v7`, no fixture uses it). He
      converts on: chest 0.5 m from the ground, sinking faster than 1.6 m/s, the carrier's core within 0.35 m of the
      ground, a stall or 2.5 s, the hold lost on a downed carrier, the referee's ending. His forearm hold is pinned
      to the carrier's ragdoll torso or pelvis through the carrier's fall (it lapsed in 0.03 to 0.08 s before: the
      ragdoll's own limbs cover his trunk, and the palm push-out lifts the forearm off every other substep). State:
      the rear wrap rides to chest 0.5 m; where the hit fells the carrier fast (side, `L3-F1-low`, HC-F3) he still
      converts at shoulder 1.25 m because the trunk follows too slowly (pitch lags the hinge request, 54 against 84
      degrees) and the play ends 0.2 s later. On his feet the lowest chest is 0.56 m.
      Since then (`5acbb9a`, `cd525bf`): the come-down. Once the carrier is converted he folds fully at ride-only
      hinge limits, keeps coming down after the carrier is down and after the whistle, and the fold arrives slowing
      down so he converts with little spin (the user saw a somersault over the carrier: the rigid proxy's spin
      handed to a folded ragdoll doubled its rate; 474 J at the switch, now 30 to 61 J, the rest being the
      centre-of-mass offset between proxy and ragdoll). Rear, front and drag-mirror wraps convert at shoulder 0.77
      to 0.91 m, no feet over head, ending beside or half on the carrier. Open before the flip: the fast falls
      still convert high because no foot plants after the impact (item 2's leg guard cause); he never lands
      squarely on the carrier; a posed hip turn 71 degrees past range on the reversed drag mirror just before his
      conversion; a possible 0.16 s pause posed over the downed carrier.
      **On for L3, L4 and HC** (`a5a9ece`; lab `&wrap=v5` is before). Who falls: the drag-mirror tackler now goes
      down in both orders and its carrier 0.3 s earlier; the tackler goes ragdoll 0.14 to 0.49 s later; four
      diagnostic fixtures reach their labelled switch instead of the takedown; `HC-F5-strictTransfer` flags the
      tackler's switch too (66 to 72 J against its 0 J allowance; the play was already an invalid transfer).
      Shoulder height at his conversion: rear 0.77 m, drag mirror 0.81 to 0.84, front 0.88 to 0.91; still 1.13 to
      1.28 m in the fast falls (side wrap, `L3-F1` phases, low runner, HC-F3, `L4-F10`). Tracked, reached not
      caused (`tests/ride-defects.test.ts`): `CLEARANCE_KNEE_TURNS_BACK` on `L3-F1-phase1` (posed knee turned
      back 0.15 s) and the reversed drag mirror (0.05 s); `OVERHEAD_TWIST_UNHELD` on `L3-F1-phase5` reversed. Not
      twinned: carrier shoulder twists on `L3-F1-phase5` forward, `L3-F19-front`, `HC-F3-phase0` reversed; an 82 J
      one-solve gain on the `L3-F1-phase1` carrier's forearm (looks like `CARRY_PINCH`).
      **User intent 2026-11-13 (standing): the ball carrier always biases forward and tries to fall forward** for
      the extra yards. An intention, not an outcome: a hard hit from the front can still put him on his back. It
      applies to the brace, to a held carrier on his feet (never settling leaning back), to the bound-legs fall
      below, and to the ragdoll's fall effort (within its joint limits, no external force).
      **User review of the low rear wrap (`L3-F19-rear&wrap=v6`): if his legs cannot run he falls, then, not
      later.** Today the wrapped carrier stays supported on legs that cannot step, leans back, kneels and falls
      late while the tackler slides off behind. Wanted: he goes down forward with the tackler landing on top of
      him, who then tries to roll him. Steps: a bound-legs rule (a secure hold at or below the pelvis, or his steps
      blocked by the holder for about 0.2 s, converts the carrier with his momentum); the low tackle rebuilt on the
      ride-down so the tackler keeps driving and comes down on him.
      **Bound-legs fall on for L3, L4 and HC** (`fc616d3` built, `082465a` on; `WRAP_V8` = V7 plus `bind`; lab
      `&wrap=v7` is before). A supported, secure holder (two arms, or one arm plus body) converts the carrier after
      0.2 s of either both holds below his pelvis centre, or a stranded foot with no new plant while he still
      leans 5 degrees or moves 0.5 m/s; his lean request points 12 degrees toward his travel meanwhile (it barely
      matters: momentum and the hold at his hips take him forward). Who falls: only `L3-F5-drag` (the carrier is
      bound at 0.69 s, goes down before the tackler, forward onto his side instead of onto his back). A braced
      carrier with no hold, a carrier surviving a hit and a miss are not felled. Tracked: `RAISED_ARM_TWIST` on
      `L3-F19-rear` (`tests/bind-defects.test.ts`). `WRAP_V6` (the low tackle) now sits on V8: on the low rear
      wrap the carrier goes down forward at the bind instead of late and backward. Open on the low tackle: the
      tackler ends 0.9 to 1.7 m beside or behind him, never on top (with one arm on he drops to the old one-arm
      reposition and the come-down starts late); a posed hip twist 37 degrees past range at his conversion; the
      long front approach never gets a secure hold.
      **The tackler landing on top: tried twice, parked** (main checkout `.scratch/p10/parked/`: `onto-v9.patch`,
      `onto-high.patch`, README with both tries; evidence `.scratch/p10/onto/`, `onto-high/`). Steering his
      shoulders onto the carrier's core from the carrier's conversion puts him on top on the rear wrap, the drag
      mirror and `L3-F1-low`, but no version passes alone. Found: a facing turn adds to posed hip twist; starting
      the come-down's clock early converts him high (1.10 m); the carrier's core drops from 5.5 to 2.7 m/s within
      0.05 s of landing while the posed tackler's drive sheds 3 to 4 m/s^2, so he arrives 1.4 m/s or more faster
      and slides past, and any brake strong enough loses the carrier 0.4 m earlier; on the low tackle his head
      and shoulder on the carrier's hip hold him off the centre line, so the side offset must come out before
      the carrier goes down. Decided: not a steering problem. What keeps a tackler on his man through the
      landing is the hold itself; take it up with the hold through the landing (the lock and the roll, 1.3 and
      1.4), not with more drive requests.
   3. Stay connected to the ground. Locked hands were measured impossible with today's upright wrap (the hands
      stop 0.5 m apart; M3 handoff, "Locked hands"). Re-measure after 1.1 puts the shoulder at the carrier's flank;
      build the lock if the hands then meet. The rear-wrap carrier (`L3-F19-rear`) must go down (under the drive he
      is driven over at 1.90 s).
      **Decided 2026-11-13: no hand lock at torso height.** Re-measured with the strike and the drive on: the hands
      stay 0.52 to 0.60 m apart in the hold (0.45 m side on), and a 2D model of the arm matches that within 3 cm,
      so the arms already deliver what the geometry allows. The taut path round the trunk is 0.90 m or more against
      a 0.70 m reach; a rounded trunk still leaves 0.30 m; the shoulder is a fixed point. The drive already takes
      the rear-wrap carrier down, which was this item's must-have. The lock moves to the low wrap (1.4), where the
      model says the hands meet (thighs at drawn size, or the standing carrier's support capsule). Numbers and
      probes: main checkout `.scratch/p3/hand-gap/`, worktree `.scratch/p1/handgap.ts`, `handgeo.ts`.
   4. Low hit: wrap the legs, lock the hands if they meet, and roll.
      **User ruling 2026-11-13: the deep crouch tackle first.** The tackler stays on his feet, trunk pitched about
      75 degrees at the lowest stance, shoulder into the carrier's hip or upper thigh (about 0.9 m), arms round him
      at pelvis height, hands locked, then he leaves his feet holding on and twists to bring him down. Steps: low
      strike flag off with a new two-arm low fixture (a variant of `L3-F19-front`), flip, lock, leave feet and twist.
      Sizing (code reading): on his feet the shoulder cannot go below 1.16 m at the 40 degree hinge cap and the
      0.72 m root floor, and a mid-thigh strike would need 95 degrees, so the hit is at the hip, not the thigh. Holds
      are eligible on torso, pelvis and the standing carrier's support capsule (radius 0.16, where the hands meet
      within 0.04 m), not on thighs. The ragdoll has no spine, so the twist comes from hips and shoulders at first.
      State (`f14f7f7`, `bad104d`; `WRAP_V6`, no fixture uses it, lab `&wrap=v6`): the low strike folds to 75
      degrees at the 0.72 m floor with the balance holding, shoulder into the hip at 0.83 m, head beside him. The
      fold needs 0.85 s, so it needs a longer approach than the registered wraps give (probe: defender 4 m further
      back in front, 2 m behind; worktree `.scratch/p5/`). The palms walk round the capsule but stop 0.35 m apart:
      the head rests on his pelvis and never gets past the hip, so the far shoulder stays 0.7 m from his axis. From
      the front the carrier's hit spins the folded tackler and one arm holds. Open before a flip: head past the hip
      and shoulders square (a parked square-up, main checkout `.scratch/p5/parked/`, turned the body but it circled
      him), and not being spun by the hit. The lock waits for that.
      **Back burner (user's idea): a posed dive.** The tackler launches and stays posed in the air with aimed arms,
      and becomes a ragdoll only at the ground or once the wrap is secure. Read as feasible without a rewrite: a
      new control mode with suspension, balance and the loss envelope off, legs body-relative and arms not
      `falling`; a ledgered launch force at the feet (no vertical channel exists today); a landing trigger that
      converts before a limb reaches the floor. Main risk: a snap or a lost hold at that conversion. Not built.
2. **Leg gallop.** The carrier's legs gallop under the brace (`L3-F3-collision`) and both legs gallop to catch up
   with the body after a hit he survives.
   Diagnosed 2026-11-13 (probe only): one mechanism in three places (the carrier under the brace `L3-F3-collision`
   0.45 to 1.35 s, the carrier after a hit `L3-F7-loadRelease` 0.45 to 0.9 s, the tackler's drive `L3-F19-rear`
   1.09 to 1.84 s). A planner step is squeezed to less time than its acceleration needs, runs out of time, and
   then cannot land at running speed: its destination is re-picked against the moving hip every 50 ms and the
   touchdown test compares the last pose's ankle with the new target (`src/sim/footwork.ts` about 1335-1348 and
   1434-1444). The foot skims for 0.5 to 1.2 s while the other foot does every stance alone, with drag steps.
   Fix, one compose flag, two steps: a late step fixes its destination in world space and is judged against the
   target its pose was given; a new step is never shorter than its acceleration floor (`fitStance` is called
   before the destination is set, about 1120-1126; inferred, not twin-tested). Probe and results: worktree
   `.scratch/p4/gallop.ts`, main checkout `.scratch/p4/gallop/`.
   Built flag off (`dea9d82`, `compose.lateLanding`, lab `&latestep=on`). It fixes the squeezed step only: the
   carrier after a hit runs an even stride. Under the brace, in the drive and in the ride-down the stranded leg
   has another cause: the step aims inside the other player's body, the leg guard holds the leg off him, and it
   re-aims into him. Not to be flipped as it is: with the flag on the braced carrier's trailing hip over-extends
   for 0.6 s (39 degrees past range) and two snaps appear. Next: a destination that is never inside another
   body, a held-off leg that lands under the hip, a planted foot released before the hip passes its range.
   Evidence: main checkout `.scratch/p7/gallop-fix/summary.txt`.
   That next step was tried and parked (main checkout `.scratch/p7/parked/`, patch and README): four rules, each
   helping one scene and worsening another. What it found: the over-extended hip is the stranded swing leg
   trailing, not a stance foot; the stranding starts at the switch from clip to contact, where a foot 0.48 m up
   gets 0.58 s to come down and so aims under the hip predicted 3 m ahead, past the man in its path. One narrow
   mechanism remains to try (a high foot whose hip path meets a body comes down first, in a normal step time,
   with the hip path stopped at the body; twin on a capture of `L3-F3-collision` at 0.60 s). Decided: no more
   footwork rounds before the bound-legs fall, which covers the carrier's case the way the user asked.
3. **Brace amount.** A bit more forward lean and crouch. `L3-F2-miss` shows no brace at all: check whether that is
   intended (never a real threat) or a decision bug.
4. **Falls.** The reaching arm palm down with give, some body control ("falls like a bag of wooden blocks"); the
   tackler's legs bounce backwards on contact (`HC-F3-lowRunner`); elbow give on landing (`LANDING_ELBOW_SNAP`);
   the bounce off a trapped arm (`LANDING_REBOUND`). The palm touches but does not plant.
5. **Whiff.** On a miss the swinging arms rotate the tackler (`L3-F19-miss`); a real tackler may reach and fall.

Accepted by the user, not to be worked: crossed legs in a fall, the carrier's arms folding into his trunk on
landing, the carrier's arm into the tackler (`HC-F1-mirror`), the who-falls changes of M2 to M4.

After the list: the debt in the README's direction item 5 (parked flags flipped or deleted, old families retire).
