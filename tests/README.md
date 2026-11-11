# Test data: state captures

`tests/data/state/<fixture>@<tick>.json.gz` are full-state captures (`tests/state.ts`): the Rapier world snapshot and
every JS object the Simulation reaches, at the end of tick `<tick>` of a registered fixture. A test resumes one with
`resumeState(loadState(file), { opts })` and steps on; the run from there is the uninterrupted run's, byte for byte
(`tests/state.test.ts`). Use one for a regression test that must start from a fixed state shortly before a defect
(ladder rule 7), so a later change that moves the fixture's trajectory before that point does not move the test, and
for a controlled twin: `resumeState(cap, { def: variantDef, variant: ['legGuard'] })` resumes the same state under a
profile variant (only the paths named in `variant` may differ from the capture's profile ids), and
`resumeState(cap, { faults: { pose: { ... } } })` the same state with fault switches (`SimOptions.debug`) on from there.

## Capture

```sh
npx vite-node scripts/capture-state.ts <fixture> <tick> [out] [--ledgers] [--v3] [--audit]
```

Runs the fixture with the fixture export's defaults (ledgers off; `--ledgers` for a test that reads them, about twice
the size), writes `tests/data/state/<fixture>@<tick>.json.gz` and checks that the resumed run reproduces the
uninterrupted one to the end (exits 1 otherwise). `--v3` runs it under `LEG_GUARD_V3` (the physical supported legs, which
no registered fixture runs yet) and writes `<fixture>~v3@<tick>.json.gz`; a test resumes that one with the same
definition, `{ def: { ...FIX(id), legGuard: LEG_GUARD_V3 } }`. `--audit` runs it with the transition audit on (`transitionAudit`,
kept in the capture's options, so the resumed run audits too) and adds `-audit` to the suffix (`<fixture>~v3-audit@<tick>`). Captures are between ticks (a tick is the fixture's
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
