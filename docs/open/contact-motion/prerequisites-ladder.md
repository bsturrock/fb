# Contact-motion prerequisites: ladder (open items)

Status: build work stopped 2026-11-12 at `8a6af97` (branch `prereq-ladder`, 61 commits on `a6d712f`). What landed,
how it works, the measured result, open defects and parked flips:
[handoff](../../handoff/contact-motion-prerequisites.md). This page keeps what is still open: the user's review list,
the next steps, and how this branch replaces the old working tree. M2 starts after the review.

## Rules

The working rules are in `CLAUDE.md` ("How work is done here"). For this ladder in particular:

- One step is one commit on `prereq-ladder`. New behaviour lands behind a flag with fixture summaries byte-identical,
  and a flip is its own step. G, L1, L2 and RH stay byte-identical.
- Each step's full check goes to `.scratch/ladder/<step>/` in the main checkout and is compared with the previous step
  (`scripts/check/README.md`). The tip's result is `r12b-twist-fit`. The primary measure is the visible-quality matrix.
- A flip is assessed first as a variant, with every suite failure classed and behaviour failures twinned
  (`assess-<step>/`). If it is not clean it is parked with its patch (`parked/<flip>/`) and a README saying what blocks
  it.

## Morning review for the user

What each step changed that is worth watching, newest last. Every link is a lab URL served from this branch (the
ladder worktree, `npx vite --port 5180 --strictPort`; the dev server in the main checkout runs the old tree). The link
as given is the current tip; the parameters below show a moment as an earlier step left it. Speed 0.25 in all of them.
The open questions from all three steps, with the later ones, are numbered in the handoff ("Questions waiting on the
user").

| to see a moment as | add to the link |
| --- | --- |
| before 8m (the registration up to 8k) | `&legs=v1&selfleg=off&hips=off&pgs=0&knees=off&retry=off` |
| 8m left it | `&legs=v1&selfleg=off` |
| 9d left it (through 10b) | `&legs=v1` |
| now (the tip; nothing visible changed since 10d) | nothing |

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
  for now? (It belongs to the rigid standing body, a separate step: the open defect "a rigid proxy rebounding off a
  ragdoll" in the handoff.)

## Next steps

None of these is started. Each needs the user's look or design answer first (questions 1-10 in the handoff), except
the two marked as fixes. Details, captures and twins are in the handoff's "Open defects" and "Parked flips".

1. **The user's review** of the list above and the handoff's questions. A changed outcome the user rejects becomes
   its own fix step.
2. **Replace the old working tree** (below). This is the user's decision.
3. Fix: an own-trunk hit read from what the solve will take, then re-assess the parked `selfTrunkBody` flip
   (`IMPACT_OVER_POWER`).
4. Fix: the leg guard keeping a falling proxy's leg clear of a ragdoll shoe at HARD_OK, then re-assess the parked
   thigh-rotation flip (`JOINT_RANGE_V3`; it applies unchanged on the tip).
5. After question 10: the raised-arm fix in the anatomical window or the guard, then the arm pair flip (`JOINT_RANGE_V5`
   with `SELF_CLEARANCE_V2`). Twin its three natural samples first, then the HC ragdoll implausible rise.
6. After question 5: the stance width in footwork, or accept the step-out and flip `LEG_GUARD_V4`.
7. After question 1: the meter reads the anatomical twist, or the ragdoll's twist limit is taken in it
   (`SHOULDER_POLE_TWIST`).
8. After questions 8 and 9: the upper arm in the self shapes (it moves clip arms everywhere); pose continuity without
   ground on L4.
9. Not scheduled: rebound energy (needs solver access Rapier 0.21's JS lacks), the rigid proxy's rebound off a ragdoll,
   physical legs starting a solve 1-2 cm inside a ragdoll, and the coincident-manifold impulse reading.

## Replacing the old working tree

The main checkout `/Users/brandon/Projects/football-sim-7` is on `model-integration` at `a6d712f`. Its working tree
holds the abandoned attempt: 23 modified paths and 8 untracked ones. `prereq-ladder` supersedes it, and `a6d712f` is
its ancestor. No remote exists, and there are no stashes. Checked 2026-11-12:

- `git diff a6d712f` in the main checkout is byte-identical to `.scratch/cmp-evidence/s17/main-tree-2026-11-11.patch`.
  The six untracked source and test files and `tests/data/` are identical to `untracked-2026-11-11.tgz` there.
- The untracked `CLAUDE.md` is identical to the ladder's committed one. The untracked
  `docs/open/contact-motion/prerequisites-ladder.md` is the ladder's first version (`c7fb3fe`).

Each path in the old stack compared with the ladder tip:

| Path | Verdict |
| --- | --- |
| `src/sim/fixtures/head-plant.ts`, `tests/seed.ts`, `tests/data/*.json` | Salvaged: identical on the ladder |
| `tests/headplant.test.ts`, `tests/corerock.test.ts` | Salvaged and re-expressed (rungs 4a, 4b) |
| `tests/leg-placement.test.ts` | Superseded: the same L3-F1-phase6 thigh-frame mechanism is the surface-advance case in `tests/physical-legs.test.ts` |
| `src/sim/footwork.ts` | Salvaged: the same `tolM` and `releasePlantAt` change |
| `src/sim/{pose,pose-runtime,physics,simulation,conversion,debug}.ts` (physical legs, sweep, D1-D3) | Re-expressed as rungs 5-7, 6b, 6c and 10b. One difference: the old tree kept the legs physical over a refused static surface; the ladder turns them off (10b) |
| `src/sim/fall-response.ts`, `profiles.ts` (impact guard v4-v6) | Re-expressed (the ladder numbers them residual v4, manifold v5, carried v6) |
| `src/sim/fixtures/{falls,handoff-contact,transitions}.ts` | Superseded: V3 is registered by `legFlip` |
| `tests/{l3-contracts.test,l3-pass,body-limits.test,harness.test}.ts`, `tests/test-map.json` | Partly salvaged; the ladder's versions re-express and extend them |
| `evidence/summary.json` | Superseded (regenerated at every step) |
| `docs/handoff/contact-motion.md` (+74 lines) | Carried into the new handoff (13f coverage, D4/D5, the footwork known issues) |
| `ARM_CLEARANCE_V1`, `armSweep`, `publishedLimbs` (`arms.ts`, `pose.ts`, `profiles.ts`, `simulation.ts`, the `armClearance` field in `fixture.ts` and `sim-evidence.ts`) | Unique; parked: dormant, untested, no fixture used it, and M3 reworks the wrap arms |
| `tests/gate4.test.ts`: E1 as a constructed sideline ending in a lowered stance | **Unique and still wanted**: the ladder pinned the natural L3-F1-mirror0 sample to `LEG_GUARD_V1` instead (7d), and CLAUDE.md rule 7 prefers a constructed case. It is a small test-only step |
| `process.env.D1_OFF`, `D1_NOSTOP`, `D2_OFF`, `D3_OFF` | Rejected (CLAUDE.md rule 9) |

Patches preserved only in `.scratch/cmp-evidence/s17/` are not in the working tree. They include `arm.patch`'s
limb-reversal scan tests and `l4.patch`'s `exit-shoulder` seed test; the latter is superseded by the 7f loaded-limb
rule.

Three ways to make `model-integration` equal the ladder. Before any of them, stop the dev server (pid 35012), which
serves the old tree from the main checkout. Then run `git -C ~/.claude-wt/football-sim-7-ladder status` to confirm
the ladder is clean.

**A. Keep the old stack as a commit on a backup branch, then fast-forward** (recommended: everything stays in git):

```sh
cd /Users/brandon/Projects/football-sim-7
git switch -c old-stack-2026-11-11      # at a6d712f, working tree carried over
git add -A && git commit -m "wip: abandoned contact-motion prerequisites stack (s17), superseded by prereq-ladder"
git switch model-integration            # back to a6d712f, clean
git merge --ff-only prereq-ladder       # model-integration -> the ladder tip
git status --short                      # expect nothing
```

Risk: low. `git add -A` takes only the 31 listed paths, because `.scratch/` (in `.git/info/exclude`), `node_modules` and
`evidence/traces` are ignored. The old branch can be deleted later with `git branch -D old-stack-2026-11-11`.

**B. Rely on the preserved patch, discard, fast-forward:**

```sh
cd /Users/brandon/Projects/football-sim-7
git diff a6d712f | cmp - .scratch/cmp-evidence/s17/main-tree-2026-11-11.patch   # must print nothing
git restore --source=HEAD --staged --worktree -- .
git clean -nd   # expect exactly the 8 untracked paths; then git clean -fd -- <those paths>
git merge --ff-only prereq-ladder
```

Risk: the only copy of the old stack is then in git-ignored `.scratch/`. Deleting `.scratch/` loses it.

**C. Stash, then fast-forward:** `git stash push -u -m old-stack-2026-11-11`, then `git merge --ff-only
prereq-ladder`. Risk: the stash is shared by every worktree and is easy to drop by accident. Use it only as a
short-term hold.

After any of them: optionally run `git worktree remove ~/.claude-wt/football-sim-7-ladder`. It may need `--force`,
because the ignored `evidence/traces/` and the `node_modules` symlink are there; nothing tracked is lost. Then
`git branch -d prereq-ladder`, and restart the lab from the main checkout. With no remote, a
`git bundle create ~/football-sim-7-<date>.bundle --all` kept outside the project is the only backup.
