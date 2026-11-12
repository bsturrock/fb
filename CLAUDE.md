# football-sim-7

Physics football simulation (TypeScript, Rapier, three.js). Players are either *supported* (posed from clips and
planners on a proxy body) or *ragdolls*; most hard problems are at the boundary between the two.

## Commands

- `npm run typecheck`, `npm run build`, `npm test` (vitest), `npm run fixtures` (exports all fixtures, writes
  `evidence/summary.json`), `npm run dev` (the lab: `?fixture=<id>&cam=front|side&speed=0.25&t=<s>`).
- Full check, on branches that have `scripts/check/`: `npx vite-node scripts/check/full-check.ts <result-dir>`, then
  `npx vite-node scripts/check/compare.ts <before> <after>`. About 4 minutes (the suite alone about 2.5, then the
  fixture pass about 1.3). A step that changes no file the pass runs (docs, test files, test data) adds
  `CHECK_REUSE=<previous result dir>` to take the pass from there: about 2.5 minutes. See `scripts/check/README.md`.

## How work is done here

The fixtures are chaotic: any behaviour change moves trajectories and a different fixture crosses some limit. A large
uncommitted stack of changes cannot be judged or bisected, and cost 17 rounds without converging (2026-11-10). So:

1. **Small committed steps.** One reviewable change per commit, on a branch cut from the last good commit, in its own
   git worktree. Never grow a large uncommitted stack.
2. **Flag off first.** New behaviour lands behind a profile flag that no fixture uses, with all fixture summaries
   byte-identical. Turning the flag on for fixtures is its own step, so behaviour change is judged alone.
3. **Full check on every step**, compared with the previous step: suite failures by message (not name), fixture
   summaries, leg matrix, L4 matrix. Run it without competing load; parallel runs cause false timeouts.
4. **Older fixture families stay byte-identical.** New profiles are opt-in on L3, L4 and HC; G, L1, L2 and RH
   summaries never change.
5. **Prove cause with a twin.** Capture the full state shortly before a failure (`tests/state.ts`,
   `scripts/capture-state.ts`, `tests/README.md`) and resume it with the change on and off. A failure blocks a step
   only if the step introduces or worsens the mechanism. A mechanism that already existed and was merely reached by a
   moved trajectory becomes a capture-based regression test plus a tracked defect with its own fix step.
6. **Never raise a limit or re-pin an expectation to pass.** Exceptions for tracked defects are scoped by fixture and
   mechanism, never by a number. Prefer checking a rule over pinning a list of fixtures that happen to trigger it.
7. **Every test has a fault twin:** it fails for the intended reason with the fault and passes without. Prefer
   constructed cases and state captures over samples from whole fixture runs.
8. **A step that cannot pass alone is parked** with its patch and evidence, not carried forward.
9. **No experiment hooks in committed source** (`process.env.*`, `globalThis.*` switches).
10. **Storage.** No copies of the tree; never copy `.scratch/` or `node_modules`. Check results go to
    `.scratch/<work>/<step>/`, under about 20 MB each; nothing durable in `/tmp`.

## Working with the user

- The user reviews *look and design* in the lab at each milestone and answers design and larger-vision questions.
  Stop at each milestone with a short list of lab fixtures and timestamps worth watching.
- Acceptance calls, thresholds, which tests matter, and whether to change approach belong to whoever is driving the
  work. Decide, record the reason in the plan or handoff doc, proceed.
- Status updates in plain terms: what players visibly do now compared with before, how far along, what is risky.
  Fixture IDs, watts and test names go in the docs, not in updates.
- Changed fall outcomes ("who falls") are shown to the user, not silently accepted or rejected.

## Docs

- `docs/open/` plans in progress; `docs/handoff/` what each finished plan did and its known issues.
- Keep docs to what helps someone use, maintain or resume the work. No work logs.
