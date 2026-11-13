// Contact motion polish 1.2, the ride hold (WRAP_V7's `ride.hold`, `RideHoldProfile`; src/sim/arms.ts): the riding
// tackler's clamp on the fallen carrier is a patch on the part of his ragdoll it holds, so it survives the carrier's own
// limbs between them and the post-step push-out that lifts the forearm off every substep or two. No fixture uses it.
// Whole runs from the fixture's start (WRAP_V7 is used by no fixture, so no capture holds it; the runs are under 1.2 s).
// Each case has its fault twin: WRAP_V7 without `ride.hold`, or the same run with the rule broken (`SimDebug.wrap`).
import { describe, expect, it } from 'vitest';
import { WRAP_V7, type WrapDebug, type WrapProfile } from '../src/sim/controllers/wrap';
import type { FixtureDef } from '../src/sim/fixture';
import { ARM_G2 } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { FIX } from './helpers';

// The ride hold on the ride it was built on: WRAP_V7 without the come-down (`ride.down`, which ends the ride, and with it the
// hold, once he is low; tests/wrap-ride.test.ts covers it).
const V7: WrapProfile = { ...WRAP_V7, ride: { ...WRAP_V7.ride!, down: undefined } };
const NO_HOLD: WrapProfile = { ...V7, ride: { ...V7.ride!, hold: undefined } };
interface Priv {
  arms: { arms: Map<string, Record<string, { ride?: unknown }>> };
}

interface RideRun {
  rConv: number | null;
  /** The longest unbroken run (s) of substeps with D's clamp on the fallen carrier while D is on his feet. */
  longest: number;
  /** The ride hold's events (`rideHoldBegin`, `rideHoldRemap`, `rideHoldEnd`) of D: time, kind, arm, reason. */
  ride: { t: number; kind: string; reason?: string; ok?: boolean }[];
  /** Substeps with a ride patch on an arm of D while D is not riding (`PlayerIntent.ride`). */
  unridden: number;
  /** Substeps with a ride patch. */
  patched: number;
}

async function rideRun(def: FixtureDef, opts: { reverseOrder?: boolean; fault?: WrapDebug; until?: number } = {}): Promise<RideRun> {
  let probe: (() => void) | null = null;
  const sim = await Simulation.create(def, { onSubstep: () => probe?.(), ...(opts.reverseOrder ? { reverseOrder: true } : {}), ...(opts.fault ? { debug: { wrap: opts.fault } } : {}) });
  const D = sim.players.find((p) => p.id === 'D')!;
  const R = sim.players.find((p) => p.id === 'R')!;
  const arms = (sim as unknown as Priv).arms.arms.get('D')!;
  const out: RideRun = { rConv: null, longest: 0, ride: [], unridden: 0, patched: 0 };
  let runFrom: number | null = null;
  let ev = 0;
  const dt = sim.physics.dt;
  probe = () => {
    for (; ev < sim.events.length; ev++) {
      const e = sim.events[ev];
      if (e.playerId === 'D' && e.type.startsWith('rideHold')) out.ride.push({ t: sim.t, kind: e.type, reason: e.data?.reason as string | undefined, ok: e.data?.ok as boolean | undefined });
    }
    if (R.controlMode !== 'supported' && out.rConv === null) out.rConv = sim.t;
    if (D.controlMode !== 'supported' || out.rConv === null) {
      runFrom = null;
      return;
    }
    const held = (['left', 'right'] as const).some((s) => sim.arms!.clampOf('D', s)?.targetId === 'R');
    if (held) {
      runFrom ??= sim.t - dt;
      out.longest = Math.max(out.longest, sim.t - runFrom);
    } else runFrom = null;
    const patched = (['left', 'right'] as const).some((s) => !!arms[s].ride);
    if (patched) out.patched++;
    if (patched && !D.intent.ride) out.unridden++;
  };
  while (!sim.done && sim.t < (opts.until ?? 1.2)) sim.stepTick();
  sim.dispose();
  return out;
}

