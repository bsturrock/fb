# 13d — Fast Run as the base run clip

Repository-aligned plan • 2026-11-09 • Part of [plan 13](13_Lab_Review_Pass.md). Follows 13c.

**Goal:** Fast Run is the one run animation for every running speed, from a jog to top speed, with the adaptations it already has (stance width, calibrated legs, carry swing). Sprint is gone from the repository.

## Why

The user's ruling (2026-11-09): remove Sprint; Fast Run is the base animation for all run speeds.

**Today** (`runClipsBew`, src/sim/model/run-clips.ts):
- The run profile has two clips, blended by speed: Fast Run (nominal 5.83 m/s, stride 3.11 m, flight 35%) and Sprint (6.24 m/s, 3.33 m, flight 43%). The two are only 7% apart in speed.
- Both play at 0.7–1.3× their cadence. The clip weight fades in over 3.21–4.08 m/s (0.55 and 0.70 × Fast Run's nominal speed). Below 3.21 m/s the procedural gait shows.
- The L3 profile (`runClipsL3`) puts the supplied walk first, but plays it only for a walking request (0.05–2.1 m/s). A jog between 2.1 and about 3.5 m/s therefore shows the procedural gait on every path.
- 130 fixtures carry a run-clip profile: L1 8, L2 9, RH 16, HC 10, L3 74, L4 13.

## User decisions (2026-11-09)

- **Sprint is removed everywhere.** The asset, its source FBX, its manifest entry, its intake record and every reference go. The plan 10 U2/U3 rule (historical exports byte-identical) is waived for this change: L1, L2, RH and HC summaries that ran Sprint change, and are listed.
- **Fast Run is the base** for every run speed. Its existing adaptations stay: the calibrated leg scale, the chosen stance width (`stanceWidthAddM['fast-run']` 0.065 on L3), the carry swing and the plan 12 ranges.
- Fixture ids that name a speed (`L1-F1-sprint`, `RH-F3-sprint`, `L2-F11-sprint`, `L3-F16-sprint`, 6.6 m/s requests) keep their ids: they describe the speed, not the clip. Their titles drop "sprint" where it names the clip.

## Design

**One run clip.** `runClipsBew` returns `clips: [fastRun]`. Its id becomes `run-clips:<fast-run identity>+jog-v1`. `runClipsL3` returns `[walk, fastRun]`. `selectClips` and `clipPosition` already handle a single clip (k = 0, blend 0).

**Top speed.** At 6.6 m/s (the fastest request in the fixtures) Fast Run plays at 1.13× its cadence, inside its 1.3× limit (7.58 m/s at full stride). No stride lengthening is needed.

**The jog.** Below Fast Run's slowest cadence (0.7×, 4.08 m/s at full stride), the stride shortens instead, as the walk's already does (`walk.minStride`):
- A new optional profile block `run: { minStride, liftScale }`. With it, the run's stride share is `clamp(speed / (minRate × nominal × legScale), minStride, 1)`, at the slowest cadence. The feet's fore-aft excursion scales by the share (the existing `stride` scale in the sample).
- The swing foot's lift above the stance line and the suspension's run bob scale by `share ^ liftScale`, so a jog lifts the feet and bobs less than a full-stride run. Today a slower cadence lowers the bob's downward acceleration, so the attenuation in `SUSPENSION_*.run.maxDownAccelG` lets more of it through: a jog would bounce more than a run without this.
- The clip weight fades in lower: `fadeMps` moves from [3.21, 4.08] to [1.6, 2.2] m/s.
- Starting values: `minStride` 0.45 (the clip covers down to 1.84 m/s at the slowest cadence), `liftScale` 1. Both are look settings: the lab's run-clip tune panel gains sliders for them, as it has for stance width, and the user sets them by eye. The chosen values go into the profile.

**The walk-to-run crossover (L3).** The walk still plays only for a walking request. A walk that speeds up crosses to Fast Run over the walk's own blend, which now ends at the new `fadeMps[1]` (2.2 m/s) instead of 4.08 m/s. A run start from rest and a stop from a run still never pass through the walk (plan 08 design). Below 1.6 m/s on a run request the procedural gait still shows; that window is the first and last few steps of a start or stop.

**Removal.** Delete:
- `models/animations/sprint.json`, `models/animations/source/sprint.fbx` and the `sprint` manifest entry; update `models/animations/README.md`.
- The `SPRINT` import and source entry (run-clips.ts); regenerate `run-clips.record.json` with `npm run intake-clips`.
- `stanceWidthAddM.sprint` (L3 profile), and the comment on the attenuated bob in profiles.ts, which quotes Sprint's figure; restate it with Fast Run's.
- Every test reference to the clip (not the speed), in the files 13b leaves: `locomotion` (clip list, blend endpoints), `footwork` (the L2-F11 width validation cases written against `sprint`), `transitions` (stance widths), `ball-carry` (the per-clip carry runs) and `body-limits` (the self-clearance and joint-range cases that name Sprint's swing). Each is rewritten to the one-clip profile, not deleted.

## Tasks

- [ ] **Tests first.** Update the profile tests to the new contract and see them fail: one clip `fast-run`; the profile id; the fade band [1.6, 2.2]; stride share 1 above 4.08 m/s (scaled) and `minStride` at 1.84 m/s; the lift scale applied to swing height and bob; a 6.6 m/s run plays at 1.13× ± 0.01.
- [ ] **Stride and lift.** Add `run?: { minStride; liftScale }` to `RunClipProfile`, its validation (`0 < minStride <= 1`, `liftScale >= 0`) and its export (`runClipProfileExport`). Apply it in `advanceRunPlayback` (stride share) and in the sample (swing lift, `stride`), and pass the share to the suspension's run-bob target.
- [ ] **One clip.** Change `runClipsBew` and `runClipsL3`; delete the Sprint asset, manifest entry and imports; regenerate the intake record; update the README.
- [ ] **Lab sliders.** The tune panel shows `minStride` and `liftScale` beside stance width; changing one reloads the fixture with a `+jog(…)` id suffix, as the width does.
- [ ] **User look review.** In the lab, the user sets the two sliders by eye on `L3-F17-runStartFree` (the jog through the start), `L3-F16-runStopFree` and `L3-F16-sprint`. Record the chosen values.
- [ ] **Evidence.** Full suite, typecheck, build, all fixtures. List every changed summary by milestone, with any result, ending or ball-spot change.
- [ ] **Audits.** Transition audit on all L3 boundaries (unchanged 1 cm limit); plant feasibility on L2-F11 and L3-F16; self-clearance and joint-range acceptance from plans 11 and 12 on the opted fixtures.
- [ ] **Close.** Handoff section.

## Acceptance

- **No Sprint.** No file, record entry, import, profile key or test names the Sprint clip. `git grep -i sprint` finds only speed names, history in docs and handoff evidence.
- **Fast Run everywhere it runs.** On every fixture with a run-clip profile, a supported player travelling between 2.2 and 6.6 m/s has clip weight 1 once the weight has settled (0.2 s at `weightRatePerS` 5), apart from heading fades (`headingMaxDeg`), which are reported.
- **Jog.** At 2.5 m/s (`L3-F17-runStartFree` during its start), the stance foot's slip against its plant stays within the plan 07 plant limits, and the cadence is between 0.7 and 0.75× Fast Run's.
- **Transitions.** 0 L3 boundaries over 1 cm in the transition audit.
- **Physics.** No new ragdoll validation failure; the plan 09 power audit stays clean.
- **Evidence.** Changed summaries listed with endings; the G1–G4 fixtures, which have no run clips, are byte-identical.

## Known limits

- The jog is a shortened Fast Run. Its timing stays Fast Run's: each foot is down for about 32% of the cycle and both are off the ground for about 35% of it. A real jog spends longer on the ground. A supplied jog clip would replace this.
- Below 1.6 m/s, a run request (the first and last steps of a start or a stop) still shows the procedural gait.
