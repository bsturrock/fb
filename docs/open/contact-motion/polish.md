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
2. **Leg gallop.** The carrier's legs gallop under the brace (`L3-F3-collision`) and both legs gallop to catch up
   with the body after a hit he survives.
3. **Brace amount.** A bit more forward lean and crouch. `L3-F2-miss` shows no brace at all: check whether that is
   intended (never a real threat) or a decision bug.
4. **Falls.** The reaching arm palm down with give, some body control ("falls like a bag of wooden blocks"); the
   tackler's legs bounce backwards on contact (`HC-F3-lowRunner`); elbow give on landing (`LANDING_ELBOW_SNAP`);
   the bounce off a trapped arm (`LANDING_REBOUND`). The palm touches but does not plant.
5. **Whiff.** On a miss the swinging arms rotate the tackler (`L3-F19-miss`); a real tackler may reach and fall.

Accepted by the user, not to be worked: crossed legs in a fall, the carrier's arms folding into his trunk on
landing, the carrier's arm into the tackler (`HC-F1-mirror`), the who-falls changes of M2 to M4.

After the list: the debt in the README's direction item 5 (parked flags flipped or deleted, old families retire).
