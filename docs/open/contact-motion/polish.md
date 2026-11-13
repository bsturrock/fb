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
   `.scratch/p4/gallop.ts`, main checkout `.scratch/p4/gallop/`. Queued after the low strike.
3. **Brace amount.** A bit more forward lean and crouch. `L3-F2-miss` shows no brace at all: check whether that is
   intended (never a real threat) or a decision bug.
4. **Falls.** The reaching arm palm down with give, some body control ("falls like a bag of wooden blocks"); the
   tackler's legs bounce backwards on contact (`HC-F3-lowRunner`); elbow give on landing (`LANDING_ELBOW_SNAP`);
   the bounce off a trapped arm (`LANDING_REBOUND`). The palm touches but does not plant.
5. **Whiff.** On a miss the swinging arms rotate the tackler (`L3-F19-miss`); a real tackler may reach and fall.

Accepted by the user, not to be worked: crossed legs in a fall, the carrier's arms folding into his trunk on
landing, the carrier's arm into the tackler (`HC-F1-mirror`), the who-falls changes of M2 to M4.

After the list: the debt in the README's direction item 5 (parked flags flipped or deleted, old families retire).
