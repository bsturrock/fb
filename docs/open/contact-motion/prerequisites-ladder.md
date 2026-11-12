# Contact-motion prerequisites: ladder re-land

Status: active (2026-11-12). Replaces the stacked "s10..s17" candidate.

## Why

The prerequisite work before M2 sat as ~3,350 uncommitted lines of interleaved changes on top of M1 (`a6d712f`). Over
17 rounds it did not converge: there was no committed baseline to compare against, the changes could not be judged or
bisected apart, and each fix moved chaotic fixture trajectories so that a different fixture crossed a threshold.

The stack is preserved, not continued: `.scratch/cmp-evidence/s17/` holds `main-tree-2026-11-11.patch` (the whole
uncommitted diff), the untracked files, and the s17 patches (`b`, `query`, `arm`, `palm`, `j1-1000-3`).

## Rules

1. Work happens on branch `prereq-ladder`, cut from `a6d712f`, in its own worktree. The old working tree is reference
   only.
2. One rung = one reviewable change = one commit. A rung lands only after the full check passes against the previous
   rung.
3. **Full check** (`scripts/check/`, landed in rung 0): suite failures compared by message, fixture summaries, leg
   matrix, L4 matrix. Results are stored per rung so any later rung can be diffed against any earlier one.
4. Code lands behind its profile flag first, with fixture summaries byte-identical. Turning a flag on for fixtures is its
   own rung, so behaviour change is judged alone.
5. G, L1, L2 and RH summaries stay byte-identical on every rung.
6. A rung that cannot go green alone is parked with its evidence, not carried forward.
7. **Trajectory-shift rule.** A breach of an existing limit blocks a rung only if the rung introduces the mechanism, or
   worsens it in a controlled twin (same state, the change on and off). A breach whose mechanism already exists and is
   merely reached by a moved trajectory becomes a deterministic regression test (seeded state) plus a tracked defect
   with its own fix rung. Limits are never raised and expectations are never re-pinned to pass.
8. No experiment hooks land (`D1_OFF`, `D1_NOSTOP`, `D2_OFF`, `D3_OFF`, `SELFTRADE`, `ARMDBG`).

## Rungs

| # | Rung | Expected effect on fixture summaries |
| --- | --- | --- |
| 0 | Check tooling in `scripts/check/` and the baseline at `a6d712f` | none |
| 1 | Per-build contact-query memo (`query.patch`, adapted) | byte-identical |
| 2 | Test hooks and independent negative controls (`releasePlantAt`, `ownerChangeJumpM`, pulled-forearm control) | byte-identical |
| 3 | Arm-task twist anchor: once per substep, no widening past the rate window | L3/L4/HC change |
| 4 | Impact guard: joint residual (head-plant seed test), then manifold points (core-rock seed test), then carried impacts with a dedicated test | L4 change, one sub-rung each |
| 5 | Leg sweep and alternate placements behind `LEG_GUARD_V2`, no fixture uses it | byte-identical |
| 6 | Physical supported legs behind `LEG_GUARD_V3` in the s17 form (surface-advance speeds, single ledger), with unit tests for the floor-backed launch and grounded-only rules | byte-identical |
| 7 | Planted primary pose, knee-pole-first | byte-identical while unflipped |
| 8 | Turn `LEG_GUARD_V3` on for L3, L4, HC (split by family if that isolates failures) | the judged rung |
| 9 | Arm overhead-twist singularity and palm continuity (the sound parts of `arm.patch`) | L3/L4/HC change |

## Primary measure: visible quality

The full check's visible-quality matrix (rung 8c; `scripts/check/README.md`, Visible quality) is the ladder's primary
measure: what the owner sees. Player-seconds over every L3/L4/HC fixture, both orders, first measured (8c, the tree
after rungs 1-7) and now (10e, `r10e-exceptions`):

| family | ragImpS | ragImplS | supImpS | ragSelfLegAxS | ragSelfDeepS | supSelfLegAxS | kneeStopS | ragSnap60 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L3 | 157.9 -> 0.8 | 235.5 -> 3.6 | 1.0 -> 1.0 | 100.9 -> 2.3 | 284.7 -> 89.0 | 9.3 -> 12.8 | 16.4 -> 0 | 1 -> 0 |
| L4 | 0.9 -> 1.5 | 188.0 -> 3.4 | 0.5 -> 0 | 254.2 -> 21.7 | 416.3 -> 44.4 | 3.1 -> 2.0 | 103.3 -> 0 | 4 -> 0 |
| HC | 99.9 -> 2.5 | 157.7 -> 4.5 | 4.4 -> 4.2 | 63.2 -> 3.4 | 184.3 -> 40.3 | 6.7 -> 6.5 | 7.8 -> 0 | 0 -> 0 |

Ragdoll s now L3 154.9, L4 389.1, HC 93.6. Impossible time was almost all L3/HC hips with no limit (the hip stops,
8m); knee time past 150 mostly L4 (the knee stop, 8m). Deep own-body overlap left is mostly arms on the trunk (108 of
the 174 s); legs on legs 313 -> 20 (own-leg contact, 9d). supSelfLegAxS L3 rises with V2's sweep paths (10a). Passive
energy (7g, the same at 8c): L3 1150 -> 804 J (largest 128 -> 48), L4 2907 -> 531 (122 -> 58), HC 949 -> 423 (197 ->
48).

## Morning review for the user

What each step changed that is worth watching, newest last. Every link is a lab URL (`npm run dev` on this branch). The
link as given is the current tip; the parameters below show a moment as an earlier step left it. Speed 0.25 in all of
them.

| to see a moment as | add to the link |
| --- | --- |
| before 8m (the registration up to 8k) | `&legs=v1&selfleg=off&hips=off&pgs=0&knees=off&retry=off` |
| 8m left it | `&legs=v1&selfleg=off` |
| 9d left it (through 10b) | `&legs=v1` |
| now (10d; nothing visible changed since) | nothing |

### Who falls now, against the ladder's start (the net list to review)

Several steps changed who falls and some undid each other; this is what is left. The start is the registration the
ladder began from (`a6d712f`, `r0-baseline`); "changed at" is the step that made the change (each step's own list is in
its section below). The lab cannot show the start itself (rungs 3 to 7c are not lab parameters): the earliest view is
"before 8m" above. Who ends a rigid falling figure (a rejected conversion) is unchanged: only the three fixtures built to
be rejected, as at the start (at the start known for the forward order).

| fixture | order | player | at the start | now | changed at | lab (now) |
| --- | --- | --- | --- | --- | --- | --- |
| HC-F3-mirror | reversed | defender | stays up | falls 1.75 s | 3 | `?fixture=HC-F3-mirror&order=rev&cam=front&speed=0.25&t=1.60` |
| HC-F3-phase0 | forward | defender | falls 1.18 s | stays up | 8m | `?fixture=HC-F3-phase0&cam=front&speed=0.25&t=1.05` |
| L3-F1-low | both | defender | falls 1.70 / 1.65 s | stays up | 3 (forward), 9d (reversed) | `?fixture=L3-F1-low&cam=front&speed=0.25&t=1.55` |
| L3-F1-mirror0 | both | defender | stays up | falls 1.39 / 1.45 s | 8m | `?fixture=L3-F1-mirror0&cam=front&speed=0.25&t=1.25` |
| L3-F1-mirror4 | reversed | defender | stays up | falls 1.50 s | 8m | `?fixture=L3-F1-mirror4&order=rev&cam=front&speed=0.25&t=1.35` |
| L3-F1-phase0 | forward | defender | falls 1.17 s | stays up | 8m | `?fixture=L3-F1-phase0&cam=front&speed=0.25&t=1.00` |
| L3-F1-phase5 | reversed | defender | stays up | falls 1.60 s | 3 | `?fixture=L3-F1-phase5&order=rev&cam=front&speed=0.25&t=1.45` |
| L3-F1-phase7 | forward | defender | stays up | falls 1.54 s | 10d | `?fixture=L3-F1-phase7&cam=front&speed=0.25&t=1.40` |
| L3-F4-gripTarget | both | defender | falls 1.82 s | stays up | 10d (forward: 8m up, 9d falls, 10d up) | `?fixture=L3-F4-gripTarget&cam=front&speed=0.25&t=1.65` |
| L3-F9-convert-free | both | defender | stays up | falls 0.86 s | 10d | `?fixture=L3-F9-convert-free&cam=front&speed=0.25&t=0.70` |
| L4-F3-run-off | both | defender | stays up | falls 0.86 s | 10d (the same run as L3-F9-convert-free) | `?fixture=L4-F3-run-off&cam=front&speed=0.25&t=0.70` |
| L4-F10-knee-on | both | defender | stays up | falls 0.69 s | 10d | `?fixture=L4-F10-knee-on&cam=front&speed=0.25&t=0.55` |
| L4-F3-run-on | both | defender | stays up | falls 1.12 s | 9d | `?fixture=L4-F3-run-on&cam=front&speed=0.25&t=0.95` |
| L4-F9-free | both | defender | stays up | falls 1.12 s | 9d (the same run as L4-F3-run-on) | `?fixture=L4-F9-free&cam=front&speed=0.25&t=0.95` |
| L4-F5-twoPalm-on | both | runner | falls 2.17 s | stays up | 8m | `?fixture=L4-F5-twoPalm-on&cam=front&speed=0.25&t=2.00` |

In all: 16 player-runs now fall that stayed up, 8 now stay up that fell. Times are when the fall starts (the switch to
falling); for "stays up" the link is just before the moment it used to fall. Changed and back again, so not in the
list (the defender each time): L4-F10-elbow-on (fell at the start; up at 4b, down at 7c, up at 9d, down at 10d),
L4-F10-knee-off (up at 8m, down at 10d), L3-F9-noProbe-free (down at 8m, up at 10d), HC-F3-phase0 reversed (up at 8m,
down at 10d), L3-F1-phase0 reversed (down at rung 3, up at 10d), HC-F3-lowRunner reversed and HC-F3-mirror forward
(down at rung 3, up at 9d), HC-F3-phase75 reversed (up at rung 3, down at 8m), L3-F1-phase6 reversed (up at rung 3,
down at 7c), and the conversions rejected from rung 3 until 8m (L3-F4-oneArm, L3-F1-phase2, L4-F10-wrap-off: rigid
falling figures then), which convert again as at the start. Tool: `.scratch/ladder/r10d-v3-flip/tools/netfalls.py`
(`netfalls.txt` there).

### 8m: the joint stops on every falling player

Before: add `&legs=v1&selfleg=off&hips=off&pgs=0&knees=off&retry=off` to any link below; as 8m left it:
`&legs=v1&selfleg=off`.

What visibly changes. A falling player's hips no longer twist round or swing to where a body cannot go, its knees no
longer fold flat, and its legs pass through its own body much less. On the falls with a muscle response the hips no
longer splay wide.

- `?fixture=HC-F2-bothFall&cam=side&speed=0.25&t=1.40`: player A's right thigh was turned round on itself.
- `?fixture=L3-F10-bothLow&order=rev&cam=side&speed=0.25&t=1.75`: the defender's right thigh swung far behind it.
- `?fixture=L4-F11-settle&cam=side&speed=0.25&t=1.00`: the runner's right knee folded flat as it settled.
- `?fixture=L4-F12-base&cam=front&speed=0.25&t=0.55`: the runner's legs splayed wide while falling.

Who falls (t is just before the moment). The first two lists are the ones you saw and accepted at the lab review of
these stops; the third is new since then, from the retried conversion added after it. The four players that review
showed turning into stiff figures (`HC-F3-falling` reversed, `HC-F5-strictTransfer` both orders, `L3-F1-phase4`
reversed) go limp again as they did before the step.

Now stays up:

