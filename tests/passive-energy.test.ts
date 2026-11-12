import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { create, FIX, runSim } from './helpers';
import { INJECTION_J, passiveEnergyMeter, type EnergyRun, type SolveEnergy } from './passive-energy';

// Ladder rung 7g: the passive-energy meter (tests/passive-energy.ts, the full check's energy matrix). A ragdoll dropped
// on its side with the response off (L4-F2-side-off: only the envelope applied, no other player) gains nothing over the threshold
// in any solve, and its largest contact-free gain (the bookkeeping's floor) is a fraction of it. The twin adds a known
// 2 J of kinetic energy to its core inside one solve (between the meter's two readings): the meter reads that solve 2 J
// higher, to rounding, and counts it as an injection.
// Ladder 8l: dropped from DROP_M above the fixture's start, so the contact-free solves are the fall before it lands (0.35
// s, about 100 solves) rather than its bounces: tipped from the floor it had 20, and 3 under the visible flip (7 with
// its hip stops or its PGS 4 alone).
const ID = 'L4-F2-side-off';
const ADD_J = 2;
const DROP_M = 0.5;
const dropped = (d: FixtureDef): FixtureDef => ({ ...d, id: `${d.id}-drop${DROP_M}`, players: d.players.map((p) => ({ ...p, initial: { ...p.initial, lift: DROP_M } })) });

async function metered(addAt?: number): Promise<{ solves: Map<number, SolveEnergy>; run: EnergyRun }> {
  const sim = await create(dropped(FIX(ID)));
  if (addAt !== undefined) {
    // inside the solve: after the engine's step, before the meter's second reading
    const phys = sim.physics;
    const step = phys.step;
    phys.step = function (this: typeof phys): void {
      step.call(this);
      if (sim.steps + 1 !== addAt) return;
      const core = sim.players[0].rag!.bodies.core;
      const v = core.linvel();
      const m = core.mass();
      const s = Math.hypot(v.x, v.y, v.z);
      // along the current velocity (or up, at rest): 0.5 m ((s + dv)^2 - s^2) = ADD_J
      const u = s > 1e-6 ? { x: v.x / s, y: v.y / s, z: v.z / s } : { x: 0, y: 1, z: 0 };
      const dv = -s + Math.sqrt(s * s + (2 * ADD_J) / m);
      core.setLinvel({ x: v.x + u.x * dv, y: v.y + u.y * dv, z: v.z + u.z * dv }, true);
    };
  }
  const solves = new Map<number, SolveEnergy>();
  const meter = passiveEnergyMeter(sim, (e) => solves.set(e.step, e));
  await runSim(sim);
  meter.restore();
  return { solves, run: meter.runs().get(sim.players[0].id)! };
}

describe('ladder rung 7g: the passive-energy meter', () => {
  it('a dropped ragdoll with the response off gains nothing over the threshold; 2 J added inside one solve reads 2 J more there and injects', async () => {
    const base = await metered();
    const readings = [...base.solves.values()];
    expect(readings.length).toBeGreaterThan(300);
    expect(readings.every((e) => !e.touched)).toBe(true);
    // the response is off: what is applied is the envelope's torque pairs, whose work the meter takes out
    expect(readings.some((e) => e.appliedJ !== 0)).toBe(true);
    expect(Math.max(...readings.map((e) => e.passiveJ))).toBeLessThan(INJECTION_J);
    expect(base.run.injecting).toBe(0);
    const quiet = readings.filter((e) => !e.contact);
    expect(quiet.length).toBeGreaterThanOrEqual(10);
    expect(Math.max(...quiet.map((e) => e.passiveJ))).toBeLessThan(INJECTION_J / 2);

    // the twin: one solve on the floor, well after the conversion
    const at = readings.find((e) => e.t > 1.0 && e.contact)!.step;
    const twin = await metered(at);
    const [a, b] = [base.solves.get(at)!, twin.solves.get(at)!];
    expect(b.passiveJ - a.passiveJ).toBeCloseTo(ADD_J, 6);
    expect(b.passiveJ).toBeGreaterThan(INJECTION_J);
    // every solve before it reads the same
    for (const [k, e] of base.solves) if (k < at) expect(twin.solves.get(k)!.passiveJ).toBe(e.passiveJ);
    expect(twin.run.injecting).toBeGreaterThan(0);
  }, 120000);
});
