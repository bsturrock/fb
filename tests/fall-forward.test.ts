// Polish 4 (p17): the forward-fall body plan (FORWARD_FALL_V1 in FALL_REACT_V3 and FALL_L4_V2, no fixture uses it). A man
// falling forward lays out (hips toward in line with the trunk, knees a slight bend) and his free arm lands bent and gives,
// instead of the tuck (+30 deg hip, +40 deg knee) that lands him folded so the ground's friction turns him over his head
// and shoulders (main checkout .scratch/p17/landing/summary.txt). Each test is a capture shortly after the switch, resumed
// with the plan and with the fault (the tuck kept: the profile without the plan), or a constructed run.
import { describe, expect, it } from 'vitest';
import { FALL_REACT_V2, FALL_REACT_V3, withForwardFall } from '../src/sim/profiles';
import { bulkOf, landmarkWorld, limbDirWorld } from '../src/sim/ragdoll';
import { Simulation } from '../src/sim/simulation';
import { qInvRot, qRot, v3 } from '../src/sim/vec';
import { asCaptured, FIX } from './runs';
import { loadState, resumeState } from './state';

/** A ragdoll's end pose: hips height, head below the pelvis (deg, the core's up axis below level), the more flexed hip. */
function endPose(sim: Simulation, id: string): { hipsM: number; headDownDeg: number; hipFlexDeg: number; keJ: number } {
  const rag = sim.players.find((p) => p.id === id)!.rag!;
  const q = rag.bodies.core.rotation();
  const flex = (side: 'left' | 'right'): number => {
    const d = qInvRot(q, limbDirWorld(rag, `${side}Thigh`));
    return (Math.atan2(d.z, -d.y) * 180) / Math.PI;
  };
  return {
    hipsM: landmarkWorld(rag, 'pelvisMid').y,
    headDownDeg: (Math.asin(-qRot(q, v3(0, 1, 0)).y) * 180) / Math.PI,
    hipFlexDeg: Math.max(flex('left'), flex('right')),
    keJ: bulkOf(Object.values(rag.bodies)).ke,
  };
}

// HC-F3-lowRunner: the hit runner R switches at 0.821 s, tipped 47 deg and going over the way he runs (4.2 m/s). Today he
// lands folded and ends inverted, hips 0.60 m up, head 33 deg below his pelvis, a hip flexed 117 deg; with the plan he
// lands thigh, hand, chest and ends flat (hips 0.25 m, head level, hips 18 deg).
describe('polish 4 forward fall: the hit runner lays out (HC-F3-lowRunner, from 0.833 s)', () => {
  const CAP = 'tests/data/state/HC-F3-lowRunner~fwd@50.json.gz';

  it('with the plan R ends flat (hips at or under 0.35 m, head within 10 deg of level, no hip past 60 deg), within the power and work caps; with the tuck kept he ends folded', async () => {
    const cap = loadState(CAP);
    const def = asCaptured(cap, (d) => ({ ...d, fallResponse: FALL_REACT_V3 }));
    const look = async (plan: boolean) => {
      const sim = await resumeState(cap, plan ? { def } : { def: { ...def, fallResponse: FALL_REACT_V2 }, variant: ['fallResponse'] });
      expect(sim.players.find((p) => p.id === 'R')!.fall?.forward).toBe(true);
      sim.runToEnd();
      const pose = endPose(sim, 'R');
      const stats = sim.players.find((p) => p.id === 'R')!.fall!.stats;
      sim.dispose();
      return { pose, stats };
    };
    const plan = await look(true);
    expect(plan.pose.hipsM).toBeLessThanOrEqual(0.35);
    expect(Math.abs(plan.pose.headDownDeg)).toBeLessThanOrEqual(10);
    expect(plan.pose.hipFlexDeg).toBeLessThanOrEqual(60);
    expect(plan.stats.overPowerSubsteps).toBe(0);
    expect(plan.stats.overWork).toBe(false);
    const tuck = await look(false);
    expect(tuck.pose.hipFlexDeg).toBeGreaterThan(90);
    expect(tuck.pose.hipsM).toBeGreaterThan(0.45);
    expect(tuck.pose.headDownDeg).toBeGreaterThan(20);
  });
});

// A backward and a sideways fall (L4-F2-back-on, L4-F2-side-on: R shoved back, and sideways): under the plan the switch
// decides them not forward and the run is today's, trace for trace. The fault twin of the decision is the capture above:
// a forward fall the plan changes.
describe('polish 4 forward fall: backward and sideways falls are untouched', () => {
  for (const id of ['L4-F2-back-on', 'L4-F2-side-on']) {
    it(`${id}: R's fall is decided not forward, and the run with the plan on its fall response is the run without`, async () => {
      const def = FIX(id);
      expect(def.fallResponse!.forward).toBeUndefined();
      const look = async (plan: boolean) => {
        const sim = await Simulation.create(plan ? { ...def, fallResponse: withForwardFall(def.fallResponse!) } : def);
        sim.runToEnd();
        const ev = sim.events.filter((e) => e.type === 'fallResponse');
        const trace = JSON.stringify(sim.trace);
        sim.dispose();
        return { ev, trace };
      };
      const today = await look(false);
      const plan = await look(true);
      expect(plan.ev.map((e) => e.playerId)).toEqual(['R']);
      expect(plan.ev[0]!.data?.forward).toBe(false);
      expect(today.ev[0]!.data && 'forward' in today.ev[0]!.data).toBe(false);
      expect(plan.trace).toBe(today.trace);
    });
  }
});
