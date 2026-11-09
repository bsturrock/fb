# 13c — A short lab fixture list

Repository-aligned plan • 2026-11-09 • Part of [plan 13](13_Lab_Review_Pass.md). Follows 13b. **Implemented** 2026-11-09 ([handoff](../handoff/plan13.md#13c--a-short-lab-fixture-list)): the lab opens on the 26-fixture review set; the user's review of names and members is outstanding. Lab only: nothing under `src/sim/` changes, and every export stays byte-identical.

**Goal:** the lab opens on a short list of about 25 fixtures that show what the simulation does now, named in plain words. All 410 stay registered and reachable for tests, evidence and anyone who asks for one.

## Why

The user (2026-11-09): the fixtures can stay, but the list is too long to make sense of or use.

**Today** (`fillFixtureSelect`, src/lab/main.ts): one `<select>` lists all 410 fixtures by id, in registry order, in ten groups by milestone (Gate 1 to Gate 4, L1, RH, L2, HC, L3, L4). Titles are not shown; the fixture's title appears only after it loads.
- 216 of the 410 are historical gate and early-plan fixtures (G1–G4, L1, L2, RH).
- Many current ones are sweeps of one case: L3-F1 has 13 phase, mirror and stance variants, L3-F16 has 11 brake times, the L4 twins come in `-on` and `-off` pairs.
- 50 L3 and L4 fixtures use the authored test body, which the lab draws as primitives, not the player model.

## User decision (2026-11-09)

Hide, don't delete. The registry, the tests and the evidence keep every fixture.

## Design

**Review set.** A new file `src/lab/review-set.ts` exports `REVIEW_SET`: groups of `{ id, name }`, where `name` is a plain description. It is the only place the list is written, so the user can change it by editing one file.

**The select.**
- By default the select shows the review set, grouped, each option as `name · id`.
- A checkbox **All fixtures (410)** switches to the full list, grouped by milestone as today, each option as `id · title` (the title shortened to 60 characters).
- A text box filters whichever list is showing by id, name or title, as you type.
- A URL `?fixture=<id>` for a fixture outside the review set turns on **All fixtures** and selects it, so every link and recorded command still works.
- The choice of list is remembered per browser (`localStorage`, wrapped in try/catch; the default is the review set).

**Starting set** (26). Every one uses the player model. The names are a first draft; the user edits them.

| Group | Fixture | Name |
| --- | --- | --- |
| Stand, walk, run | L3-F13-carrier | Idle, carrying the ball |
| | L3-F13-free | Idle, no ball |
| | L3-F14-forward | Walk, then stop |
| | L3-F14-walkRunStopCarrier | Idle, walk, run and stop with the ball |
| | L3-F17-runStart | Start from rest into a run |
| | L3-F16-runStop | Run at 6 m/s, then stop |
| | L3-F16-reaccel | Brake, then run again |
| | L3-F16-sprint | Top speed, 6.6 m/s |
| Contact and tackles | L3-F2-miss | Defender misses ahead of the runner |
| | L3-F3-collision | Head-on collision |
| | L3-F3-side | Side hit at speed |
| | L3-F1-phase0 | Forced-entry tackle |
| | L3-F4-twoArm | Shoulder and two-arm wrap |
| | L3-F4-oneArm | Shoulder and one-arm wrap |
| | L3-F5-drag | Runner drags the wrapped defender |
| | L3-F6-hold | Standing contested hold |
| | L3-F8-recontact | Second bump while the first unwinds |
| Falls and endings | L4-F10-wrap-on | Two-arm wrap to the ground |
| | L4-F3-run-on | Carrier falls from a run, protecting the ball |
| | L4-F3-model-oblique-on | Carrier tips toward the free arm and braces |
| | L4-F2-model-forward-on | Forward fall, knees flex |
| | L4-F9-contact | Fall in contact, with the fall response |
| | L4-F5-twoClamp-on | Both fall from a standing wrap |
| Ragdoll handoff | HC-F3-phase0 | One-arm tackle, defender goes limp in contact |
| | HC-F2-lift1.4 | A player lands on another |
| | HC-F1-low | Both go limp from a low stance |

## Tasks

- [x] **Test first** (in `tests/harness.test.ts`, merged in 13b): every `REVIEW_SET` id is registered, ids are unique, there are at most 30, and every one uses the model body (`measured.calibrationId === MODEL_CALIBRATION_ID`). It fails until the file exists.
- [x] **Review set.** Write `src/lab/review-set.ts` with the table above.
- [x] **Select.** In `index.html` add the checkbox and the filter box above the select. In `main.ts`, replace `fillFixtureSelect` with a function that builds either list, applies the filter, and keeps the current fixture selected when the list changes; handle the URL case and the remembered choice.
- [x] **Browser check.** Load the lab: the review set shows; the filter narrows it; the checkbox shows all 410; `?fixture=G4-F1` opens the full list on G4-F1; no console errors.
- [ ] **User review.** The user edits names and members by eye; the test still passes.
- [x] **Close.** Suite, typecheck, build; exports byte-identical. Handoff section.

## Acceptance

- The lab opens on the review set: at most 30 fixtures, each named.
- All 410 fixtures stay registered, tested and exported; any one is two clicks or one URL away.
- Typing part of a name, id or title narrows the list.
- No change outside `src/lab/`, `index.html`, `tests/` and docs; exports byte-identical.
