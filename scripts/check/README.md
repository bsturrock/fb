# Full check

The repeatable check every rung of the contact-motion prerequisites ladder
(`docs/open/contact-motion/prerequisites-ladder.md`) is judged by. It runs the current tree and writes one result
directory; `compare.ts` diffs two of them.

## Run

```sh
npx vite-node scripts/check/full-check.ts <result dir>
npx vite-node scripts/check/compare.ts <before dir> <after dir>
```

Ladder results live outside git in the main checkout: `.scratch/ladder/<rung>/` (for example
`.scratch/ladder/r0-baseline`). A result directory is about 1 MB.

Order and load: typecheck, build, then the test suite **alone** (nothing else running, so no timeout is induced by the
check itself), then the fixture export and the matrices as shards in a bounded pool (`CHECK_JOBS`, default 6 on the
8-core machine; these runs have no timeouts and their results do not depend on load). Other heavy processes on the
machine during the suite still matter: run the check on an otherwise idle machine.

Environment: `CHECK_JOBS=<n>` pool size; `CHECK_SKIP=suite,legmx,...` skips parts (typecheck, build, suite, fixtures,
legmx, l4mx, energymx, visiblemx), recorded as skipped, for a quick look only (a rung is judged on a full run).

## Outputs

Compared files (deterministic: stable order, no timestamps):

| File | What |
| --- | --- |
| `status.json` | typecheck (ok, error count), build ok, suite exit code, fixture count, fixtures that threw, whether the export equals the tree's committed `evidence/summary.json`, matrix row counts, failed shards |
| `suite.json` | test counts; every failing test (and every file that failed outside a test) with its file, full name, kind (`TIMEOUT` when the first line says it timed out, else `REAL`), first message line and the message up to its stack |
| `summary.json` | the fixture export of every registered fixture: byte for byte what `npm run fixtures` writes to `evidence/summary.json` (run in shards through `scripts/fixture-runner.ts` and merged in registry order) |
| `traces.sha256` | sha256 of every fixture's trace file the export writes (`evidence/traces/<id>.json`; the traces themselves are not kept) |
| `legmx.jsonl` | leg matrix (`legmx.ts`): every fixture with a leg-guard profile, both body orders. Per row: fixture, order, leg-guard id, result; per player: conversion time, end mode, largest one-substep player-player contact impulse on the player and on its leg colliders (thigh, shin, shoe) with when, and the leg ledger (largest one-substep leg impulse and when, ungrounded impulse substeps, totals), `"absent"` on a tree without one |
| `l4mx.jsonl` | L4 matrix (`l4mx.ts`): every fixture with a fall-response profile, both body orders. Per player: conversion time, end mode and every scalar of its fall-response stats (`peakPositiveW` the peak audited power, `overPowerSubsteps` / `overWork` the ceiling breaches, `heldSubsteps` / `heldBodySubsteps` the impact guard, ...) |
| `energymx.jsonl` | passive-energy matrix (`energymx.ts`, `tests/passive-energy.ts`): every L3, L4 and HC fixture with a ragdoll profile, both body orders. Per player whose ragdoll ran: its solves; the solves no other player touches (no contact impulse, solved or raw, with one) that gain more than `INJECTION_J` (0.5 J) of kinetic plus potential energy beyond the work of every applied force and torque (drives, envelope, response), as `injecting` and their total `injectedJ`; the largest such gain `maxJ`, its solve `maxStep`, time `maxAt` and the segments touching static ground and one of the ragdoll's own shapes there (`maxPinch`, the self-trunk pinch); the largest gain of a solve with no contact at all (`quietMaxJ`, read to 0.01 J: gravity's integration reads under 0; a gain there is a segment moved off its velocity's path, mostly CCD holding it back before its first contact); every injecting solve as `[solve, J, pinch segments, largest loss of the tick before, 1 if any contact impulse else 0]` (`over`: a rebound follows an impact). `status.json` carries the headline per family (runs, runs and solves injecting, total J, largest) |
| `visiblemx.jsonl` | visible-quality matrix (`visiblemx.ts`, `tests/visible.ts`): every L3, L4 and HC fixture with a ragdoll profile, both body orders, every drawn frame. Per row: duration, ragdoll and supported player-seconds (`ragS`, `supS`); for ragdoll frames (`rag`) and supported or falling-proxy frames (`sup`) the seconds past the implausible (`impl`) and impossible (`imp`) margin by `Joint.dof`, the own bone-axis crossing seconds (`selfAx`: `legLeg`, `legTrunk`) and the joint snaps (`snap60`, joint-frames); for ragdolls also the own-body overlap seconds past 1 cm (`self`) and in events past 10 cm (`selfDeep`) by class, and the knee seconds past 150 (`kneeStop`); cross-player leg overlap seconds by pair kind (`cross`); each conversion's player, time and the hips at its last supported frame (`conv`: `[flex, abd, rot]` left, right); the worst event of each column (`worst`: `[player, what, peak, peak time, start, end, severity]`). Definitions below. `status.json` carries the headline per family |
| `queries.jsonl` | shape-query budget (the leg matrix's runs, so every L3, L4 and HC fixture in both orders): the most Rapier shape queries in one tick (`worstTickQueries`, counted as plan 13a's budget test counts them) and when (`at`) |

