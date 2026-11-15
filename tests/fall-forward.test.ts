// Polish 4 (p17): the forward-fall body plan (FORWARD_FALL_V1 in FALL_REACT_V3 and FALL_L4_V2, no fixture uses it). A man
// falling forward lays out (hips toward in line with the trunk, knees a slight bend) and his free arm lands bent and gives,
// instead of the tuck (+30 deg hip, +40 deg knee) that lands him folded so the ground's friction turns him over his head
// and shoulders (main checkout .scratch/p17/landing/summary.txt). Each test is a capture shortly after the switch, resumed
// with the plan and with the fault (the tuck kept: the profile without the plan), or a constructed run.
import { describe, expect, it } from 'vitest';
import { isGround } from '../src/sim/contracts';
import { FALL_L4_V2, FALL_REACT_V2, FALL_REACT_V3, FORWARD_FALL_V1, withForwardFall, type FallResponseProfile } from '../src/sim/profiles';
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

/**
 * Run to the end, measuring the player's vault: the largest rise of his potential energy over its running minimum after
 * his first ground contact other than a shin or shoe (a small bounce is a few joules; going over a planted arm is hundreds).
 */
function runMeasuringRise(sim: Simulation, id: string): number {
  const p = sim.players.find((q) => q.id === id)!;
  const g = Math.abs(sim.def.solver.gravityY);
  let landed = false;
  let peMin = Infinity;
  let rise = 0;
  while (!sim.done) {
    sim.stepTick();
    if (!p.rag) continue;
    landed ||= sim.contacts.some((c) => c.impulse > 0 && [[c.a, c.b], [c.b, c.a]].some(([o, other]) => o.playerId === id && isGround(other) && !/shoe|shin/.test(o.region)));
    if (!landed) continue;
    const B = bulkOf(Object.values(p.rag.bodies));
    const pe = B.massKg * g * B.com.y;
    peMin = Math.min(peMin, pe);
    rise = Math.max(rise, pe - peMin);
  }
  return rise;
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

// L3-F4-twoArm (p17 fast): the hit runner R switches at 0.758 s carrying the ball on his right arm, held out where the
// switch found it (palm 0.38 m ahead of the chest at shoulder height). At 3478b67 that arm's forearm and palm landed first
// (1.121 s) and he vaulted over it (PE up some 200 J, ending on head and shoulder): the pole was the ball arm, not the brace.
// With the plan's `carry` the ball arm folds in to the chest at speed, gives once landed, and he ends flat. The fault twin is
// the plan without `carry` (the ball arm held in its carry pose, as at 3478b67).
describe('polish 4 forward fall at speed: the ball arm folds in, no vault (L3-F4-twoArm, from 0.783 s)', () => {
  const CAP = 'tests/data/state/L3-F4-twoArm~fwd@47.json.gz';
  it('with the plan R ends flat without going over his arm (PE rise under 60 J); with the ball arm held out he vaults (over 150 J, head down past 20 deg)', async () => {
    const cap = loadState(CAP);
    const def = asCaptured(cap, (d) => ({ ...d, fallResponse: FALL_REACT_V3 }));
    const { carry: _carry, ...held } = FORWARD_FALL_V1;
    const look = async (F: FallResponseProfile) => {
      const sim = await resumeState(cap, { def: { ...def, fallResponse: F } });
      expect(sim.players.find((p) => p.id === 'R')!.fall?.forward).toBe(true);
      const rise = runMeasuringRise(sim, 'R');
      const pose = endPose(sim, 'R');
      sim.dispose();
      return { rise, pose };
    };
    const plan = await look(FALL_REACT_V3);
    expect(plan.rise).toBeLessThan(60);
    expect(plan.pose.hipsM).toBeLessThanOrEqual(0.35);
    expect(Math.abs(plan.pose.headDownDeg)).toBeLessThanOrEqual(10);
    const fault = await look({ ...FALL_REACT_V3, forward: held });
    expect(fault.rise).toBeGreaterThan(150);
    expect(fault.pose.headDownDeg).toBeGreaterThan(20);
  });
});

// L4-F9-defenderFalling reversed (p17 fast): R's forward fall switches at 0.562 s; at 0.908 s his knee and hip lay-out
// drives push the way the legs already turn and contact adds speed in the solve: without `concentricRadPerS` he realizes
// 181 W against the audit's 157.5. With it the drives give their ceiling up with the joint's speed and the run stays
// under the cap. Fault twin: the plan without `concentricRadPerS`.
describe('polish 4 forward fall: the lay-out respects the power cap (L4-F9-defenderFalling reversed, from 0.583 s)', () => {
  const CAP = 'tests/data/state/L4-F9-defenderFalling~fwd-rev@35.json.gz';
  it('with the rate-aware ceilings no substep passes the power cap; without them one does', async () => {
    const cap = loadState(CAP);
    const def = asCaptured(cap, (d) => ({ ...d, fallResponse: FALL_L4_V2 }));
    const { concentricRadPerS: _rate, ...whole } = FORWARD_FALL_V1;
    const look = async (F: FallResponseProfile) => {
      const sim = await resumeState(cap, { def: { ...def, fallResponse: F } });
      expect(sim.players.find((p) => p.id === 'R')!.fall?.forward).toBe(true);
      sim.runToEnd();
      const stats = { ...sim.players.find((p) => p.id === 'R')!.fall!.stats };
      sim.dispose();
      return stats;
    };
    const plan = await look(FALL_L4_V2);
    expect(plan.overPowerSubsteps).toBe(0);
    expect(plan.overWork).toBe(false);
    const fault = await look({ ...FALL_L4_V2, forward: whole });
    expect(fault.overPowerSubsteps).toBeGreaterThan(0);
  });
});

// L3-F9-noProbe-prep (p17 flip, the same in both orders; captured before D's switch at 1.05 s, so the reach runs under
// the code at hand): with the brace elbow exempt from the rate-aware ceiling, at 1.358 s his free arm's brace shoulder,
// under the plan's 60 N m and already turning the way it drives at 8.6 rad/s, is planned at 135 W and an impact in the
// solve carries it to 160 W against the audit's 157.5. With the brace's elbow giving its ceiling up with its speed, as
// the lay-out's hips and knees do, the reach is gentler, the shoulder no longer meets the impact turning hard, and the
// run stays under the cap (the shoulder keeps its ceiling: under the rule it loses the reach, profiles.ts
// ForwardFallPlan). Fault twin: the brace elbow exempted in fall-response.ts armCmds (one over substep, checked when this
// landed); the plan without `concentricRadPerS` moves the trajectory and is no twin here.
describe('polish 4 forward fall: the brace respects the power cap (L3-F9-noProbe-prep, from 1.033 s)', () => {
  const CAP = 'tests/data/state/L3-F9-noProbe-prep~fwd@62.json.gz';
  it('with the brace elbow under the rate-aware ceiling no substep passes the power cap', async () => {
    const cap = loadState(CAP);
    const def = asCaptured(cap, (d) => ({ ...d, fallResponse: FALL_REACT_V3 }));
    const look = async (F: FallResponseProfile) => {
      const sim = await resumeState(cap, { def: { ...def, fallResponse: F } });
      sim.runToEnd();
      expect(sim.players.find((p) => p.id === 'D')!.fall?.forward).toBe(true);
      const stats = { ...sim.players.find((p) => p.id === 'D')!.fall!.stats };
      sim.dispose();
      return stats;
    };
    const plan = await look(FALL_REACT_V3);
    expect(plan.overPowerSubsteps).toBe(0);
    expect(plan.overWork).toBe(false);
  });
});