- `?fixture=HC-F3-phase0&cam=front&speed=0.25&t=1.05`: the defender (both orders).
- `?fixture=L3-F1-phase0&cam=front&speed=0.25&t=1.10`: the defender (reversed it still falls, 0.1 s later).
- `?fixture=L3-F4-gripTarget&cam=front&speed=0.25&t=1.65`: the defender (reversed it still falls, 0.15 s later).
- `?fixture=L4-F10-knee-off&cam=front&speed=0.25&t=0.65`: the defender (both orders).
- `?fixture=L4-F5-twoPalm-on&cam=front&speed=0.25&t=2.00`: the runner (both orders).

Now falls:

- `?fixture=HC-F3-phase75&order=rev&cam=front&speed=0.25&t=1.20`: the defender.
- `?fixture=L3-F1-mirror0&cam=front&speed=0.25&t=1.25`: the defender (both orders).
- `?fixture=L3-F1-mirror4&order=rev&cam=front&speed=0.25&t=1.35`: the defender.
- `?fixture=L3-F9-noProbe-free&cam=front&speed=0.25&t=0.70`: the defender (both orders).

The statue now goes limp (new since the review): the defender stayed a stiff, unbending figure to the end of the fall;
now it goes limp as it falls.

- `?fixture=L3-F1-phase2&cam=front&speed=0.25&t=1.20`
- `?fixture=L3-F4-oneArm&cam=front&speed=0.25&t=1.20`
- `?fixture=L4-F10-wrap-off&cam=front&speed=0.25&t=1.15`

Bracing hands that changed:

- `?fixture=L4-F12-base&cam=front&speed=0.25&t=0.25` and `?fixture=L4-F12-mirror&cam=front&speed=0.25&t=0.25`:
  the landing hand now reaches the floor; before, both arms were late.
- `?fixture=L4-F3-oblique-on&cam=front&speed=0.25&t=0.25`: the free hand now lands; before, it was late.
- `?fixture=L4-F3-side-on&cam=front&speed=0.25&t=0.25`: the free hand now gives up as too far; before, it was late.
- `?fixture=L4-F5-onePalm-on&cam=front&speed=0.25&t=1.50`: the free hand's brace no longer lands (you accepted this).

To look at and decide:

- `?fixture=HC-F5-strictTransfer&cam=side&speed=0.25&t=2.80`: the runner ends lying with its right arm straight overhead
  on the floor, and the joint measure reads that shoulder as twisted well past what a shoulder can do, from about 3 s to
  the end. Straight overhead the measure is unreliable (a small move of the arm swings the reading a long way), and the
  shoulder's twist limit is built to fade out there, so nothing turns the arm back. This step does not cause it: from
  the same moment with the new stops taken off, the arm stays the same. The "before" view ends differently (the whole
  fall changes from the conversion on), so judge this one view. Question: does the arm look twisted? If it does, a twist
  limit that holds overhead becomes a later step; if it looks natural, the measure stops reading shoulder twist
  overhead, as it already does not for the hip.

The links above show the current tip: since 9d the fallen players' legs meet, since 10d standing legs are solid (both
below). To see a moment exactly as 8m left it, add `&legs=v1&selfleg=off` (the table at the top of this section).

### 9d: fallen players' legs meet each other

Before: add `&legs=v1&selfleg=off` to any link below; as 9d left it: `&legs=v1`.

What visibly changes. A fallen player's legs no longer pass through each other or through its own body: they stop at
each other and lie together. Where the legs were already crossed through each other at the moment the player went
limp, they stay through each other until they come apart, then stay apart.

- `?fixture=HC-F5-strictTransfer&order=rev&cam=side&speed=0.25&t=2.40`: the runner's shin went through its other thigh
  from 1.6 s to the end.
- `?fixture=L4-F9-transferFailed&cam=front&speed=0.25&t=1.40`: the runner's feet went through each other.
- `?fixture=L4-F1-hipSwing&cam=front&speed=0.25&t=1.10`: the runner's feet were through each other for the whole fall.

Who falls (the defender each time, moved by the runner's fall now that the runner's legs meet):

- Now stays up: `?fixture=HC-F3-lowRunner&order=rev&cam=front&speed=0.25&t=1.85`,
  `?fixture=HC-F3-mirror&cam=front&speed=0.25&t=1.65`, `?fixture=L3-F1-low&order=rev&cam=front&speed=0.25&t=1.85`,
  `?fixture=L4-F10-elbow-on&cam=front&speed=0.25&t=0.70` (both orders).
- Now falls: `?fixture=L3-F4-gripTarget&cam=front&speed=0.25&t=1.95`,
  `?fixture=L4-F3-run-on&cam=front&speed=0.25&t=0.95` (both orders), `?fixture=L4-F9-free&cam=front&speed=0.25&t=0.95`
  (both orders).

To look at and decide:

- `?fixture=L3-F3-collision&order=rev&cam=side&speed=0.25&t=1.90`: the defender comes to rest propped on its own leg,
  its body 21 cm higher than before (before, its legs lay through each other). It is still, with no shaking. Question:
  does it look like a body lying on its own leg, or held up?
- `?fixture=L3-F9-noProbe-free&cam=side&speed=0.25&t=1.95`: the runner has come to rest when one leg slides off the
  other and settles, still again by about 2.35 s (before, the legs lay through each other and nothing moved). Question:
  does the slide look natural?
- `?fixture=HC-F1-at0.9&cam=front&speed=0.25&t=1.25`: the defender's shins were crossed through each other when it went
  limp; they stay through each other until they come apart at about 1.47 s, then lie together. In seven short falls the
  run ends before the legs part (for example `?fixture=L3-F1-falling&order=rev&cam=front&speed=0.25&t=1.40`).
  Question: is a crossing that lasts until the legs part acceptable, or should crossed legs be pushed apart (a later
  step)?

Between 9d and 10d nothing visible changed: 9e changes a recorded reason only, 9f's fix is off (its flip parked), 9g
and 10b are byte-identical. The links above show the current tip, where standing legs are solid (10d, below); add
`&legs=v1` to see a moment exactly as 9d left it.

### 10d: standing players' legs are solid to falling players

Before: add `&legs=v1` to any link below.

What visibly changes. A standing player's legs no longer pass into a falling or fallen player's body: a falling arm,
leg or body meets the shin or thigh and both are pushed. Overlap between standing legs and fallen bodies drops by
70-100%; what is left is at most about 2 cm for a few frames.

- `?fixture=L4-F5-onePalm-on&cam=front&speed=0.25&t=1.45`: the runner's right thigh sat inside the defender's thigh.
- `?fixture=HC-F5-strictTransfer&order=rev&cam=front&speed=0.25&t=1.15`: the defender's thigh went into the runner's.
- `?fixture=L3-F1-phase4&order=rev&cam=front&speed=0.25&t=0.95`: the defender's thigh went into the runner's hand.

Who falls (the defender each time). Several undo an earlier step's change; the net list against the ladder's start is
at the top of this section.

- Now falls:
  - `?fixture=L4-F10-elbow-on&cam=front&speed=0.25&t=0.05`, `?fixture=L4-F10-knee-off&cam=front&speed=0.25&t=0.05`,
    `?fixture=L4-F10-knee-on&cam=front&speed=0.25&t=0.25` (all both orders): running into the shoved runner from
    behind, the defender's feet catch the runner's feet and it trips. On elbow-on it goes over slowly, about half a
    second, its body resting on the runner's shin near the end. Elbow-on undoes 9d (it fell at the start too);
    knee-off undoes 8m (it fell at the start too); knee-on is new.
  - `?fixture=L3-F9-convert-free&cam=front&speed=0.25&t=0.40` (both orders; `L4-F3-run-off` is the same run): the
    runner's falling arm sweeps the defender's thigh instead of passing through to its hips. New.
  - `?fixture=L3-F1-phase7&cam=front&speed=0.25&t=1.20`: the defender's thigh meets the runner's hips, then the runner's
    arm lands on its leg. New.
  - `?fixture=HC-F3-phase0&order=rev&cam=front&speed=0.25&t=0.95`: the defender's thigh drives into the runner's body.
    Undoes 8m for this order, as at the start (8m stood it up in both orders; forward it still stays up).
- Now stays up:
  - `?fixture=L3-F4-gripTarget&cam=front&speed=0.25&t=0.95` (both orders): the runner's thighs press the defender's
    and hold it up. Forward undoes 9d (which made it fall again after 8m stood it up); reversed it fell from the start.
  - `?fixture=L3-F9-noProbe-free&cam=front&speed=0.25&t=0.40` (both orders): the runner's arm hits the defender's
    thigh instead of its hips. Undoes 8m (it stayed up at the start).
  - `?fixture=L3-F1-phase0&order=rev&cam=front&speed=0.25&t=1.00`: the defender leans 13 degrees and recovers. 8m stood
    the forward order up; now the reversed one stays up too, as at the start (it fell from rung 3 on).