Not compared: `meta.json` (commit, dirty file count, timings, pool size) and `logs/` (each step's output, the raw
vitest JSON report).

The matrices run each fixture with default options (ledgers off, as `npm run fixtures`) and `reverseOrder` for the
second order. They read later features defensively: a column whose feature the tree does not have is reported absent,
never a crash. `ONLY=<regex>` limits any matrix to some fixtures and `LEGV2=1` runs the leg matrix under
`LEG_GUARD_V2` (a tree that has it) when run by hand:
`ONLY='^L4-F10' npx vite-node scripts/check/legmx.ts 0 1 /path/out.jsonl`.

## Compare

`compare.ts` prints which compared files are byte-identical, then:

- typecheck and build status;
- suite failures matched by message (kind + first line), not by name: added (hard), changed message (same test, new
  first line), removed, and same message with different detail;
- fixture summaries and trace hashes changed per family (G, L1, L2, RH, L3, L4, HC), an explicit
  `G/L1/L2/RH byte-identical: PASS|FAIL` line (hard), and every result or end-representation change (who falls)
  listed per fixture;
- per matrix: rows that vanished or are new, new over-ceiling entries (a field named `over*` that rises), result,
  conversion-time and mode changes, peaks that rise (fields named `peak*`, `injJ`, `depth`), columns one side reports
  absent, and a count of rows that changed otherwise.
- shape queries: the rows whose worst tick is at or over the 4000-query budget (`SHAPE_QUERY_BUDGET`), those new
  against A, and the rows whose worst tick rises.
- passive energy (informational): per family the total injected energy, injecting solves and runs and the largest gain
  in A and B; the runs injecting in B that did not in A, and the runs whose largest gain rose (over the threshold).
- visible quality (informational): per family the headline columns in A and B, the ragdoll impossible seconds by joint
  and direction and the deep own-body overlap seconds by class; the runs that got worse (a column up more than 0.05 s,
  or more snaps) with a lab link; and the ten worst ragdoll joint events and the ten worst deep own-body overlaps now,
  one per fixture, with lab links (`?fixture=<id>[&order=rev]&cam=side|front&speed=0.25&t=<0.15 s before the peak>`).

It exits 1 only on the hard invariants: a new suite failure or a changed G/L1/L2/RH summary or trace. Everything else is
for judgement under the ladder's rules. `COMPARE_MAX=<n>` lists more than 60 lines per section.

## Visible quality (`visiblemx.jsonl`)

What the owner sees in the lab: joints bent past what a body can do, and limbs passing through the player's own body or
another player's. Observation only (the meter reads `PlayerRuntime.pose` after each `stepTick`; a run is unchanged) and
informational (no invariant reads it).

