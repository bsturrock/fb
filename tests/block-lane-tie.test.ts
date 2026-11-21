// Plan 16 (p46): the lane's call with a tie (`BlockLanes.tie`, LANE_TIE_V1, `decideLane`). On constructed cases, with its
// fault twin: without the tie a millimetre of reach or height decides it.
import { describe, expect, it } from 'vitest';
import { decideLane, LANE_TIE_V1 } from '../src/sim/controllers/block';

describe('plan 16 (p46), the lane call with a tie', () => {
  const C = 0.6;
  const T = LANE_TIE_V1;
  it('nearer by more than 2 cm has the inside; level, the man lower by more than 1 cm; level and as high, the man driving over the man holding; else as without a tie; fault twin: without it, 1 mm decides', () => {
    // (BL-F9-threePoint's call: B holding, 1 mm nearer and 1 mm lower than A, who drives)
    const holder = { awayM: 0.596, hipM: 0.726, drives: false };
    const driver = { awayM: 0.597, hipM: 0.727, drives: true };
    expect(decideLane(driver, holder, C, T), 'level: the driver').toBe('inside');
    expect(decideLane(holder, driver, C, T)).toBe('outside');
    expect(decideLane(driver, holder, C), 'fault: without the tie, the 1 mm').toBe('outside');
    // (past the tie the bodies decide, the driver or not)
    expect(decideLane(driver, { ...holder, awayM: 0.57 }, C, T), 'nearer by 2.7 cm').toBe('outside');
    expect(decideLane(driver, { ...holder, hipM: 0.71 }, C, T), 'lower by 1.7 cm').toBe('outside');
    expect(decideLane({ ...driver, hipM: 0.71 }, holder, C, T), 'the driver lower').toBe('inside');
    // (both driving, or both holding: as without the tie)
    expect(decideLane({ ...holder, drives: true }, driver, C, T), 'both driving: nearer').toBe('inside');
    expect(decideLane({ ...driver, drives: false }, holder, C, T), 'both holding: nearer').toBe('outside');
    expect(decideLane({ ...driver, awayM: 0.596, hipM: 0.726 }, { ...holder, drives: true }, C, T), 'alike').toBeUndefined();
    // (none before a palm is within the call)
    expect(decideLane({ ...driver, awayM: 0.7 }, { ...holder, awayM: 0.65 }, C, T), 'none within the call').toBeUndefined();
  });
});