describe('polish 1.2, the ride hold (WRAP_V7, no fixture uses it)', () => {
  it('(a) the riding tackler holds the fallen carrier unbroken (front wrap reversed: from his conversion to the end of play, 0.38 s; side two-arm: 0.11 s); without the ride hold the clamp never holds 0.1 s unbroken after his conversion', async () => {
    for (const [id, rev, least] of [['L3-F19-front', true, 0.3], ['L3-F4-twoArm', false, 0.1]] as const) {
      const on = await rideRun({ ...FIX(id), wrap: V7 }, { reverseOrder: rev });
      expect(on.rConv, id).not.toBeNull();
      expect(on.longest, id).toBeGreaterThanOrEqual(least);
      // twin: the ride hold absent
      const off = await rideRun({ ...FIX(id), wrap: NO_HOLD }, { reverseOrder: rev });
      expect(off.rConv, id).toBe(on.rConv);
      expect(off.longest, id).toBeLessThan(0.1);
      expect(off.ride, id).toEqual([]);
    }
  }, 60_000);

  it('(a2) at the carrier\'s conversion the riding tackler\'s clamp goes on as a patch on his ragdoll (rear wrap: both arms, remapped onto the core within 5 cm)', async () => {
    const on = await rideRun({ ...FIX('L3-F19-rear'), wrap: V7 }, { until: 2.3 });
    const remaps = on.ride.filter((e) => e.kind === 'rideHoldRemap');
    expect(remaps.length).toBe(2);
    expect(remaps.every((e) => e.ok && Math.abs(e.t - on.rConv!) < 1e-9)).toBe(true);
    const off = await rideRun({ ...FIX('L3-F19-rear'), wrap: NO_HOLD }, { until: 2.3 });
    expect(off.ride).toEqual([]);
  }, 60_000);

  it('(b) the hold breaks when the patch leaves the arm\'s reach (HC-F3) or on overload (a 40 N arm ceiling); with the break rules off it holds on', async () => {
    const reach = await rideRun({ ...FIX('HC-F3-phase0'), wrap: V7 }, { until: 1 });
    const broke = reach.ride.find((e) => e.kind === 'rideHoldEnd');
    expect(broke?.reason).toBe('unreachable');
    const reachTwin = await rideRun({ ...FIX('HC-F3-phase0'), wrap: V7 }, { until: 1, fault: { rideHoldNoBreak: true } });
    expect(reachTwin.ride.filter((e) => e.kind === 'rideHoldEnd').every((e) => e.reason === 'rideEnded' || e.reason === 'playEnded' || e.reason === 'ownerRagdoll')).toBe(true);
    expect(reachTwin.patched).toBeGreaterThan(reach.patched);
    // overload: the per-arm ceiling at 40 N, under the clamp's own demand (90-660 N): exposure past 0.1 s
    const F = FIX('L3-F4-twoArm');
    const A = F.armProfile ?? ARM_G2;
    const weak = { ...F, wrap: V7, armProfile: { ...A, hold: { ...A.hold, perArmCeilingN: 40 } } };
    const over = await rideRun(weak);
    expect(over.ride.some((e) => e.kind === 'rideHoldEnd' && e.reason === 'overload')).toBe(true);
    const overTwin = await rideRun(weak, { fault: { rideHoldNoBreak: true } });
    expect(overTwin.ride.some((e) => e.kind === 'rideHoldEnd' && e.reason === 'overload')).toBe(false);
  }, 90_000);

  it('(c) a hold never secured gets no ride patch: none while he is not riding, none on the miss; with every supported owner counted as riding, the side two-arm gets one before his drive', async () => {
    for (const id of ['L3-F4-twoArm', 'L3-F1-low', 'L3-F19-miss']) {
      const on = await rideRun({ ...FIX(id), wrap: V7 });
      expect(on.unridden, id).toBe(0);
      if (id === 'L3-F19-miss') expect(on.patched, id).toBe(0);
      else expect(on.patched, id).toBeGreaterThan(0);
    }
    const twin = await rideRun({ ...FIX('L3-F4-twoArm'), wrap: V7 }, { fault: { rideHoldUnridden: true } });
    expect(twin.unridden).toBeGreaterThan(0);
  }, 90_000);
});