**Frames.** A drawn frame is a player's published pose at the end of an outer tick (60 Hz): what the lab draws,
interpolated between ticks at slow speed. Extremes inside a tick's substeps are never drawn, so never counted. A frame is
a ragdoll frame when the player's representation is the ragdoll, else supported (the supported pose and the falling
proxy). Seconds are player-seconds (`dt` from `Simulation.t`), summed over both orders and every player of a family.

**Angles** come from the drawn segment transforms (`pose.segments`, the ragdoll's Rapier bodies), relative parent to child
in the parent's frame, never from controller internals (`tests/visible.ts jointAngles`). Zero is the anatomical neutral:
the segment frames aligned (`src/sim/pose.ts`: limb -Y distal, X the hinge or knee axis; core X lateral, Y up, Z forward).

- Hip (core to thigh): the thigh direction in the core frame. Flexion `atan2(z, -y)`, positive forward (past 90 toward
  the chest), negative behind (extension). Abduction `asin(side * x)` with `side = sideSignX` (the model body's right is
  on -X), positive away from the midline, negative across it (adduction). Rotation: the swing-twist twist about the thigh
  (plan 09's measure, `externalTwistRad` with neutral 0), positive external on either side. Past 150 deg of swing the
  thigh lies along or through the trunk, a `fold`, impossible either way; flexion and extension are not read there or
  past 60 deg of ab/adduction (the sagittal angle is ambiguous), rotation not past 150 deg of swing.
- Knee and elbow: flexion is the twist of the child about the parent's hinge X (negative = hyperextension); off-axis is
  the angle between the two hinge axes.
- Shoulder: excess past the joint-range-v2 swing cone (`swingExcess`) and the anatomical twist (`limbAnatomicalTwistRad`,
  ladder 11d; 0 = the forearm bending forward from a hanging arm, behind the head from an arm overhead). Up to horizontal
  it is plan 09's twist (neutral 180); above, it is taken after the shortest arc from a reference 35 deg forward of
  hanging, so it stays regular overhead. Before ladder 13a the meter read plan 09's twist everywhere, which overhead reads
  any value (an arm overhead bent to the face read neutral).
- Neck: the twist about the core's X (flexion / extension) and the angle of anything else (turn and tilt).
- Ankle (where the pose publishes `anklePitchDeg`): positive toe down.

**Human ranges** (standard active range of motion of adults: AAOS, *Joint Motion: Method of Measuring and Recording*;
Norkin & White, *Measurement of Joint Motion*). Implausible and impossible are degrees past the range.

| Joint | DOF | Human range | Implausible past | Impossible past |
| --- | --- | --- | --- | --- |
| Hip | flexion / extension | 120 / 30 | +15 | +30 |
| Hip | fold: thigh swung past 150 (along or through the trunk) | - | at once | at once |
| Hip | abduction / adduction | 45 / 30 | +15 | +30 |
| Hip | internal / external rotation | 45 / 45 | +15 | +30 |
| Knee | flexion | 140 | 150 | 160 |
| Knee | hyperextension | 0 | 5 | 10 |
| Knee | off-axis | 5 | 15 | 25 |
| Elbow | flexion / hyperextension | 150 / 5 | +5 | +15 / +10 |
| Elbow | off-axis | 5 | 15 | 25 |
| Shoulder | swing | the joint-range-v2 cone (fitted, 45 behind the side line hanging) | +15 | +30 |
| Shoulder | rotation | +-100 about neutral (ER 90, IR 70) | +15 | +30 |
| Neck | flexion / extension | 50 / 60 | +10 | +25 |
| Neck | turn or tilt | 45 | +15 | +35 |
| Ankle | dorsiflexion / plantarflexion | 20 / 50 | +10 | +20 |

**Overlap.** The drawn shapes are the pose's limb capsules, palm ball and shoe box (`poseLimbShapes`: bew-v6's mesh-fit
radii on the model body), the trunk hull pieces (the compound cuboids on an authored body) and the head ball. Own-body
pairs whose proximal ends meet by construction use the distal parts (thigh 55-100 %, shin and upper arm the distal
half). Own-body depth is counted past the idle baseline: the deepest each pair reaches standing idle (L3-F13-free; inner
thighs about 4 cm), visible past 1 cm. Classes: `legLeg` (one leg's distal thigh, shin or shoe against the other leg),
`legTrunk` (distal thigh, distal shin or shoe against the own trunk), `legFold` (the same leg's shoe against its thigh,
calf against thigh), `armLeg`, `armTrunk` (not read on an authored body, whose shoulder pivot sits inside its padded
trunk box), `armArm`, `headLimb`. Bone axes are radius-independent: the distal half-thigh, shin, ankle-to-shoe and
pelvis-to-neck segments with slim radii (7.5, 5, 4, 11 cm); an own pair on different legs or a leg and the trunk is
crossed when its axes are closer than the radii summed and at least 2 cm closer than the pair gets idle.

**Events** are runs of consecutive frames past a threshold, gaps up to 2 frames merged; the peak is the largest excess
(deg past the range, cm of overlap); severity is the excess integrated over the event (deg s, cm s).

| Column (`status.json` headline, `compare.ts`) | Definition |
| --- | --- |
| `ragImpS` | ragdoll seconds past the impossible margin, summed over joints and DOF (`rag.imp` by `Joint.dof`) |
| `ragImplS` | the same past the implausible margin (`rag.impl`) |
| `supImpS` | supported seconds past the impossible margin (`sup.imp`) |
| `ragSelfLegAxS` | ragdoll seconds with an own bone-axis crossing, `legLeg` plus `legTrunk` (`rag.selfAx`) |
| `ragSelfDeepS` | ragdoll seconds of own-body overlap in events whose peak passes 10 cm, every class but `legFold` (the knee's fold, the knee angle's), summed over classes (`rag.selfDeep`) |
| `supSelfLegAxS` | supported seconds with an own bone-axis crossing (`sup.selfAx`) |
| `crossLegSupSupS`, `crossLegSupRagS`, `crossLegRagRagS` | pair-seconds with a leg (thigh, shin, shoe; full shapes, no baseline) of one player more than 1 cm into a leg of another, by the pair's representations |
| `ragSnap60`, `supSnap60` | joint-frames turning a joint faster than 60 rad/s (57 deg in one drawn frame) |
| `kneeStopS` | ragdoll knee-seconds past 150 deg flexion (the knee lying at the ragdoll's hard stop: human 140 plus the implausible 10) |

Worst event per run and column (`worst`): `ragImp`, `ragImpl`, `supImp` (joint events), `ragSelfAx`, `supSelfAx`,
`ragSelfDeep`, `crossLeg` (overlap events, cm), `snap60` (ragdoll; peak in rad/s), `kneeStop` (the knee flexion event).

Validation (`tests/visible.test.ts`): constructed hip poses on both sides of both bodies, mirrored, read the angles they
were built with (a fault twin without the side sign reads them wrong); the screenshot run (L3-F9-convert-free under
`legs=v3`, forward) reads the visible audit's values: red's left hip rotation -94 at 0.67-0.98 s, blue's right hip
flexion past 180 (a `fold`) at 1.13-1.35 s, blue's right thigh 123 deg behind at 1.45 s. Under `legs=v3` the matrix
reproduces the audit's headline (ragdoll impossible 275.1 s of 637.1 ragdoll seconds; implausible 583.3; knee past 150
121.6; axis crossing leg-leg 225.1 / leg-trunk 203.5; supported impossible 5.5; snaps 8 / 54).

Determinism: two full checks of the same tree compare with every file byte-identical.

Seeded regression tests: a test that must start from a fixed state of a fixture run (ladder rule 7) resumes a full-state
capture from `tests/data/state/` (`tests/state.ts`); how to capture one and when it must be regenerated:
`tests/README.md`.
