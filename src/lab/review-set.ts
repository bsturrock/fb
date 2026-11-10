// Plan 13c: the lab's review set, the short list the fixture select shows by default. The only place the list is written:
// edit names, members, groups and order here. Every id must be a registered fixture whose players all use the player
// model; at most 30 entries (tests/harness.test.ts, "plan 13c"). Every other fixture stays registered, tested and
// exported, and is reachable from the lab's "All fixtures" list, its filter, or ?fixture=<id>.

export interface ReviewEntry {
  /** Registered fixture id. */
  id: string;
  /** Plain description shown in the select. */
  name: string;
}

export interface ReviewGroup {
  label: string;
  entries: readonly ReviewEntry[];
}

export const REVIEW_SET: readonly ReviewGroup[] = [
  {
    label: 'Stand, walk, run',
    entries: [
      { id: 'L3-F13-carrier', name: 'Idle, carrying the ball' },
      { id: 'L3-F13-free', name: 'Idle, no ball' },
      { id: 'L3-F14-forward', name: 'Walk, then stop' },
      { id: 'L3-F14-walkRunStopCarrier', name: 'Idle, walk, run and stop with the ball' },
      { id: 'L3-F17-runStart', name: 'Start from rest into a run' },
      { id: 'L3-F16-runStop', name: 'Run at 6 m/s, then stop' },
      { id: 'L3-F16-reaccel', name: 'Brake, then run again' },
      { id: 'L3-F16-sprint', name: 'Top speed, 6.6 m/s' },
      { id: 'L3-F18-runLab', name: 'Run lab: live speed, edit Fast Run keyframes' },
    ],
  },
  {
    label: 'Contact and tackles',
    entries: [
      { id: 'L3-F2-miss', name: 'Defender misses ahead of the runner' },
      { id: 'L3-F3-collision', name: 'Head-on collision' },
      { id: 'L3-F3-side', name: 'Side hit at speed' },
      { id: 'L3-F1-phase0', name: 'Forced-entry tackle' },
      { id: 'L3-F4-twoArm', name: 'Shoulder and two-arm wrap' },
      { id: 'L3-F4-oneArm', name: 'Shoulder and one-arm wrap' },
      { id: 'L3-F5-drag', name: 'Runner drags the wrapped defender' },
      { id: 'L3-F6-hold', name: 'Standing contested hold' },
      { id: 'L3-F8-recontact', name: 'Second bump while the first unwinds' },
    ],
  },
  {
    label: 'Falls and endings',
    entries: [
      { id: 'L4-F10-wrap-on', name: 'Two-arm wrap to the ground' },
      { id: 'L4-F3-run-on', name: 'Carrier falls from a run, protecting the ball' },
      { id: 'L4-F3-model-oblique-on', name: 'Carrier tips toward the free arm and braces' },
      { id: 'L4-F2-model-forward-on', name: 'Forward fall, knees flex' },
      { id: 'L4-F9-contact', name: 'Fall in contact, with the fall response' },
      { id: 'L4-F5-twoClamp-on', name: 'Both fall from a standing wrap' },
    ],
  },
  {
    label: 'Ragdoll handoff',
    entries: [
      { id: 'HC-F3-phase0', name: 'One-arm tackle, defender goes limp in contact' },
      { id: 'HC-F2-lift1.4', name: 'A player lands on another' },
      { id: 'HC-F1-low', name: 'Both go limp from a low stance' },
    ],
  },
];
