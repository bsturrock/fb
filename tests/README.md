# Test data: state captures

`tests/data/state/<fixture>@<tick>.json.gz` are full-state captures (`tests/state.ts`): the Rapier world snapshot and
every JS object the Simulation reaches, at the end of tick `<tick>` of a registered fixture. A test resumes one with
`resumeState(loadState(file), { opts })` and steps on; the run from there is the uninterrupted run's, byte for byte
(`tests/state.test.ts`). Use one for a regression test that must start from a fixed state shortly before a defect
(ladder rule 7), so a later change that moves the fixture's trajectory before that point does not move the test, and
for a controlled twin: `resumeState(cap, { def: variantDef, variant: ['legGuard'] })` resumes the same state under a
profile variant (only the paths named in `variant` may differ from the capture's profile ids), and
`resumeState(cap, { faults: { pose: { ... } } })` the same state with fault switches (`SimOptions.debug`) on from there.

The definition a capture ran under is `asCaptured(cap)` (tests/runs.ts), never built by hand: of the registered fixture
and the definitions as before each flip in turn (`BEFORE_FLIPS`: `preHoldStill`, `preV3`, `preOwnLegs`, `preFlip`,
applied one after another), the first whose profile ids are the capture's. A capture taken under a variant names it,
`asCaptured(cap, (d) => ({ ...d, legGuard: LEG_GUARD_V3 }))` for `--v3` (`flip8i` for `--flip8i`, and so on); a path the
test resumes as a variant of the capture (resumeState's `variant`) is passed third, and no flip may change it. A twin is
built from what it returns: `{ ...asCaptured(cap), legGuard }`. A new flip adds its `pre*` helper at the head of
`BEFORE_FLIPS`, and every capture taken before it resumes as before, with no test re-pinned.

## Capture

```sh
npx vite-node scripts/capture-state.ts <fixture> <tick> [out] [--ledgers] [--v3] [--rev] [--audit] [--hips=v1|v2] [--flip8i] [--joints=v4] [--brace=v1] [--wrap=v6|v7|v8|v9|v10]
```

Runs the fixture with the fixture export's defaults (ledgers off; `--ledgers` for a test that reads them, about twice
the size), writes `tests/data/state/<fixture>@<tick>.json.gz` and checks that the resumed run reproduces the
uninterrupted one to the end (exits 1 otherwise). `--v3` runs it under `LEG_GUARD_V3` (the physical supported legs, which
every L3, L4 and HC fixture registers since the ladder 10 flip) and writes `<fixture>~v3@<tick>.json.gz`; a capture
without `~v3` of an L3, L4 or HC fixture taken before the flip ran under `LEG_GUARD_V1` (`asCaptured` finds either).
`--audit` runs it with the transition audit on (`transitionAudit`,
kept in the capture's options, so the resumed run audits too) and adds `-audit` to the suffix (`<fixture>~v3-audit@<tick>`). `--rev`
runs the reversed body order (suffix `rev`). `--hips=v1|v2` runs the fixture's ragdoll under the hip stops `HIP_STOPS_V1`
(ladder 8d) or `HIP_STOPS_V2` (8g, with the approach zone), suffix `hipsv1` / `hipsv2`; its definition is
`asCaptured(cap, (d) => ({ ...d, ragdoll: withHipStops(d.ragdoll!, HIP_STOPS_V2) }))`. `--flip8i` runs it under the
ladder 8i visible flip (`flip8i` in `tests/runs.ts`: the hip stops, PGS 4, knee stop 140), suffix `flip8i`:
`asCaptured(cap, flip8i)`. `--joints=v4` runs it under `JOINT_RANGE_V4` (ladder 11d, the anatomical twist window), suffix
`jrv4`: `asCaptured(cap, (d) => ({ ...d, jointRange: JOINT_RANGE_V4 }))`. `--brace=v1` runs it as before the M2 lean flip
(`preBraceV2`: the carrier's brace `CARRIER_BRACE_V1`), suffix `bracev1`; `BEFORE_FLIPS` holds that flip, so
`asCaptured(cap)` finds it. `--wrap=v7` runs the fixture's defender under `WRAP_V7` (polish 1.2, the ride-down), suffix
`wrapv7`: `asCaptured(cap, (d) => ({ ...d, wrap: WRAP_V7 }))`. `--wrap=v8` runs it under `WRAP_V8` (polish 1.4, the
bound-legs fall), suffix `wrapv8`, and `--wrap=v6` under `WRAP_V6_PRE_V10` (tests/runs.ts: the low strike on V8, the lab's `wrap=v6` until polish 2.3 put `WRAP_V6` on V10), suffix `wrapv6`: the same way, `asCaptured(cap, (d) => ({ ...d, wrap: WRAP_V8 }))` or `WRAP_V6_PRE_V10`. Today's `WRAP_V6` runs as that one until the tackler's drive begins (the drive from behind and the fall link act from it), so a test resumes a `wrapv6` capture taken before it under `WRAP_V6` as a `wrap` variant (tests/wrap-drag.test.ts). `--wrap=v9` runs it under `WRAP_V9` (polish 2.1, the fall link, registered until the behind flip), suffix `wrapv9`, and `--wrap=v10` under `WRAP_V10` (polish 2.2, the drive from behind on V9, registered since the behind flip), suffix `wrapv10`: `asCaptured(cap, (d) => ({ ...d, wrap: WRAP_V9 }))` or `WRAP_V10`. A profile constant the build holds outside the definition (ARM_G2 for a fixture with no
`armProfile`, frozen by the fixture registry) is written by its export name in src/sim/profiles with its id, and the
resume refuses the capture when that constant's id changed. Captures are between ticks (a tick is the fixture's
`solver.substeps` physics substeps). They are 170-230 KB; a later tick is larger (the trace and events so far are part
of the state).

## When a capture must be regenerated

The resume refuses a stale capture with `stale state capture (<fixture> at tick <n>): <why>. Regenerate it`, when:

- a profile id at any path of the definition differs from the capture's, or a profile is added or removed (outside the
  paths the test names in `variant`): a profile's values changed, so the state was produced under another one;
- a class instance of the state (Simulation, PhysicsWorld, ArmSystem, ...) has a field the capture lacks: a field was
  added to the state layout;
- a definition object the state refers to, a class it holds, a function or accessor it expects, or an engine handle is
  gone; or the encoding format (`STATE_FORMAT`) or the Rapier version changed.

Not detected: a field added to a plain state object made after the build (a ragdoll, a fall episode, a foot plan
entry) reads `undefined` after the resume. A change that adds such state regenerates the captures it touches, and a
profile change keeps the convention that its id changes with its values. Regenerating means re-reading the defect at
the new tick: the test's comment says what the capture must hold (for example "2 ticks before D's posed legs pass the
conversion tolerance"); check it still does before replacing the file.

A change of behaviour (code, not state layout) does not make a capture stale: the resumed run then shows the new code
from the captured state on, which is what the regression tests are for.