A hand that changed: `?fixture=L4-F4-occupied&cam=front&speed=0.25&t=1.65`: the falling player's one-hand hold now
lets go at 1.73 s (the standing player's legs push its body), and that hand then reaches for the floor, too late.

To look at and decide:

- `?fixture=L3-F6-hold&cam=front&speed=0.25&t=3.95`: the held runner's thighs cross into each other (about 1.5 cm)
  from 4.0 to 5.0 s. Standing legs crossing each other goes up by almost half over the L3 falls (down on L4); it comes
  with the new leg stepping and planting (the parts that are not the solid legs), and is the same without the solid
  legs. Question: visible enough to fix before the next milestone?
- `?fixture=L4-F10-elbow-on&cam=side&speed=0.25&t=0.40`: the slow trip above. Question: does it look like a stumble,
  or like being held up and let down?
- `?fixture=L3-F9-noProbe-free&cam=side&speed=0.25&t=0.85`: the defender, now staying up, is bounced about 24 cm
  upward at 1.1 s. Not its legs: its rigid standing body rebounds, and from 0.67 s with the old legs it bounces the
  same. `?fixture=L3-F9-noProbe-prep&cam=side&speed=0.25&t=0.70` is the same kind of bounce (about 14 cm at 0.9 s, its
  hips off the runner's shoe), and that defender now falls 0.4 s later than before. Question: is the bounce acceptable
  for now? (It belongs to the rigid standing body, a separate step: the open defect "unsupported proxy over a refused
  surface".)

## Status

Results per rung under `.scratch/ladder/<rung>/` in the main checkout; each compared against the previous rung.

- **0** (`r0-baseline`) landed: 250/250, no L4-matrix row over the power ceiling, highest audited peak 145.9 W.
- **1** (`r1-query-memo`) landed: byte-identical.
- **2** (`r2-controls`) landed: byte-identical; 253/253 (three added tests). The pulled-forearm control (body-limits),
  the `PoseDebug.ownerChangeJumpM` audit control on L3-F16-sprint (l3-contracts), and the controlled reseed and
  support-loss boundary records (`FootDebug.releasePlantAt`, `reseedCovered` / `stepAsIsCovered` in l3-pass), each beside
  the natural sample it backs up; nothing replaced.
- **3** (`r3-twist-anchor`) landed. The arm-task twist window is anchored once per substep and never widened: the
  largest arm-task twist change in one tick on the M1 review fixtures goes from 55.6 deg (L3-F4-twoArm D.left 0.867 s;
  17.8-23.6 deg on the others) to the rate, 11.46 deg (at most 0.0016 deg over, inside the fit's stopping tolerance).
  Summaries changed: L3 30/98, L4 10/75, HC 14/22; G/L1/L2/RH byte-identical; no L4-matrix row over the power ceiling
  (highest rise L4-F10-wrap-on D 125.5 to 138.2 W). Everything moves from the first tick: D's arm-task elbow is 2.4-3 cm
  elsewhere at 0.017 s (the first substep's solves no longer turn past one rate step), its palm meets R elsewhere from
  about 0.43-0.6 s, and the contacts follow. Who falls: L3-F4-oneArm and L3-F1-phase2 D (conversion rejected, tracked
  defect below), L4-F10-wrap-off D (the same), L3-F1-low D (R falls 4 ms later; D keeps its support, it lost it at 1.696 s
  before), HC-F3-mirror D (R falls 54 ms later; D's probe lands on R's ragdoll at 1.400 s and D loses support at 1.475 s).
  Tests: the arm-task per-tick bound (body-limits M1); two rule 7 tracked defects with their own tests (l3-contracts
  "ladder tracked defects"); the STEP_AS_IS natural sample (L3-F4-twoArm) gone, covered by rung 2's controlled record;
  the 13e blocked-home fault no longer moves a foot of L3-F6-hold, shown on the old tree's constructed planner hold
  instead; the limp-shoe hold catalogue gains HC-F1-low R.left and HC-F1-lowMirror D.right (plan 12's rule; the twin
  with the change off from 1.20 s, before either player converts, holds the same shoes for the same substeps).
- **4a** (`r4a-joint-residual`) landed, `fall-response-l4-v4`: the parent joint's velocity residual counts toward a
  segment's closing speed. Summaries changed: L4 28/75 only; no result or who-falls change; no L4-matrix row over the
  power ceiling (highest peak L4-F9-contact R 142.0 to 151.1 W, under 157.5). Test: `tests/headplant.test.ts` on the
  old tree's L4-F9-low seed (step 326), valid here unchanged: the same ragdoll profile id, the head touches with 9.75 N s
  (under the impulse rule) and is at rest (0.004 m/s), closes at 1.08 m/s with its neck's residual, takes 54.4 N s; the
  twin without the residual realizes 177.3 W (1 substep over), FALL_L4 holds the body and peaks at 129.7 W.
- **4b** (`r4b-manifold-points`) landed, `fall-response-l4-v5`: the closing speed is read at every point of the pair's
  last manifold. Summaries changed: L4 33/75 only; no L4-matrix row over the power ceiling (highest rise L4-F10-wrap-on
  reversed D 131.2 to 154.7 W, under 157.5). Who falls: L4-F10-elbow-on D no longer falls: R's guard reads a manifold
  point closing at 0.383 s and holds one substep more; R's pelvis meets D's support 8 ms earlier with 27.4 N s instead of
  33.6, and D's lean stays inside its recovery envelope (the twin lost support at 0.779 s, 36.9 deg). Test:
  `tests/corerock.test.ts` on the old tree's tipped-forward seed (step 105), valid here unchanged: same ragdoll profile
  id; in the third seeded solve the core's closest point reads no closing, the far corner 3.5 m/s, the solve takes 56 N s,
  nothing over the impulse rule before it; on the closest point alone 219 W, FALL_L4 133.5 W.
- **4c** (carried impacts) landed as 6c, on the physical-legs base its case needs.
- **4d** (`r4d-limp-rule`) landed: byte-identical. The limp-shoe hold catalogue in body-limits becomes a check of plan 12's
  rule on every hold decision of its four fixtures (held exactly when the turn would come closer to another player inside
  8 cm, recomputed unculled; a held shoe keeps its pitch, a turned one moves one rate step), with a positive sample and
  the rule disabled and inverted as fault controls.
- **4e** (`r4e-state-capture`) landed: byte-identical, no `src/sim` change. Full-state capture and resume for tests
  (`tests/state.ts`, `scripts/capture-state.ts`, `tests/README.md`): the Rapier snapshot and the Simulation's whole JS
  state graph at a tick boundary, resumed into a fresh build of the (possibly variant) definition; resumed runs
  reproduce the uninterrupted export byte for byte. The rule 7 tracked-defect tests (`LEG_IN_RAGDOLL`,
  `HOLD_CLEARANCE_REPLANT`) resume from captures 2 ticks before the defect (`tests/data/state/`, 166-232 KB each).
- **5** (`r5-leg-sweep`) landed: byte-identical, shape-query counts unchanged. `LEG_GUARD_V2` (`sweep`, no fixture runs
  it): the supported legs' shown step is judged against the physical bodies (`PoseClearance.legs.physical`), a leg
  still past HARD_OK tries the primary's other knee poles, then the offsets, and the step is swept from the shown pose in
  1 cm samples, stopping at the last clear one. Tests: the 13f thrown closing body under V2 (body-limits) and four
  constructed pose cases (another placement, a stop at the last clear sample with the twin crossing, limb lengths and
  hip kept, no jump on stop or resume); the harness profile row. With V2 on all fixtures (information,
  `.scratch/ladder/r5-leg-sweep/v2-on/`): the leg matrix changes 8 of 390 rows, L3-F1-mirror4 reversed D falls (1.567
  s); the L4 matrix changes 1 of 92 rows, none over the ceiling; `LEG_IN_RAGDOLL` stays (the L3 pair deeper, 5.54 cm new
  penetration and 13 substeps instead of 4.28 and 12; L4-F10-wrap-off unchanged); the worst shape-query tick reaches 4889
  (L3-F1-mirror4; 6 fixtures over 4000, 3 of them at 4030 with V2 off).

- **5b** (`r5b-query-budget`) landed: byte-identical. The 4030-query tick (HC-F1-at0.9, HC-F1-at1.6, HC-F5-invalidOne at
  0.867 s) was R's held left arm in D's wrap: its swing-out bracket runs to its cap with nothing clear (15 builds, 17 cm
  deep), then its continuity step bisects to the valid fraction with each step's push-out at its 4-iteration cap (40
  builds a substep, depth converging on HARD_OK): a real search, not repeats. The push-outs (pose and trunk) read
  penetrating contacts only and now ask at the depth checks' prediction, reusing their answers (a penetrating contact
  is the same at any prediction: harness test on random pairs of every shape kind, both query paths); the trunk answers
  are kept per shape like the others. Worst tick 4030 to 3242 there, every leg-matrix run under 4000 (highest
  L3-F7-mirror50, 3423), 5% fewer queries over the export. The full check counts every leg-matrix run
  (`queries.jsonl`, a compare line for ticks over the budget); the suite's budget test adds HC-F1-at0.9 and
  L3-F7-mirror50.
- **6** (`r6-physical-legs`) landed: byte-identical, shape-query counts unchanged. `LEG_GUARD_V3` (V2 with
  `physicalLegs`, no fixture runs it): a supported proxy's six pose leg shapes are massless round-hull colliders on its
  own body (contacts act on the proxy once; mass properties bitwise kept), placed from the achieved pose after each
  solve with twist-free frames, live only while the proxy stands on static ground (D2: the suspension probe within
  travel and not on a player; legacy support only while `grounded`), off at the conversion request and removed with the
  proxy. Filter: groups (never static ground or another physical leg), the contact hook (never the floor, obstacles,
  another proxy's support capsule or guard, self-clearance shapes), one body (never its own proxy). The guard clears
  the posed legs to PHYS_LEG_OK (1 mm) of the bodies they meet, where they stand, predicted and stopped (D1), the sweep
  starting from the last shown leg. Leg ledger (`Simulation.legLedger`, observation only). Contact records of the legs
  are ordinary records (limb class) except for arm grips (skipped) and ground (never). `tests/state.ts` captures their
  shapes (`RoundConvexPolyhedron`). Tests: `tests/physical-legs.test.ts` (exactly once, filter layers, D2 on real
  states, ownership at conversion, D1 against `PoseDebug.noLegStop`, surface speeds against world-up frames), the 13f
  thrown body under V3 (body-limits), the `LEG_IN_RAGDOLL` captures under V3 (l3-contracts: all three convert, nothing
  past the tolerance), a V3 capture round trip (state). With V3 on every leg-guard fixture (information,
  `.scratch/ladder/r6-physical-legs/v3-on/`, README there): 22 suite failures (7 by construction, 6 natural samples or
  negative controls moved, 9 behaviour); 15 result or who-falls changes; one L4 row over the ceiling,
  L4-F9-defenderFalling D 172.0 W (rung 4c's case: R's core on D's thigh while R lands; the 4c flag clears it and leaves
  the matrix at 148.1 W); `LEG_IN_RAGDOLL` and the L4-F10-wrap-on stall gone; worst shape-query tick 3535.
- **6b** (`r6b-filter`) landed: byte-identical (summaries, traces, both matrices, shape-query counts). The physical legs
  meet another player's ragdoll segments only (`legMeets`, the contact hook for every leg pair), never a proxy; a leg
  deeper than `PHYS_LEG_ON_M` in a new ragdoll leaves the solve at the switch (`legsOffInsideConverted`). With V3 on
  every leg-guard fixture: who-falls changes 15 to 12, suite failures 21 to 17 (none new), no leg impulse on a proxy
  (was 1519 N s over 31 runs), largest injected energy per substep 0.623 to 0.20 J.
- **6c** (`r6c-carried`) landed, rung 4c re-expressed, `fall-response-l4-v6` with `impactGuard.carried`: a core-jointed
  segment closing on another player's ragdoll that is about to land holds the whole body. Flag off (V3 off): summaries,
  both matrices and query counts byte-identical; the 46 fall-response L4 traces change only in the profile id. Test
  `tests/carried.test.ts`: L4-F9-defenderFalling under V3 from a capture at tick 65, 172 W without the flag (one
  substep over 157.5), 136 W with it; three earlier landings with D's thigh resting on R hold nothing.
- **7** (`r7-planted-pose`) landed: byte-identical, 285/285. Under `sweep` (V2, V3) a planted leg whose primary is
  invalid (or, with `physicalLegs`, in a body the legs meet) takes the primary at a knee pole before any offset, held
  at the plant tolerance and the continuity rate, and returns to the primary once that is clear at its own knee; with
  no valid planted pose the leg is released as before. Fault `PoseDebug.noPlantedPole`. Tests
  `tests/planted-pose.test.ts` and the hold captures under V2/V3 (l3-contracts). `HOLD_CLEARANCE_REPLANT` under V2/V3:
  no clearance release and no plant after 3.5 s on either capture, the fault twin keeps the cycle. L3-F4-twoArm does not
  reach it (D's left foot there is released by reach at 0.583 s, not a plant).
- **7b** (`r7b-pole-exit`) landed: byte-identical, 286/286. The knee-pole exit was not a candidate switch: an exact plant
  is shown where it stands and never pushed, so a body the physical legs meet comes into it (R's left leg on its knee
  pole 5-6 mm deep), and the swing's first step pushed that depth out at once on top of the rate step. Under V3 a leg
  held so (pose memory `<side>Leg:mh`) now moves at most the plant rate from where it stands, push-out included, until
  it is clear of the met bodies. The rung-7-off breaches (L3-F4-gripTarget D 1.14 cm, L3-F4-gripOwner R 1.33 cm) are
  the same mechanism on the primary: with the fix every ownership change of the three runs is under 0.72 cm, with the
  fault `PoseDebug.noHeldMetExit` they come back. Test: tests/planted-pose.test.ts on
  `L3-F4-gripOwner~v3-audit@96` (`capture-state.ts --audit`), fault twin 2.03 / 1.31 cm.
- **7c** (`r7c-stale-impulse`) landed: G/L1/L2/RH byte-identical, 288/288; L3/L4/HC evidence changes (summary
  regenerated). Rapier solves at most four points of a manifold and writes impulses back to those only; a point left
  out keeps the impulse of the last solve that included it, and the contact records, the support contact, the leg
  ledger and the self-trunk impulses read every point as applied. `solvedImpulses` (physics.ts) matches each solver
  contact to its manifold point and reads the rest as 0, gated by `SolverProfile.solvedImpulses` (`+solved`) on
  L3/L4/HC only (the ungated reading moved G, L2 and RH summaries). Stale share over the leg-guard runs, both orders, on
  the old reading: V1 517.8 N s of 78,622 player-player (0.66%, 63 of 390 runs), V3 1055.4 of 81,886 (1.29%, 89 runs);
  none on the floor. Worst: V1 HC-F5-strictTransfer 37.0 N s in one record, V3 L3-F9-noProbe-prep 134.4 N s in the run.
  Changes: L4-F10-elbow-on D now falls (recovery envelope, 0.771 s, both orders): R's impact guard held one substep
  more on a stale 10.7 N s shoe record at 0.113 s under the old reading, and the runs part there. L3-F1-phase6 reversed
  D converts at 1.55 s: a stale 15.5 N s record of D's support on R's pelvis (a separated point kept only by its stale
  impulse) kept D's locomotion in `contact`; solved, D leaves it 18 substeps sooner. Six more summaries move in peaks
  only; no row over a ceiling, worst query tick 3423. Tests: tests/contact-impulse.test.ts (a five-point hull on a
  frictionless slab: the solved reading equals the momentum the contact applied in 479/479 steps, the old one is off in
  most), the gating per family. Captures regenerated; `L4-F9-defenderFalling~v3@65` kept as captured and resumed with
  the `solver` variant (from the start under the solved reading D stays under the ceiling without `carried`, 132.7 W).
- **7d** (`r7d-test-repairs`) landed: byte-identical, 289/289; tests only. The twoPalm hold-effort row reads the effort
  the joints were given (the fall ledger), with a V3 row: D's left arm asks 0.76 N m with its grasp over its allocation
  and gets none; fault twin, an arm with no room taking its request unscaled. The three rung 7 controls (10b crossing
  negative control, the RESEED sample on L3-F7-phase75, now run on its own, 13e inherited foot on L3-F7-phase50) run
  with `noPlantedPole`. Natural samples pinned to LEG_GUARD_V1: HC-F3-lowRunner and L3-F10-bothMirror shoulders,
  L4-F5-onePalm-on 'left expired', gate4 E1, 13e gripOwner step home, 13f L3-F9-noProbe-contact reversed. Under the V3
  map (`r7-triage/v3map.patch`): 8 failures, 6 by construction (harness profile table, physical-legs "no fixture runs
  V3", state.test x2, l3-contracts tracked defects x2), L4-F3-run-on shoulder persistence (0.2875 s), and the twoPalm
  hold's overload exposure 0.065 s against half the release threshold 0.05 s (behaviour, unmasked by the repair).
- **7e** (`r7e-lab-params`) landed: byte-identical; lab only. URL parameters `order=rev` (SimOptions.reverseOrder) and
  `legs=v1|v2|v3` (a leg-guard fixture under that profile; others as they are), shown in the title label, e.g.
  `?fixture=L3-F1-phase6&order=rev&legs=v3`. Test tests/lab-params.test.ts: that URL's run has the summary of the leg
  matrix's reversed row under V3; without the parameters it differs.
- **7f** (`r7f-loaded-limb-rule`) landed: byte-identical, 292/292; tests only (`tests/loaded-limb.ts`). The envelope's
  persistence check (falls) counts a joint's time past the tolerance only while the floor does not hold its limb
  (load-pinned: the floor's solved normal load on the distal segments could exert, at its Coulomb cone and lever, the
  envelope's moment at the tolerance, k |grad| 5 deg; own-trunk load does not pin). A pinned limb stays within
  (1 + overshoot) x the largest load moment of the last half damped period / k (the load from the distal chain's angular
  momentum balance, so friction counts; not judged in the load's first half period or at the cap); once the floor lets
  go it is back inside within the envelope's free crossing time plus a tick. Known-limit entries retired:
  L4-F3-model-oblique-off R (pinned throughout, 4.2 deg inside its bound); L4-F9-low R and L4-F5-twoClamp-off R no
  longer occur at this tree (0.042 s and under 0.05 s on the old clock). Every fall passes under V1 and V3, both orders;
  tightest: L4-F3-run-off D right hip under V3, back in 0.058 s against 0.061 (to watch at the flip). Test
  tests/loaded-limb.test.ts on `L4-F3-run-on~v3@66`: old clock 0.2875 s, rule passes; twins: swing spring off while
  pinned (8.8 deg over the bound, free clock under), off from the start (R's unloaded left arm 0.39 s free), the floor
  letting go at 1.40 s (back in 0.013 s, bound 0.065) and the same with k/25 (0.158 s).
- **7g** (`r7g-energy-check`) landed: byte-identical, 293/293; tests and check only (`tests/passive-energy.ts`, the
  passive-energy matrix `scripts/check/energymx.ts`, informational lines in compare). Per ragdoll per solve (one
  1/240 s step): passive = change of kinetic (linear and angular, world inertia) plus potential energy, less the work of
  every applied force and torque (trapezoid), counted only when no other player's collider has a contact impulse with
  it (solved or raw: the solved reading can miss one, below). A counted solve gaining over 0.5 J injects (the smallest
  the investigation called a defect; gravity's integration reads -0.08 J; a solve with no contact at all gains only
  where a segment moves off its velocity's path, mostly CCD holding it back before a first contact: up to 1.7 J, 10
  runs). Per run (fixture x order x player): injecting solves, their total, the largest with solve, time and pinch
  segments, the contact-free floor, each injecting solve with the largest loss of the tick before and its contact flag.
  Matches the investigation: L4-F9-contact reversed V3, R's solve 270 +7.70 J (kinetic 4.62, potential 3.20, applied
  0.11), pinch right forearm. Test tests/passive-energy.test.ts: L4-F2-side-off R under 0.5 J in every solve against the
  twin given exactly 2 J of core kinetic energy inside one solve (read 2.000000 J more, the earlier solves identical).
  Baseline (V1, both orders): HC 949 J in 230 solves (55 of 72 runs, largest 196.7 J), L3 1150 J in 325 (86 of 138,
  128.3 J), L4 2907 J in 327 (114 of 175, 122.5 J). By class: rebound (a loss at least as large in the tick before)
  689 solves 4590 J, pinch (a segment on the floor and its own shape) 36 / 85.7 J, contact-free 10 / 11.4 J, other
  147 / 318.8 J (largest L4-F9-crowded reversed R 122.5 J at 0.371 s inside a knee impact: -69 and -41 J before,
  -248 J after). Cost: full check 279 s against 253 s (8 shards of 32-46 s); nothing when off.
- **8a** (`r8a-ragdoll-iterations`) landed off: byte-identical, 296/296 (every matrix too). `RagdollProfile.
  additionalPgsIterations` (`withAdditionalPgsIterations`): every segment body asks Rapier for that many more internal
  PGS iterations per solver substep (the island runs the largest request); no fixture uses it. Test
  tests/ragdoll-iterations.test.ts: the field reaches every segment (none without it); the self-trunk pinch capture
  `L4-F9-contact~v3-rev@63`, solve 270: +7.70 J as is, -5.87 J with 3 on R's segments from the capture; the brace
  rebound capture (open defect below). At the pinch from the capture, solve 270 / the rest of the run's largest gain:
  PGS +1 -6.6 / 3.1 J, +2 -6.6 / 1.3, +3 -5.9 / none over 0.5, +4 -7.8 / 1.0, +6 -15.6 / none; additional solver
  iterations instead: +1 -50.1 / none, +2 -76.9 / none, +3 +3.6 J (still injecting), +4 -2.3 / 1.0: not monotonic, so
  the field is the PGS one. Not flipped (coordinator): the iteration count is to be chosen and turned on together with
  the hard hip stops and own-leg contact, which add closed loops. Assessment, every L3/L4/HC ragdoll under N from its
  build, registered leg guards (information, `.scratch/ladder/r8a-ragdoll-iterations/`, README there): injecting
  solves / J over the matrix 882 / 5006 (N 0), 450 / 2423 (2), 409 / 2113 (3), 325 / 1594 (4); largest gain per family
  L3 128 / 43 / 38 / 23 J, L4 122 / 71 / 45 / 37, HC 197 / 39 / 43 / 27. Rebound 689 / 403 / 369 / 292 solves: no N
  removes it; the brace rebound in the run stays at N 2 (52.0 J) and 3 (44.8 J, the largest L4 gain), gone at 4.
  Pinch 36 / 15 / 9 / 8 solves (85.7 / 99.9 / 14.1 / 28.2 J); contact-free gains up to 27 J at N 3 (L4-F9-low
  reversed, the solve after a 478 J impact). Full check 250 s (N 0) against 233-236 s: no measurable cost (matrix
  shards' CPU within 2%). G/L1/L2/RH byte-identical; L3 44, L4 69-70, HC 21 summaries change; 24-26 suite failures
  (not classified); L4 power ceiling: N 3 one row (L4-F10-wrap-on D 157.8 W), N 4 two (167.4 W); D now converts in
  L3-F1-phase2, L3-F4-oneArm, L3-F9-noProbe-free and L4-F10-wrap-off at every N (all but noProbe-free the
  `LEG_IN_RAGDOLL` rejections).
- **8b** (`r8b-vitest-exclude`) landed: byte-identical, 296/296. vitest excludes `.scratch/**` (scratch test files).
- **8c** (`r8c-visible-checks`) landed: byte-identical, 301/301; tests and check only (`tests/visible.ts`,
  `scripts/check/visiblemx.ts`, compare lines; definitions and the human range table in `scripts/check/README.md`). The
  visible audit (`.scratch/ladder/visible-audit/`) as a matrix: every L3/L4/HC fixture, both orders, every drawn frame,
  ragdoll and supported split, the worst event per column with a lab URL. Validated on constructed poses (both sides,
  mirrored) and the screenshot run (tests/visible.test.ts); under V3 it reproduces the audit's headline (impossible
  275.1, implausible or worse 583.3 player-s); the registered fixtures (V1) read 258.7 / 581.2 (V1 changes who falls
  and when: L4 ragdoll time 380 s against 390). Full check 304 s against 248 s. The ladder's primary measure (above).
- **8d** (`r8d-hip-stops`) landed off: byte-identical, 310/310. `RagdollProfile.hipStops` (HIP_STOPS_V1, `withHipStops`):
  Rapier's per-axis angular limits on each spherical hip through one raw wrapper (`setAngularLimits`; the test fails
  on a Rapier change), about an anatomical frame per side from the calibrated rest thigh. A conversion outside the box
  starts against a stop widened to the start, closing with the joint (a ratchet, never reopening; cap 172); a
  fall-response hip target is held 3 deg inside. Lab `hips=on|off` (28a808a, `r8e-lab-hips`, byte-identical,
  311/311; the 8d box is `hips=v1` since 8h): e.g. `?fixture=L3-F9-convert-free&legs=v3&hips=v1&cam=side&speed=0.25&t=0.40`.
- **8e** (hip stops on L3/L4/HC): **not flipped** (assessment `.scratch/ladder/assess-8d/`, README there). Every L3/L4/HC
  ragdoll under the stops: impossible ragdoll time 258.7 -> 7.3 player-s (L3 157.9 -> 3.2, HC 99.9 -> 2.6, L4 0.9 ->
  1.5), implausible or worse 581 -> 191; none of the screenshot poses occurs. Blocked by: (1) passive energy: a thigh
  swing arrested by a stop is an impact through the hip and the solves after it give part back (open defect below);
  injecting solves 882 -> 2219, 9977 J against 5006; with 2 / 3 / 4 additional PGS iterations 1823 / 1570 / 1478 solves,
  6604 / 5782 / 4370 J (largest 106 / 92 / 72 J against 197), against 325 solves / 1594 J for PGS 4 alone; the
  passive-energy test fails at every count; (2) on L4 the box lies inside the soft hip envelope on every axis (envelope
  129 / 61 / 39 / 45 / twist 50 against 125 / 50 / 30 / 30 / 45), so the envelope never takes a hip's load (L4-F1-hipTwist
  settle test, the persistence rule's pinned sample empty): L4 needs stops outside the envelope or the envelope retired;
  (3) 29 suite failures (14 by construction, 2 the envelope, 1 the energy, 12 natural samples or behaviour not yet
  twinned) and 12 who-falls changes, listed in the README. Remaining impossible time under the stops: shoulder rotation
  3.6 s, a stop overpowered by more than 3 deg 1.6 s (worst HC-F2-bothFall reversed A, 65 deg under two bodies), the
  box's corners 1.4 s (twist admitted grows with swing), stops still widened from the conversion 0.6 s.
- **8f** (`r8f-knee-stop`) landed off: byte-identical, 314/314. `RagdollProfile.kneeFlexionStopDeg` (`withKneeStop`):
  the knee hinge's upper limit lowered to the stop (the hinge's 150 otherwise), widened to where a conversion starts the
  knee and closing with it; a fall-response knee target is held at the stop in force. **Not flipped** (assessment
  `.scratch/ladder/assess-8f/`, README there). Knee time past 150 127.5 -> 0 / 0.03 player-s at 140 / 145 (L4 103 s), but alone
  the load moves to the unlimited hips: impossible 258.7 -> 297.1 (140; L3 51 runs up, 19 down) / 277.0 (145);
  implausible or worse 581 -> 493 / 472; energy 145 837 solves 5318 J (largest 160), 140 917 / 5504 (107). The twinned
  events are reached, not caused (the 145 L4 ceiling row L4-F10-wrap-on reversed D 162.1 W, a 78 J pinch rebound, a
  61 J impact rebound with 54 J in the off twin): no knee-stop rebound. Fallout at 145: 22 suite failures (13 by
  construction, 9 behaviour or natural samples not twinned), 4 who-falls changes. With the hip stops and PGS 4 the trade
  is gone: hips + PGS 4 + knee 140 impossible 5.9, implausible or worse 19.6, deep own-body overlap 885 -> 461,
  1268 solves / 3792 J (largest 60 J, against 197 registered), no L4 ceiling row, 14 who-falls changes; knee 145 there
  8.4 / 25.7 / 1505 solves / 4720 J. The knee stop flips with the hips, at 140.
- **8g** landed off, two commits. `r8g-box-reading` (7062264, byte-identical, 315/315): the box reads Rapier's own measure
  per axis, 2 atan2(e_i, w), not 8d's 2 asin(e_i); they agree on one axis alone. Measured (tests/joint-stops.test.ts:
  the thigh driven along one reading from 15 combined poses halts within 0.3 deg of each stop); the half-sine reading
  of the same halts is 24 at flexion 75 and 17.5 at flexion 110 for the adduction stop of 30. Resolves the 8e corner
  defect (below): the stop was not early, the reading was wrong. `r8g-hip-approach` (byte-identical, 323/323):
  `HipStopProfile.approach` (HIP_APPROACH_V1), a damped one-sided spring 10 deg inside each stop on the box reading, the
  torque along the reading's gradient; passive as stepped (the spring read at the depth the substep ends at, the damper
  capped at what stops the rate in one substep); a hip built inside a band starts with a slack that decays. HIP_STOPS_V2
  (the 8d box with the zone) for L3/HC; on L4 HIP_STOPS_L4_V1, a backstop whose zone starts 5 deg past the envelope's
  range plus tolerance (stops 149 / 59 / 82 / 65 / twist 70); `hipStopsFor` picks. A fall-response hip target is held
  inside the zone. Tests tests/hip-approach.test.ts: the rig (each stop, the zone stops the thigh over 3 deg short with
  under 10% of its energy; stops alone at the stop), passivity over six entry phases (under 1e-4 of E0; read at the
  substep's start, over 1%), the slack, the backstop inert on L4-F1-hipSwing, -hipTwist and L4-F2-side-off (byte-identical
  but for the id; L4-F2-model-side-off differs under any stops: the model hip frame's `setFrameX1` alone moves floats).
  The rebound twin from `L4-F2-side-off~hipsv2@12` (0.200 s): stops alone 4 injecting solves, 10.7 J (solve 71
  +4.19 J with no contact, the hip on adduction 30 after losing 6.5 and 7.7 J); with the zone none over 0.5 J (largest
  0.001 J), the hip 8.2 deg short of the stop.
- **8h** (`r8h-lab-params`) landed: byte-identical, 325/325; lab only. `hips=on|v1|off` (on is now `hipStopsFor`, the
  stops as they would flip; v1 the 8d box alone), `pgs=<n>` (0-16, 0 none) and `knees=off|140|145`, composed in that
  order and named in the label: `?fixture=L3-F9-convert-free&hips=on&pgs=4&knees=140` is the 8i variant to the profile
  id (tests/lab-params.test.ts).
- **8i** (the visible flip: hip stops via `hipStopsFor`, PGS 4, knee 140 on every L3/L4/HC ragdoll): **not flipped**,
  waits for the user's lab review (assessment `.scratch/ladder/assess-8i/`, README there; patch
  `.scratch/ladder/parked/visible-flip/`). Impossible ragdoll time 258.7 -> 5.4 player-s (L3 1.0, L4 0.9, HC 3.6),
  implausible or worse 581 -> 75.6 (L3 4.1, HC 6.7, L4 64.8: hip adduction and abduction the L4 envelope admits, past
  the implausible margin), knee past 150 127.5 -> 0, deep own-body 885 -> 504; injecting solves 882 -> 470, 5006 ->
  1955 J, largest 197 -> 80.8 J (a pre-existing impact rebound reached, L3-F1-phase2 reversed D: 97 J off from the same
  state). G/L1/L2/RH byte-identical, 134 summaries changed, no leg or L4 matrix row over the ceiling. The passive-energy
  test's assertions hold (largest 0.001 J); its contact-free sample falls to 7 under its floor of 10 (PGS 4). Suite: 29
  failures, 19 by construction (re-pinned in the patch with `preFlip`, tests/runs.ts), one pre-existing mechanism
  reached (HC-F3-falling reversed D, below: a tracked defect in the patch), 9 tests moved or changed by the variant,
  each twinned (README): natural samples to pin to `preFlip` as at 7d, the passive-energy sample, and one behaviour
  change for the user (L4-F5-onePalm-on loses its right palm hold to the knee stop, and the allocation floor with it).
  Who falls: 18 runs over 13 fixtures change (README), 4 of them a conversion now rejected, the player left a rigid
  falling proxy (HC-F3-falling reversed D, HC-F5-strictTransfer D both orders, L3-F1-phase4 reversed D), each a posed
  leg in R's ragdoll at D's conversion and each rejected the same by the registered profile from the same state. Open for the user: the L4 envelope's
  range against the human one (keep it with the backstop, narrow it, or the box on L4). User (lab review): the fixed
  joints look much better; the changed outcomes, the onePalm hold loss included, accepted; knee stop 140.
- **8j** (`r8j-thigh-met`) landed off: byte-identical, 329/329. Mechanism (`THIGH_MET_AT_CONVERSION`, below): a
  conversion is tried once; a rejected player is never queued again (`!pl.rag && !pl.handoff`) and stays the falling
  proxy to the end, and with a handoff record its shown pose is no longer guarded (`handoffPossible` false), so its legs
  sink 2-9 cm into R and out again. An unguarded candidate is valid 5-22 substeps later. Fix:
  `RagdollProfile.conversionRetry` (CONVERSION_RETRY_V1: reasons `externalPenetration` only, window 0.25 s, about 3x the
  longest measured clearance): such a candidate is deferred (`handoffDeferred`, `PlayerRuntime.deferred`, no handoff
  yet, so the pose guard keeps working) and tried again at each substep boundary with its own trigger; past the window
  the rejection is final, recorded with `deferred: {t, step, tries}`. Structural reasons (anchors, landmarks, hinges,
  floor) stay final at once. Not a tolerance change: the accepted candidate passes the same 1.5 cm check. On the four
  8i captures (`tests/conversion-retry.test.ts`, `--flip8i` captures): HC-F3-falling reversed accepted after 1 retry
  (cand 1.18 cm, depth after 1.11), L3-F1-phase4 reversed after 11 (1.20 / 0.96), HC-F5-strictTransfer both orders
  transferFailed as registered after 6 and 4 (the strict audit, its intent: D's rejection was not its contract); D and R
  passive energy after the switch at most -0.03 J; the fault twin (tolerance 0.1) converts the first candidate, 1.56-3.41
  cm deep. Under the registered profile it also converts the three `LEG_IN_RAGDOLL` captures (1.313-1.333 s). Lab
  `retry=on|off`.
- **8k** (`r8k-l4-hips`) landed off: `hipStopsFor` gives every ragdoll the 8d box with the zone (HIP_STOPS_V2), L4 too,
  in place of the 8g backstop outside the L4 envelope (HIP_STOPS_L4_V1, kept: the 8i assessment's L4 stops, lab
  `hips=l4`; `hipStops8i` in tests/runs.ts keeps `flip8i` the 8i variant). Chosen by evidence over the envelope narrowed
  to the human range (`.scratch/ladder/r8k-choice/`, L4 rows under the 8i variant with the retry): L4 implausible or
  worse 64.8 -> 3.7 (hips 0; narrowed envelope 2.5), deep own-body 332 -> 134 (narrowed 248), own-leg axes 201 -> 63
  (154); the narrowed envelope inside the box adds nothing (134 / 74), so its shaping has no visible benefit; parked
  with its fits (`parked/l4-hip-envelope-narrowed/`). Cost: L4 injecting solves 129 / 372 J / largest 15.4 -> 152 / 649
  / 52.4 (narrowed 137 / 436 / 39.0); the two largest are impact rebounds reached (same-state twins with every hip stop
  opened: L4-F9-free from 0.600 s 41.5 against 41.2 J, L4-F9-exit reversed from 1.267 s 52.75 against 52.35). The L4
  envelope's hip lies outside the box on every axis and takes no load under the stops (8e); it still bounds the fall
  response's hip targets. No who-falls change against the variant with the backstop. Test (tests/l4-hip-box.test.ts):
  an L4 leg swung at 4 rad/s toward where the envelope reads its largest ab/adduction stops at 22.6 adduction and 40.7
  abduction under the box, at 51.3 and 61.2 under the backstop (fault twin; margins 45 and 60).
- **8l** (the visible flip re-assessed with 8j and 8k: hip stops via `hipStopsFor`, the box on L4 too, PGS 4, knee
  140, the deferred conversion): **not flipped**, ready (assessment `.scratch/ladder/assess-8l/`, README there; patch
  `.scratch/ladder/parked/visible-flip/flip.patch` on 44dbab1). Against 8k: impossible 258.7 -> 8.7 player-s (8i 5.4),
  implausible or worse 581 -> 17.7 (8i 75.6; L4 64.8 -> 3.7, no hip), deep own-body 885 -> 326 (8i 504), own-leg axes
  418 -> 108; injecting solves 882 -> 494, 5006 -> 2243 J, largest 80.8 J (8i's). The rise over 8i: HC impossible
  3.6 -> 6.6, one run (HC-F5-strictTransfer, D now converts and lands on R, whose right shoulder stays twisted past its
  range from 2.9 s), and L4 energy 371 -> 649 J (8k's impact rebounds). Rejected conversions 19 -> 16, every one a
  fixture built to be rejected. G/L1/L2/RH byte-identical, 135 summaries changed, no matrix row over the ceiling,
  highest query tick 3749. Knee 145 read too: implausible 13.2 but own-body 394 and a 67 J L4 gain; 140 stays. Suite
  under the variant 34 failures: 22 by construction, 2 of the retry's own construction (the constructed thrown head's
  fault twins are deferred, then taken), 10 moved (13 readings), each twinned, repaired per the 8i rulings (natural
  samples `preFlip`; the HC-F2-bothFall window re-measured, +17 on the right forearm; the onePalm brace and the
  allocation floor encoded as accepted changes; the passive-energy drop raised 0.5 m) and one rule in place of a
  sample (L4-F12 mirror: the landing palm now reaches the floor in both falls). With the patch: 330/330, every matrix byte-identical
  to the variant. Who falls against 8k: 17 player-runs over 12 fixtures, against 8i only the seven rejections now
  converting. Brace outcomes moved by the box on L4: L4-F12 base and mirror and L4-F3-oblique-on land a palm,
  L4-F3-side-on misses tooFar (each late before).
- **8m** (`r8m-visible-flip`) landed: the visible flip registered on every L3/L4/HC ragdoll (`visibleFlip` in
  src/sim/fixtures: `hipStopsFor`, PGS 4, knee 140, the conversion retry; `preFlip` in tests/runs.ts is the profile
  before it). 332/332. Against the 8l assessment run (`assess-8l/flip-patch/`) every summary, trace and matrix is
  byte-identical; only the suite count differs (two tests added). Against 8k: G/L1/L2/RH byte-identical, 135 summaries
  changed (L3 44, L4 70, HC 21), 10 end-representation changes (the 8l who-falls list), no matrix row over the ceiling,
  highest query tick 3749. Per family, player-s impossible / implausible or worse / own-leg axes / deep own-body: L3
  1.00 / 4.10 / 21.9 / 110.5, L4 1.13 / 3.69 / 62.7 / 134.2, HC 6.58 / 9.87 / 23.6 / 81.5 (by DOF: shoulder rotation
  5.7, hip rotation 3.0 impossible); knee stop 0 everywhere; injecting solves / J / largest L3 217 / 1083 / 80.8, L4
  152 / 649 / 52.4, HC 125 / 511 / 51.8. Two changes over the 8l patch, from its review: (1) the allocation row in
  falls.test.ts no longer counts scaled substeps against a floor (50 at 10c, 20 since plan 12; 29 before the flip, 13
  under it, the onePalm free arm's brace gone): it computes the pre-10c joint allocation from each substep's own
  demands as its fault twin, which must differ from grasp first somewhere in the sample and only where the budget
  scaled the effort (under the flip it differs at 13 substeps, all L4-F6-break, by up to 31% of the hold's tension;
  with arms.ts reverted to the joint rule the row fails at L4-F6-break D 269 left, 210.04 against 212.99 N). (2) The
  HC-F5-strictTransfer shoulder reading is `SHOULDER_POLE_TWIST` (open defects, test tests/shoulder-pole.test.ts on the
  capture `HC-F5-strictTransfer@165`), not the loaded-limb class: the arm is at rest overhead with only the floor on it,
  so 7f's rule (which reads the envelope's faded excess) does not apply. Lab test: `hips=off&pgs=0&knees=off&retry=off`
  on a registered fixture is `preFlip` and runs as it; `hips=on&pgs=4&knees=140&retry=on` is the registered profile.
  The parked hip-stop, knee-stop and visible flips are applied (their scratch dirs kept). The 8l same-state twins ran
  L3/HC ragdolls without the shoulder envelope (the twin script's profile reset, fixed at 8m, see
  `assess-8l/tools/worktree-scratch/README.txt`); its whole-run twins and every repair's reading stand.
- **9a** (`r9a-own-leg`) landed off: byte-identical, 342/342. `RagdollProfile.selfLegs` (SELF_LEGS_V1, `withSelfLegs`,
  `withoutSelfLegs`; SELF_LEG_KEY in src/sim/ragdoll.ts): a ragdoll's legs meet each other, and its shins and shoes its
  trunk, by plan 11's pattern. Each leg has three massless self shapes at its segments' origins (mass properties
  bitwise): the thigh's distal half to the knee (its radius less the 1 cm skin, at most 11 cm), the shin from knee to
  ankle (radius less the skin) and the shoe box less the skin, turning with the limp foot. No jointed pair (a thigh and
  the trunk, one leg's own shapes). The pairs are grouped by their two segments; a group with any pair deeper than the
  skin when the ragdoll is switched in stays out of the solve until none is (`holdOverlappingSelfLegs` at the
  conversion, `releaseSelfLegs` every substep). The impact guard reads the pairs; their shape queries are culled by a
  capsule about each shape. Why so: the skin leaves resting contact of the drawn shapes free of force (standing, the
  authored body's thigh shapes are 7 cm apart; bew-v6's knees touch at its idle stance and take no force); the thigh
  shape is distal and capped because bew-v6's mesh-fit thighs (14.6 cm) lie against each other from the hips down;
  groups, not pairs, because holding single pairs let one pair of a crossed group take force while its neighbours
  still overlapped, and legs switched in crossed stayed locked crossed (explored in `assess-9c/explore/`). Tests
  (tests/self-legs.test.ts, capture `HC-F1-at0.9@53` before both conversions), each with its fault twin: no fixture
  registers it; mass properties bitwise at the switch; the filter passes the pairs to their own ragdoll only and the
  contact records never see them; a hip-driven crossing on the authored and the model body, either side, stops at the
  skin with no injection (off: over 10 cm deep); the impact guard sees the pairs; standing and lying at rest take no
  impulse; groups held at the switch give no kick and are released within the skin; no injection on the resumed
  capture. With the flag on every L3/L4/HC ragdoll (exploration, matrices only; 9c measures it): deep own-body 326 ->
  169 player-s, own-leg axes 108 -> 23, injecting solves 494 -> 458 (2243 -> 2032 J); highest query tick 4036
  (L3-F1-phase4 reversed: the supported player's pose queries against the moved ragdoll).
- **9b** (`r9b-lab-selfleg`) landed: byte-identical, 343/343; lab only. `selfleg=on|off` (own-leg contact,
  SELF_LEGS_V1), composed after `retry` and named last in the label and the id: `?fixture=HC-F1-at0.9&selfleg=on` is
  the 9c variant (tests/lab-params.test.ts).
- **9c** (`assess-9c`, README there; not applied): own-leg contact on every L3/L4/HC ragdoll, PGS 4 kept. Against 8m,
  player-s impossible 8.71 -> 5.01, implausible or worse 17.66 -> 12.24, deep own-body 326 -> 169 (leg on leg 161 ->
  18; arms on the trunk 114 -> 102 remain), own-leg axes 108 -> 23; injecting solves 494 -> 458, 2243 -> 2032 J
  (largest 80.1). PGS 2 and 8 with it read implausible 19.5 and 19.9, energy 2687 and 2287 J: PGS 4 kept. G/L1/L2/RH
  byte-identical, 128 summaries changed; leg matrix none over the ceiling; L4 matrix 4 entries over (the power defect
  below); one query tick over 4000 (below); CPU +6%. Who falls: 10 player-runs, all D, each moved by R's fall (list and
  lab links in the README and the parked patch's morning-review text). Suite under the variant 315/343: 24 by
  construction (captures and `preFlip` samples now carrying own-leg contact, registration tests), 4 behaviour, each
  twinned from the variant's state with own-leg contact on and off (the twin script checks every resumed ragdoll's
  profile): two defects reached (`IMPACT_OVER_POWER`, `BRACE_EXPIRED_OBSTRUCTED`, below), HC-F2-bothFall's window
  re-measured (+18, the same contact), hip-approach's backstop case run on `preOwnLegs` (no fixture takes the L4
  backstop since 8k; with own legs L4-F1-hipTwist's legs press the twisted hip 0.03 deg into its band at 3.12 s). Every
  large new injection is the same from a state just before it with own-leg contact off. Seen in the runs: legs switched
  in crossed stay through each other until they part (7 short L3 runs end first); L3-F3-collision reversed D comes to
  rest propped on its own leg, 21 cm higher; on a resting L3-F9-noProbe-free R a leg slides off the other; no jitter at
  rest; L4's remaining axes time is thighs lying together 1 mm inside the meter's threshold (no proximal thigh shape).
  Building the shapes alone moves a run (8 new colliders reorder Rapier's contact graph: L4-F10-knee-on with every
  own-leg pair refused equals the variant, not 8m). Flip patch `.scratch/ladder/parked/own-leg-flip/` (345/345, its
  full check equal to the variant's): applied at 9d.
- **9d** (`r9d-own-leg-flip`) landed: own-leg contact registered on every L3/L4/HC ragdoll (`ownLegFlip` after
  `visibleFlip` in src/sim/fixtures; `preOwnLegs` in tests/runs.ts is the profile before it, `preFlip` before both),
  PGS 4 kept, the parked patch as assessed. 345/345. Against the 9c assessment run every summary, trace and matrix is
  byte-identical (`assess-9c/variant/`, `flip-patch/`); against 9b G/L1/L2/RH byte-identical, 128 summaries changed (L3
  41, L4 66, HC 21), the 10 who-falls player-runs of 9c, leg matrix none over the ceiling, L4 matrix the 4
  `IMPACT_OVER_POWER` entries, one query tick over 4000 (open defects). The lab's before-views run as the earlier
  registrations on all 195 L3/L4/HC ragdoll fixtures: `selfleg=off` as 9b, `hips=off&pgs=0&knees=off&retry=off&selfleg=off`
  as 8k (`r9d-own-leg-flip/lab-views.txt`).
- **9e** (`r9e-brace-expired`) landed: `BRACE_EXPIRED_OBSTRUCTED` fixed. A brace still seeking when the response's
  window ends is missed `obstructed` when its forearm or palm pressed on another body or an obstacle within the
  shortest horizon (plan 10c C4), as on the core-down path; `expired` otherwise. No profile flag: the change is the
  event's reason only (nothing reads it but the tests), and only two traces change (L4-F5-twoClamp-on and L4-F9-both,
  D right at 2.2 s); summaries, every matrix and the query counts byte-identical. The capture test
  (tests/fall-defects.test.ts, `L4-F5-twoClamp-on@126`) now passes as the fix's test, own-leg contact on and off; fault
  twin, the window's end without the obstruction record, `expired`. The scoped exception in falls.test.ts is gone. One
  constructed case moves with it, the raised deck of plan 10c C3 (`ground is the floor only`): its brace's forearm
  presses on the deck, an obstacle, in the substep the window ends (`r9e-brace-expired/deck.txt`), so its miss is
  `obstructed`, no longer `expired`; the test now reads the press and the rule (no brace contact, the C3 point, kept).
- **9f** (`r9f-impact-power/off`) landed off: byte-identical (every file, query counts too), 345/345.
  `IMPACT_OVER_POWER`'s mechanism, from the capture `L4-F3-run-on@96`: not a landing the guard missed. D's core lands
  (1.604-1.613 s, 14 and 30 N s on the floor) and swings its right forearm into its own trunk; the guard sees it closing
  at 4.2 and 3.6 m/s (substeps 389, 390) and holds that arm only (plan 11: an own-trunk hit is the arm's, "the core, far
  heavier, is not held for it"); the solve takes 40 N s through the trunk (own legs off 38), the core turns 1.7 rad/s,
  the hips' relative speed jumps 2.4-3.0 rad/s and the left knee's 2.5, and their effort realizes 183 W (off 169).
  `impactGuard.selfTrunkBody` (`withSelfTrunkBody`, no fixture uses it): a limb's own-trunk pair (plan 11's forearms,
  9a's shins and shoes; never leg on leg) closing faster than `bodyClosingMPerS` holds the whole body, as a hard hit on a
  core-jointed segment does (plan 14): the trunk it strikes is the core. `closingSpeeds` writes those closings to an
  optional map (no extra query). From the capture: 183 -> 137.4 W, nothing over the cap (own legs off 169 -> 128.2),
  the body held 3 substeps more. Tests: the capture test (fall-defects) adds the flag's row and reads the hit (the
  forearm's own-trunk closing over the body speed, the hips and knees commanded without it, nothing with it); the
  self-legs guard rig: with only the trunk pairs in the solve the legs' closings are the own-trunk map's, with only the
  leg-on-leg pairs it is empty (fault twin, leg on leg written there: 12 readings). The flip (the hold on every L4 fall
  response) is parked, not clean (`r9f-impact-power/flip`): only L4 moves, no who-falls change, but L4-F3-run-on D is
  still one substep over the cap (187.6 W). The hold first acts at 1.471 s, which moves the run; at 1.625 s it holds the
  body as intended, and the forearm's hit lands in the next solve, read at 1.62 m/s (under the body speed) while the
  solve takes 49.8 N s. From that state the hold off gives 180.5 W there: the same mechanism, reached.
- **9g** (`r9g-housekeeping/check`) landed, byte-identical in every summary, trace and matrix, 346/346. `LEG_IN_RAGDOLL`'s
  live exception in tests/l3-pass.ts (empty since 8m) is retired; its three captures' tests in l3-contracts stay, as the
  pre-flip record of the rejection and the twin of rung 6's physical legs converting the same states. The query peak:
  the candidate validation's depth queries (ragdoll.ts `depthAgainst`, 1344 of the 4036, run every substep while a
  conversion is deferred) are culled as plan 13a's are (exact: a pair beyond the query's prediction returns nothing).
  Every row's worst tick falls or stays (69 fall), none over 4000 (highest 3423, L3-F7-mirror50). Guard: a capture test
  (harness, `L3-F1-phase4~rev@76`) runs D's deferred conversion beside R's ragdoll (ticks 78-81) and needs every tick
  under the budget: 2771 at the old peak; fault twin, the cull removed, 4036.
- **10a** (`assess-10a`, README there; not applied): `LEG_GUARD_V3` on every fixture with a leg guard (L3/L4/HC) at
  9g. Suite 322/346: 22 by construction (V1 captures, registration, a V1 natural sample in lab-params), 2 natural
  samples reached (falls.test L4-F4-occupied's brace row, the twoPalm hold exposure; V1 from the state just before
  gives the same). G/L1/L2/RH byte-identical; 88 summaries changed; leg matrix none over; L4 matrix 4 -> 1 over
  (L4-F9-low reversed R, `IMPACT_OVER_POWER` reached, below); worst query tick 3588; CPU +10%. Supported leg inside a
  ragdoll L3 1.83 -> 0.38, L4 2.12 -> 0, HC 0.67 -> 0.2 player-s (what is left at most 2.3 cm for 0.15 s); wedges and
  leg reversals in contact fall; chatter at most 3 substeps. supSelfLegAxS L3 8.91 -> 12.54 is V2's (the same under V2
  with the proxies' paths equal to V1's, e.g. L3-F6-hold R's thighs 4.0-5.0 s). Passive energy L3 1013 -> 808 J, L4
  552 -> 531, HC 467 -> 423; every new or larger gain the same from a state just before it under V1. Who falls: 17
  player-runs, all D, each from a real contact on its physical leg (list and links in the README). One mechanism
  introduced: a proxy over a refused surface kicked up 28.7 cm by its own leg (fixed at 10b). Split by family isolates
  nothing (every family has who-falls changes): one step.
- **10b** (`r10b-d2-refused`) landed: D2 (`physicalLegsLive`) needs probe status `ok` within travel; over a refused
  surface or normal the legs are off. Off everywhere (only V3 has physical legs): byte-identical, 347/347. Capture test
  (physical-legs, `L3-F9-noProbe-prep~v3@33`): 134 refused substeps, none live, no leg impulse; fault twin
  (`PoseDebug.legsOnRefused`, the rule before): live in all 142, 170.8 N s, D rises 28.7 cm against 13.9.
- **10c** (`.scratch/ladder/parked/v3-flip/`, README there): the flip patch. 348/348; its full check
  (`assess-10a/flip-patch/`) equals the assessed variant except where 10b acts (L3-F9-noProbe-prep, -contact, -exit);
  who falls the same 17. `preV3` (tests/runs.ts) pins V1 captures and natural samples; `IMPACT_OVER_POWER` on L4-F9-low
  reversed R becomes a capture test. Applied at 10d.
- **10d** (`r10d-v3-flip`) landed: `LEG_GUARD_V3` registered on every fixture with a leg guard (`legFlip` after
  `ownLegFlip` in src/sim/fixtures), the 10c patch as assessed. 348/348. Against the assessed run
  (`assess-10a/flip-patch/`) every summary, trace and matrix is byte-identical. Against 10b: G/L1/L2/RH byte-identical,
  88 summaries changed (L3 46, L4 27, HC 15), the 17 who-falls player-runs of 10a, leg matrix none over a ceiling, L4
  matrix 4 -> 1 over (L4-F9-low reversed R, tracked), worst query tick 3423 -> 3588, passive energy L3 1013 -> 804 J,
  L4 552 -> 531, HC 467 -> 423; supported leg in a ragdoll L3 1.83 -> 0.45, L4 2.12 -> 0, HC 0.67 -> 0.20 player-s;
  ragdoll own-leg axes L4 16.7 -> 21.7 (most of it L4-F9-transferFailed reversed R, 0.18 -> 4.35 s, assessed at 10a);
  full check 336 -> 377 s. Lab: the 8m before-view test (lab-params) adds `legs=v1`, with the view without it as its
  twin (the leg guard stays V3); every L3/L4/HC fixture's before-views run as the earlier registrations
  (`r10d-v3-flip/lab-views.txt`: `legs=v1` as 10b, `legs=v1&selfleg=off` as 9b, with `hips=off&pgs=0&knees=off&retry=off`
  too as 8k, 195/195 each).
- **10e** (`r10e-exceptions`) landed: byte-identical (every summary, trace and matrix), 349/349; tests only. The two
  live exceptions that set nothing aside since 10d are retired, each with a fault twin that puts back what it excluded.
  `IMPACT_OVER_POWER` (falls.test, L4-F3-run-on D and L4-F9-free D): the power audit is one function (`powerAudit`) with
  no exception; on L4-F3-run-on under LEG_GUARD_V1 it fails at D's landing (one substep over the cap, an impact), and
  the registered run passes it. `HOLD_CLEARANCE_REPLANT` (l3-pass, L3-F6-hold and -holdMirror): the hold check counts
  every plant after 3.5 s; under V1 the clearance re-plants fail it (2 and 3, l3-contracts), the registered holds pass;
  the predicate (`replants`) reads the pre-flip captures only.
- **10f** (`assess-10f`, README there; not applied): 9f's own-trunk hold on every L4 fall response, re-assessed under
  V3. Only L4 moves (17 summaries, 46 traces), no who-falls change, the L4 matrix 1 -> 0 over (L4-F9-low reversed R
  161.5 -> 132.9 W); suite 341/349, the 8 by construction. Not clean: from the same state the hold, acting by its rule
  on closings that breach nothing, makes three runs worse. L4-F9-prep R's arm stays deep in its trunk 1.52 s against
  0.48 (the hold at 0.892 s, its forearm on the trunk at 14.3 m/s); L4-F9-exit reversed R gains 1.73 J in a pinch solve
  five substeps after a hold on a 2.02 m/s closing (none without); L4-F4-obstructed R's rebound solve 1.27 J against
  0.81. Kept parked; the parked README says what the fix needs (below, `IMPACT_OVER_POWER`).

Rungs 5-7 are interleaved in the `pose.ts` leg loop and `poseClearanceOf` in the old tree; they are re-expressed in
order, not hunk-split.

## Parked

- `ARM_CLEARANCE_V1` and the arm sweep: dormant and untested in the old tree; M3 reworks the wrap arms.
- Shoulder twist 1000/3: traded one power breach for another and masked the head-plant test.
- The pushed-target clamp from `arm.patch`: raised reversals on trapped arms.
- D4/D5 footwork: reverted (see the handoff's known issues).
- 9f's flip, the own-trunk hold on every L4 fall response: at 9f it fixed the captured landing but the run reached the
  same hit a substep later, read before the solve far under what the solve took; at 10f (under V3) it removes the last
  L4 breach but makes three runs worse from the same state (a limb released into its trunk, two solves' energy). Patch,
  twins, states and README `.scratch/ladder/parked/self-trunk-flip/`; the 10f evidence `assess-10f/`.
- 8k's other option, the L4 hip envelope narrowed to the human ab/adduction (cone across 60 -> 42, its own backstop):
  removes the hip implausible time as the box does but not the own-body overlap; not taken. Patch and README
  `.scratch/ladder/parked/l4-hip-envelope-narrowed/`.

## Open defects to test on the ladder

To be reproduced on the first rung where they appear, then handled under rule 7:

- Found at 9c, registered with the own-leg flip at 9d (capture tests in tests/fall-defects.test.ts), each reached by a
  moved trajectory, the same from the state just before with own-leg contact off. `IMPACT_OVER_POWER` (open; its live
  exception in tests/falls.test.ts retired at 10e): L4-F3-run-on D (and L4-F9-free, the same run) lands at 1.625
  s with its hip and knee effort acting, one substep over the power cap (183 W; off from 1.60 s 169 W), tagged an
  impact; held off in that substep, nothing is over. The forearm's own-trunk hit is held as the arm's only; 9f's
  `selfTrunkBody` (off) fixes that landing, but registered the run reaches the same hit one substep later, read before
  the solve at 1.62 m/s against 49.8 N s taken (parked). Under the V3 flip (registered at 10d) L4-F3-run-on no longer
  reaches it; the one instance is L4-F9-low reversed R (161.5 W at 1.0875 s, its right forearm's own-trunk hit; the same
  under V1 from 0.833 s, `selfTrunkBody` fixes it), the flip patch's capture test. Re-assessed at 10f: on every L4 fall
  response the hold removes that instance but releases the body on closings that breach nothing (three runs worse from
  the same state). Next: read an own-trunk hit from what the solve will take (the pair's penetration or pinning, or its
  predicted impulse), not its closing; test, the hold at `L4-F9-low~rev@50` and `L4-F3-run-on@96` and not from the
  three 10f states (`parked/self-trunk-flip/10f/`). `BRACE_EXPIRED_OBSTRUCTED` (resolved at 9e):
  L4-F5-twoClamp-on D right (and L4-F9-both) missed `expired` at 2.2 s while pressed on R's shin; the end-of-window
  path did not read the obstruction the core-down path reads. Query peak (resolved at 9g): L3-F1-phase4 reversed, 4036
  in the tick at 1.317 s (8m 3749), D's deferred conversion validated unculled beside R's ragdoll.

- Self-trunk pinch: a ragdoll forearm pressed into its own trunk by the floor gains 7.5 J in one solve
  (L4-F9-contact reversed R; read by the audit as 172 W). Suspected solver energy injection. Reached with V3 on at rung
  7: the same run, R 172.4 W at 1.125 s, its right forearm on the floor (94.7 N s in one substep); from 1.05 s
  (`r7-triage/captures/L4-F9-contact~v3-rev@63`) the twins with the legs, rung 7 or `carried` off give the same 172.4 W:
  reached by the moved trajectory. Tracked defect with a seeded test at the flip. At 8a: the seeded test
  (tests/ragdoll-iterations.test.ts, `L4-F9-contact~v3-rev@63`) reads +7.70 J at solve 270, and -5.87 J with 3
  additional PGS iterations on R's segments (the 8a field, off).
- Brace rebound (tracked at 8a, not fixed): L4-F9-contact as registered (V1), R's left palm lands on the floor: solves
  249 and 250 (1.0375, 1.0417 s) take 135 and 244 J out, solve 251 gives 73.0 J back with only that palm on the floor
  (22.1 N s) and no other player touching; the solves after it are contact-free. The largest class of the 7g matrix
  (rebound: 689 solves, 4590 J). Seeded test tests/ragdoll-iterations.test.ts on `L4-F9-contact@61` (1.017 s): the
  rebound as is; one additional PGS iteration on R's segments from the capture and solve 251 loses 5.8 J (+3: -9.8,
  +10: -12.0; the impact's two solves still take about 350 J out).
- Posed thigh held 1.0-1.45 cm inside a ragdoll pelvis for 15 substeps with every clearance loop capped
  (L4-F10-wrap-on D). At rung 7: 24 substeps over 1 cm (longest run 12, deepest 2.14 cm), reversed 29; under V3 none.
  Resolved by the flip.
- Resolved at 7f (the check, not the physics): shoulder persistence under a loaded forearm (L4-F9-exit, L4-F3-run-on).
  Reached with V3 on: L4-F3-run-on R right shoulder past the tolerance 0.2875 s (1.25-1.54 s, up to 7.6 deg) with R's
  right forearm and upper arm on the floor throughout; from 1.10 s (`L4-F3-run-on~v3@66`) all twins give the same run.
  The excess is the load's static deflection (190 / 1500 N m/rad); the loaded-limb rule passes it (L4-F9-free R too).
- Resolved by 8j and the 8l flip (exception retired at 9g): posed leg held inside another player's ragdoll, the
  conversion then rejected (tracked from rung 3, `LEG_IN_RAGDOLL` in tests/l3-pass.ts): D's posed legs 2-6.6 cm inside R's ragdoll core for 8-25 substeps before D's conversion,
  rejected for external penetration: L3-F4-oneArm and L3-F1-phase2 (right thigh in R's pelvis, 4.28 cm at 1.304 s),
  L4-F10-wrap-off (right thigh in R's torso, 5.34 cm at 1.300 s). Controlled twin: rung 3's change off from 1.0 s (the
  same state) gives the same rejection to the last digit. Probably the deeper form of the L4-F10-wrap-on entry above.
  Resolved under V3 (rung 6: the three captures convert); tracked under V1 until the flip. Under the 8i visible flip
  (no test fails): L3-F4-oneArm and L3-F1-phase2 still rejected (2.59 cm), but from the flipped state at 1.167 s the
  run is 3 substeps, and V3 from it rejects too (right thigh 3.26 cm in R's pelvis at 1.333 s), so the captures stay
  the pre-flip state (`preFlip` in the patch). Newly reached, the registered profile rejecting the same from the same
  state: L3-F1-phase4 reversed D (right thigh in R's pelvis, 6 substeps, 2.71 cm at 1.300 s; V3 converts),
  HC-F5-strictTransfer reversed D (left shin in R's right thigh, 13 substeps, 3.42 cm at 1.246 s; V3 transferFailed as
  registered), HC-F5-strictTransfer D (right thigh in R's pelvis, 3 substeps, 3.37 cm at 1.288 s; V3 rejects too).
  The 8j deferred conversion converts all of them (registered captures and 8i captures), and under the 8l flip every
  one converts in its run; the tracked captures stay the pre-flip state (`preFlip`). Since 8m (the flip registered) no
  registered run is rejected so; the live exception was retired at 9g, the captures' tests kept as the pre-flip record.
- A held player's planted foot released by its clearance solve (plant drift just over 1 cm on clearance variant 1) and
  planted again every 0.2-0.6 s in a stationary hold (tracked from rung 3, `HOLD_CLEARANCE_REPLANT`): L3-F6-hold R left
  (2 plants after 3.5 s), L3-F6-holdMirror R right (3) and D left (1). Controlled twin: rung 3's change off from 3.0 s
  keeps the cycle (L3-F6-hold 2 plants, holdMirror 3 R plants). Resolved by rung 7 (V2/V3), registered at 10d; the
  live exception retired at 10e (its captures' tests kept as the pre-flip record).
- Resolved at 7b: knee-pole exit at a swing start (V3, rung 7): a planted leg held at a knee pole because its primary is in a body the
  legs meet leaves it for clearance alternative 9 in the substep its swing starts (the planted pose applies to plants
  only): the shown shoe moves 2.04 cm, over the transition audit's 1 cm (L3-F4-gripOwner R left 1.7125 s, right ankle
  1.31 cm at 2.083 s). From 1.60 s (`L3-F4-gripOwner~v3-audit@96`) the twin with the legs off and the twin with rung 7
  off are both under 1 cm. Fix before the flip (rung 7b, small): a leg leaving a plant at a knee pole keeps the pole
  candidates, bounded by continuity, until an ordinary one is reachable. Rung 7 off, V3 has its own owner-change
  breaches in the same family (L3-F4-gripTarget D 1.14 cm, L3-F4-gripOwner R 1.33 cm): to check against the fix.
- Resolved at 7c (L3/L4/HC; G/L1/L2/RH keep the old reading): stale impulses in the contact records and the leg
  ledger: both read every manifold point's impulse; a point that was not solved in a substep (one outside the pair's
  four solver contacts) keeps the last solve's value. L3-F9-noProbe-prep (V3) records
  D's shin on R's pelvis at 64.867 N s in three consecutive substeps while R's core changes speed by 2.02, 0.14 and
  0.05 m/s; repeated values add 181 N s to that run (V1: 11.4 N s), 47 N s to L3-F1-mirror4 (V1: none). Observation
  only, but the peaks and ledger totals used to judge contacts are inflated where it happens. A fix may move V1
  summaries that export contact impulses.
- A physical leg starting a solve inside another player's ragdoll: HC-F2-bothFallL2 reversed A's right thigh 1.52 cm in
  B's torso with load (0.979 s) and 3.19 cm in B's shin without (0.975 s), against `PHYS_LEG_OK` 1 mm. Read at 10a:
  the worst supported leg in a ragdoll under V3 is 1.85 cm (this run, A's right shoe in B's trunk at 0.683 s) and
  2.3 cm for 0.05 s (L3-F1-phase2 / L3-F4-oneArm D's left shin in R's shoe, 1.233 s); open, small.
- An unsupported proxy over a refused surface. Its legs: resolved at 10b (D2 needs an `ok` probe); under V3 before
  it, L3-F9-noProbe-prep D's shin kicked it up through R's pelvis, 28.7 cm. Open: the proxy's own rebound, D's pelvis
  falling onto R's shoe and bouncing 13.9 cm (0.917 s), the same from 0.750 s under V1 (12.85 cm); L3-F9-noProbe-free
  D (V3) bounces 24.2 cm at 1.1 s, the same from 0.667 s under V1. A rigid proxy rebounding off a ragdoll.
- Solved-impulse reading misses a solved contact among coincident manifold points (found at 7g; rung 7c's reading):
  L3-F1-phase6 reversed, solve 266, R's pelvis on D's support capsule: points 2-4 at one position (2.8 mm deep), one
  solver contact; Rapier wrote 15.53 N s to point 4, the nearest-point match gives the solver contact to point 2
  (raw 0), so the pair reads 0 (R's momentum changed 15.4 N s). The passive-energy meter reads max(solved, raw) for
  that reason. To check: which contact records and ledger rows read 0 for a real contact this way.
- Shape-query budget exceeded outside the budget test's two fixtures at `a6d712f`: HC-F5-invalidOne asks 4412 queries in
  one tick (unchanged by the rung 1 memo), L3-F7-mirror50 4028 before the memo and 3943 after. Resolved with the flags
  off at rung 5b (every leg-matrix run under 4000, counted by the full check).
- Hip-stop impact rebound (found at 8e under the 8d stops; the stops with the zone registered on L3/L4/HC since 8m): a thigh swing arrested by a
  stop is an impact through the hip, and the solves after it give part of the loss back. L4-F2-side-off R (response
  off, alone): the right hip reaches adduction 30 at solve 69, the body loses 6.5 and 7.7 J (69, 70), solve 71 gains
  4.19 J with no contact; the registered run never gains 0.2 J, and the same profile with every stop at 170 (set, never
  reached) is byte-identical to it. Additional PGS iterations 1 / 3 / 4 / 8: 2.8 / 1.9 / 2.0 / 1.8 J. Rapier 0.21's JS
  exposes no joint softness (only `contact_natural_frequency`). Resolved on the sample by the 8g approach zone (the
  capture regression test in tests/hip-approach.test.ts). Over the 8i matrix 65 injecting solves (174 J) have a hip at
  a stop and 207 (981 J) one in a zone, most of them rebounds after an impact (52 and 137); the largest gain (80.8 J,
  L3-F1-phase2 reversed D at 1.625 s) is 97 J with the variant off from the same state: impact rebounds reached. At
  8l (the box on L4 too) 85 at a stop (224 J) and 244 in a zone (1121 J), rebounds 394 of all 494.
- Resolved at 8g (7062264): box reading against Rapier's stop at combined poses. Rapier keeps 2 atan2(e_i, w) within
  each limit; 8d read 2 asin(e_i), which is smaller off a single axis, so the stop seemed to act early (L4-F2-side-off
  R's right hip at adduction 28.75 under 30).
- The L4 backstop cannot hold the envelope's corners: a twist t after a flexion f reads 2 atan(tan(f/2) tan(t/2)) on Z,
  59 at flexion 129 with twist 30, so there the Z stop (65, its zone from 55) meets a pose inside the envelope. Not met
  in the three L4 hip fixtures; not read separately at 8i (L4 impossible 0.89 player-s against 0.90 registered). Moot
  since 8k (the flip no longer takes the backstop); a swing toward 75 deg out enters its Z zone (tests/l4-hip-box).
- The L4 envelope admits more hip than a person (8i): adduction 45 and abduction 61.25 plus tolerance 5, past the
  implausible margins (45, 60). With the backstop outside it, L4 implausible time is 64.8 player-s at 8i (hip
  adduction 50.3, abduction 11.6; e.g. L4-F12-base R left hip at 0.70 s); the 8d box on L4 read 2.95. Resolved at 8k
  (off): the box with the zone on L4 too, registered since 8m.
- A posed thigh met by another player's ragdoll in the substep before the conversion, the conversion rejected and the
  player left a rigid falling proxy (the 13f known-limit class, gone at plan 14; tracked defect
  `THIGH_MET_AT_CONVERSION` in the parked 8i patch). Reached by the 8i flip: HC-F3-falling reversed D at 1.171 s, right
  thigh 1.57 cm in R's left forearm (palm), past the tolerance in one substep only. From 1.150 s
  (`HC-F3-falling~rev@69`, in the patch) the registered profile rejects the same (1.58 cm) and V3 converts; from
  1.100 s the registered profile and the flip without PGS 4 convert. The patch's regression test resumes that capture.
  Mechanism and fix at 8j (the deferred conversion, off): in the 8l flip, under which the case converts (1.183 s), so
  the patch no longer carries the tracked defect.
- A ragdoll arm at rest at its swing pole keeps its twist (tracked defect `SHOULDER_POLE_TWIST`, found at 8l, twinned
  at 8m): HC-F5-strictTransfer forward under the flip, R's right shoulder 41-42 deg past its rotation range (plan 09's
  twist) from 2.95 s to the end (3.1 player-s, half the flip's HC impossible time). Not the loaded-limb class and not
  under D: R lies with its right arm straight overhead on the floor (swing 177 deg from hanging), only the floor touching
  the arm, at about its own weight (0.13 N s a substep). The envelope's twist limit is scaled by cos(swing / 2) so that
  it fades at the pole (plan 09: passivity around closed paths), so there it reads 1.0 deg (under its 5 deg tolerance)
  and acts on nothing; its persistence clock and the 7f loaded-limb rule read that faded excess, so neither sees it.
  The twist drifts from 11 deg past at 2.75 s to 41 deg past with nothing turning it back; the reading itself is
  ill-conditioned there (2.40 to 2.50 s it turns from 23 to 177 deg while the swing moves 172 to 177). Twins
  (`.scratch/ladder/assess-8l/tools/worktree-scratch/r8m/`): from the flip's state at 2.75 s and at 2.40 s, the flip's
  hip stops, PGS and knee stop taken off (and each alone) keep the arm there as long (3.13 and 3.32 s against 3.07
  and 3.12); from 2.00 s and 1.40 s whether the fall ends with the arm at the pole varies part by part (from 2.00 s: all off 0.18 s,
  hips off 0.30, PGS off 2.92, knee off 3.10): reached by the moved trajectory, not introduced or worsened. Whole runs:
  before the flip 0, the flip 3.12 s, any one part off 0-0.07 s. Before the flip the fixtures read 4.2 player-s of
  shoulder rotation past the impossible margin in short events, none at rest. Test tests/shoulder-pole.test.ts on
  `HC-F5-strictTransfer@165` (2.750 s, the flip registered): past the impossible margin 3.07 s, only at the pole, the
  envelope never past its tolerance; fault twin, the same arm and twist moved off the pole to swing 120: never past the
  impossible margin, inside the tolerance after the persistence limit. Fix rung to choose after the lab review (the
  user: does the overhead arm look twisted?): if it does, a twist limit that holds at the pole (rung 9's overhead-twist
  singularity, for the ragdoll); if not, the visible meter stops reading shoulder twist at the pole, as it already does
  not read hip rotation past 150 deg of swing.
- Rapier's correction at a combined pose is not along the reading's gradient: at flexion 110 the Y stop's correction
  turns mostly Z, so Y overruns by 11 deg until the Z stop also holds (seen in the 8g probes, not in a fixture).
