// Plan 10f (F2): debug switches belong to one simulation. Two simulations stepped side by side in one process, one with a
// switch on, each reproduce their own solo run; the export records every switch that is on and nothing otherwise; the
// read-only pose diagnostics change nothing and are not exported.
import { describe, expect, it } from 'vitest';
import { poseProbe, type SimDebug } from '../src/sim/debug';
import { Simulation } from '../src/sim/simulation';
import { FIX, pace, traceRowsDiff } from './helpers';

async function solo(id: string, debug?: SimDebug): Promise<Simulation> {
  const sim = await Simulation.create(FIX(id), debug ? { debug } : {});
  sim.runToEnd();
  return sim;
}

describe('plan 10f: per-simulation debug switches', () => {
  for (const [id, debug] of [
    ['L2-F3-runStop', { foot: { legacyEntry: true, noQuick: true } }],
    ['RH-F5-playerBelow', { pose: { noContinuity: true } }],
  ] as const) {
    it(`${id}: a switched and a default simulation stepped together each match their solo run`, async () => {
      const ref = await solo(id);
      const refOn = await solo(id, debug);
      // the switch has an effect, so a leak either way shows
      expect(traceRowsDiff(ref.trace, refOn.trace)).not.toBeNull();
      const on = await Simulation.create(FIX(id), { debug });
      const off = await Simulation.create(FIX(id));
      while (!on.done || !off.done) {
        on.stepTick();
        off.stepTick();
        await pace();
      }
      expect(traceRowsDiff(off.trace, ref.trace)).toBeNull();
      expect(traceRowsDiff(on.trace, refOn.trace)).toBeNull();
      expect(on.exportFixture().debug).toEqual(debug);
      expect('debug' in off.exportFixture()).toBe(false);
      for (const s of [ref, refOn, on, off]) s.dispose();
    }, 30000);
  }

  it('the pose diagnostics are read-only and not exported; a switch set false is not exported', async () => {
    const ref = await solo('RH-F5-playerBelow');
    let calls = 0;
    const probe = poseProbe({ on: true, trace: () => calls++ });
    const seen = await solo('RH-F5-playerBelow', { poseProbe: probe, pose: { noContinuity: false }, foot: { noQuick: false } });
    expect(calls).toBeGreaterThan(0);
    expect(Object.keys(probe.last).length).toBeGreaterThan(0);
    expect(traceRowsDiff(seen.trace, ref.trace)).toBeNull();
    expect(JSON.stringify(seen.exportFixture())).toBe(JSON.stringify(ref.exportFixture()));
    ref.dispose();
    seen.dispose();
  }, 30000);
});
