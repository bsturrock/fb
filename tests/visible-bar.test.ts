// Ladder 15: the visible-bar trackers (tests/visible-bar.ts) on constructed samples, each rule's fault twin: a series just
// past each part of a rule fails it for that part; the same series just inside passes. 60 Hz samples, as a drawn frame.
import { describe, expect, it } from 'vitest';
import { JOINT_PAST_DEG, JOINT_PAST_S, jointPastRange, LIMB_DEEP_M, LIMB_HELD_M, LIMB_HELD_S, limbInBody } from './visible-bar';

const DT = 1 / 60;
/** Feeds `n` frames of one key from t = 1 s; `f(i)` is frame i's sample. */
function limb(frames: { d: number; axis?: boolean }[]): string[] {
  const l = limbInBody();
  frames.forEach((x, i) => l.sample('R.left', 1 + i * DT, DT, x.d, !!x.axis, `R.left@${(1 + i * DT).toFixed(3)}`));
  return l.breaches();
}
const times = (n: number, x: { d: number; axis?: boolean }) => Array.from({ length: n }, () => x);
const HELD = Math.round(LIMB_HELD_S / DT);

describe('ladder 15: a limb in a body (constructed)', () => {
  it('deeper than 10 cm in one frame blocks; 9.9 cm does not', () => {
    expect(limb([{ d: 0 }, { d: LIMB_DEEP_M - 0.001 }, { d: 0 }])).toEqual([]);
    const b = limb([{ d: 0 }, { d: LIMB_DEEP_M + 0.001 }, { d: 0 }]);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatch(/10\.10 cm deep \(over 10 cm\)/);
  });
  it('past 5 cm for 0.1 s on end blocks; for one frame less, or with a frame out between, it does not', () => {
    const over = { d: LIMB_HELD_M + 0.005 };
    expect(limb(times(HELD - 1, over))).toEqual([]);
    expect(limb([...times(HELD - 1, over), { d: 0.01 }, ...times(HELD - 1, over)])).toEqual([]);
    const b = limb(times(HELD, over));
    expect(b).toHaveLength(1);
    expect(b[0]).toMatch(/over 5 cm deep for 0\.100 s from 1\.000 s/);
    // 4.9 cm held for a second does not
    expect(limb(times(60, { d: LIMB_HELD_M - 0.001 }))).toEqual([]);
  });
  it('the bone axis inside for 0.1 s blocks, shallow as the shape may read; for one frame less it does not', () => {
    expect(limb(times(HELD - 1, { d: 0.02, axis: true }))).toEqual([]);
    const b = limb(times(HELD, { d: 0.02, axis: true }));
    expect(b).toHaveLength(1);
    expect(b[0]).toMatch(/the bone axis inside for 0\.100 s/);
  });
  it('keys are separate: two limbs each past 5 cm for half the time do not add up', () => {
    const l = limbInBody();
    for (let i = 0; i < HELD; i++) l.sample(i % 2 ? 'R.left' : 'R.right', 1 + i * DT, DT, 0.06, false, 'x');
    expect(l.breaches()).toEqual([]);
  });
});

describe('ladder 15: a joint past its range (constructed)', () => {
  const N = Math.round(JOINT_PAST_S / DT);
  const run = (xs: number[]): string[] => {
    const j = jointPastRange();
    xs.forEach((x, i) => j.sample('R rightShoulder', 1 + i * DT, DT, x, `@${i}`));
    return j.breaches();
  };
  it('more than 15 deg past for 0.25 s blocks; for one frame less, or 14.9 deg for a second, it does not', () => {
    expect(run(Array(N - 1).fill(JOINT_PAST_DEG + 1))).toEqual([]);
    expect(run(Array(60).fill(JOINT_PAST_DEG - 0.1))).toEqual([]);
    const b = run(Array(N).fill(JOINT_PAST_DEG + 1));
    expect(b).toHaveLength(1);
    expect(b[0]).toMatch(/over 15 deg past the range for 0\.250 s/);
  });
});
