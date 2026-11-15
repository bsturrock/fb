# Contact motion polish (after the rough whole tackle)

The rough slices of M2, M3 and M4 are on for L3, L4 and HC (handoffs: [M2](../../handoff/contact-motion-m2.md),
[M3](../../handoff/contact-motion-m3.md), [M4](../../handoff/contact-motion-m4.md)). The user reviewed them in the lab
on 2026-11-13; this list came from that review. **The tackle and fall polish is done and parked** (user, 2026-11-15:
leave the tackler where it is, come back to polish later). What it built, the owner's rulings, the tracked defects and
the parked list (each with where its patch and evidence are) are in the
[polish handoff](../../handoff/contact-motion-polish.md). What stays open here is the footwork under contact, the next
area.

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

Wraps and hits are different tackles (user, 2026-11-14): the full-sprint crossing tackles are hits (handoff).

## Open: footwork under contact (next)

The plan for this will live in `docs/open/15_Contact_Footwork.md`: one model for contact stepping that replaces the
planner's trigger, guard and patch rules it covers. The footwork planner (`src/sim/footwork.ts`) knows no other bodies;
the leg guard in the pose fixes a leg afterwards. Known faults:

- **Gallop.** A step squeezed into less time than its acceleration needs runs out of time and cannot land at running
  speed: its destination is re-picked against the moving hip every 50 ms (`footwork.ts:1375-1394`) and the touchdown
  test compares the last pose's ankle with the new target (`1474-1494`). The foot skims for 0.5 to 1.2 s while the
  other foot does every stance alone, with drag steps: the carrier under the brace (`L3-F3-collision` 0.45-1.35 s),
  the carrier after a hit he survives (`L3-F7-loadRelease` 0.45-0.9 s), the tackler's drive (`L3-F19-rear`
  1.09-1.84 s). `compose.lateLanding` (`dea9d82`, flag off, lab `latestep=on`) fixes the squeezed step only (a late
  step lands at a point fixed on the turf, and the destination is set before `fitStance`, `1152-1164`, so the
  acceleration floor applies); flipped as it is, the braced carrier's trailing hip over-extends 39 deg for 0.6 s and
  two snaps appear.
- **Stranded swing leg.** At the switch from clip to contact a foot 0.48 m up gets 0.58 s to come down and so aims
  under the hip predicted about 3 m ahead (`L3-F3-collision` R at 0.60 s); it trails, over-extending the hip.
- **Step aimed past or into a blocker.** That destination lies past the man in the hip's path, or inside his body; the
  leg guard holds the leg off him and the planner re-aims into him.
- **No foot down after impact** for about 0.5 s: in the fast falls and the drive no foot plants after the hit, so the
  player hangs on one leg and a tackler converts high.
- **A 2 m step while leaning.** Under the unaimed hit (`wrap=v12`) the runner took a 1.9-2.3 m stride at 18-25 deg of
  lean instead of going down; the aim removed it on the five hit fixtures, the mechanism (a step far past what the lean
  can recover) is still there.

Tried and parked: four rules inside `lateLanding` (a destination never inside another body, a held-off leg that comes
down under the hip, a planted foot released before the hip passes its range, a faster descent), each helping one scene
and worsening another; patch and isolation table in main checkout `.scratch/p7/parked/README.txt`
(`steps-around-a-body.patch`). Evidence: main checkout `.scratch/p4/gallop/`, `.scratch/p7/gallop-fix/summary.txt`,
`.scratch/p7/around/`. Probes: worktree `.scratch/p4/gallop.ts`, `.scratch/p7/gallop.ts`, `rows.ts`, `around.ts`.

After footwork: the parked tackle list (handoff), then the debt in the README's direction item 5 (parked flags
flipped or deleted, old families retire).
